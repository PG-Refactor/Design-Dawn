//! Image assets: importing dropped files, copying an asset between Documents, and reading
//! an asset for the `dawn-asset` protocol (docs/architecture.md §6, docs/file-format.md §6,
//! docs/security.md §8).
//!
//! Every path that creates a file validates first (regular file, extension, size, content,
//! natural size) and only then copies, so a rejected file leaves no trace. Assets are only
//! ever created (`create_new`), never overwritten; a failed Block creation later does not
//! delete an asset that was already imported.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use super::dropped_files::{resolve_drop, DroppedFilesState};
use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::session::{ProjectSession, ProjectSessions};
use crate::domain::block_type::BlockType;
use crate::domain::constants::{ASSETS_DIRECTORY_NAME, PATH_SEPARATOR};
use crate::domain::content_path::ContentPath;
use crate::domain::entity_id::{DocumentId, ProjectId};
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::infrastructure::error::PersistenceError;
use crate::infrastructure::file_format::constants::ASSET_MAX_BYTES;
use crate::infrastructure::file_format::image_dimensions::{
    initial_block_size, natural_size, Dimensions,
};
use crate::infrastructure::file_format::image_validation::{validate_image_content, ImageFormat};
use crate::infrastructure::file_format::naming::asset_file_name;

/// Shown for a dropped path that has no usable file name (never a directory or full path).
const UNKNOWN_FILE_NAME: &str = "unknown";

/// One imported asset, with the sizes the Frontend needs to create its Image Block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedImage {
    pub content_path: String,
    pub natural_width: u32,
    pub natural_height: u32,
    pub initial_width: u32,
    pub initial_height: u32,
    pub block_type: &'static str,
}

/// A dropped file that was not imported. `file_name` is the base name only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedFile {
    pub file_name: String,
    pub error: ApplicationError,
}

/// Partial success is a normal result: the caller creates Blocks for `imported` and reports
/// `rejected`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DropImportResult {
    pub imported: Vec<ImportedImage>,
    pub rejected: Vec<RejectedFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopiedAsset {
    pub content_path: String,
    pub natural_width: u32,
    pub natural_height: u32,
}

/// An asset's bytes and format, for the `dawn-asset` protocol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetContent {
    pub bytes: Vec<u8>,
    pub format: ImageFormat,
}

impl AssetContent {
    pub fn mime_type(&self) -> &'static str {
        self.format.mime_type()
    }
}

/// A file that passed every check; ready to be copied into a Document.
struct ValidatedImage {
    bytes: Vec<u8>,
    natural: Dimensions,
}

fn lock_sessions(sessions: &Mutex<ProjectSessions>) -> MutexGuard<'_, ProjectSessions> {
    // A panic elsewhere must not brick asset access; writes are re-validated against the
    // filesystem anyway.
    sessions.lock().unwrap_or_else(PoisonError::into_inner)
}

fn base_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || UNKNOWN_FILE_NAME.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

fn require_writable(session: &ProjectSession, document_id: &DocumentId) -> ApplicationResult<()> {
    if session.document(document_id)?.writable {
        Ok(())
    } else {
        Err(ApplicationError::not_writable(format!(
            "document {document_id} did not load and cannot be written"
        )))
    }
}

/// The `dawn-asset` protocol and asset imports only deal with Documents the user has open.
fn require_opened(session: &ProjectSession, document_id: &DocumentId) -> ApplicationResult<()> {
    if session.document(document_id)?.opened {
        Ok(())
    } else {
        Err(ApplicationError::entity_not_found(format!(
            "document {document_id} is not open"
        )))
    }
}

/// An asset can only be written into an opened, writable Document.
fn require_open_and_writable(
    session: &ProjectSession,
    document_id: &DocumentId,
) -> ApplicationResult<()> {
    require_opened(session, document_id)?;
    require_writable(session, document_id)
}

/// Follows symlinks (the link's target is what gets read). `label` is a base name, never a
/// full path, because error details travel to the Frontend.
fn regular_file_size(path: &Path, label: &str) -> ApplicationResult<u64> {
    let metadata = fs::metadata(path)
        .map_err(|error| PersistenceError::from_io(format!("inspect {label:?}"), &error))?;
    if metadata.is_file() {
        Ok(metadata.len())
    } else {
        Err(ApplicationError::new(
            ErrorKind::InvalidImageContent,
            format!("{label:?} is not a regular file"),
        ))
    }
}

fn too_large(label: &str) -> ApplicationError {
    ApplicationError::new(
        ErrorKind::AssetTooLarge,
        format!("{label:?} is larger than {ASSET_MAX_BYTES} bytes"),
    )
}

/// The size is checked from metadata before anything is read, and the read itself is capped
/// one byte past the limit, so a file that grows in between still cannot fill memory.
fn read_within_limit(path: &Path, label: &str, size: u64) -> ApplicationResult<Vec<u8>> {
    if size > ASSET_MAX_BYTES {
        return Err(too_large(label));
    }
    let read_error = |error| PersistenceError::from_io(format!("read {label:?}"), &error);
    let file = File::open(path).map_err(read_error)?;
    let mut bytes = Vec::new();
    file.take(ASSET_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(read_error)?;
    if u64::try_from(bytes.len()).map_or(true, |length| length > ASSET_MAX_BYTES) {
        return Err(too_large(label));
    }
    Ok(bytes)
}

fn validate_image(format: ImageFormat, bytes: Vec<u8>) -> ApplicationResult<ValidatedImage> {
    validate_image_content(format, &bytes)?;
    let natural = natural_size(format, &bytes)?;
    Ok(ValidatedImage { bytes, natural })
}

/// Validation order: regular file, extension, size, content, natural size.
fn read_validated_image(path: &Path) -> ApplicationResult<ValidatedImage> {
    let label = base_name(path);
    let size = regular_file_size(path, &label)?;
    let format = ImageFormat::from_file_name(&label).ok_or_else(|| {
        DomainError::new(
            DomainErrorKind::InvalidContentExtension,
            format!("unsupported image extension: {label:?}"),
        )
    })?;
    validate_image(format, read_within_limit(path, &label, size)?)
}

fn imported_image(content_path: String, natural: Dimensions) -> ImportedImage {
    let initial = initial_block_size(natural);
    ImportedImage {
        content_path,
        natural_width: natural.width,
        natural_height: natural.height,
        initial_width: initial.width,
        initial_height: initial.height,
        block_type: BlockType::Image.as_str(),
    }
}

/// Creates the asset under a sanitized, collision-free name and returns its contentPath.
fn store_image(
    session: &mut ProjectSession,
    document_id: &DocumentId,
    original_name: &str,
    bytes: &[u8],
) -> ApplicationResult<String> {
    require_writable(session, document_id)?;
    let base = session.document_base(document_id)?;
    session.ensure_directory(&base, ASSETS_DIRECTORY_NAME)?;
    let existing = session.entry_names(&base, ASSETS_DIRECTORY_NAME)?;
    let file_name = asset_file_name(original_name, &existing)?;
    let content_path = format!("{ASSETS_DIRECTORY_NAME}{PATH_SEPARATOR}{file_name}");
    ContentPath::parse(BlockType::Image, &content_path)?;
    session.create_file(&base, &content_path, bytes)?;
    Ok(content_path)
}

/// Validates `source_path` and copies it into the Document's `assets/`.
pub fn import_asset(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    source_path: &Path,
) -> ApplicationResult<ImportedImage> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    // Before reading anything, so a read-only Document does not cost a 20 MiB read. Not a
    // command: the open-Document rule applies to `import_dropped_images` only.
    require_writable(session, &document_id)?;
    let image = read_validated_image(source_path)?;
    let content_path = store_image(session, &document_id, &base_name(source_path), &image.bytes)?;
    Ok(imported_image(content_path, image.natural))
}

/// Imports every file of the drop in drop order. An unknown project, Document or `dropId`,
/// or a Document that cannot be written, fails the whole command; a problem with one file
/// only rejects that file. Files are read without holding the session lock.
pub fn import_dropped_images(
    sessions: &Mutex<ProjectSessions>,
    drops: &Mutex<DroppedFilesState>,
    window_label: &str,
    drop_id: &str,
    project_id: &str,
    document_id: &str,
) -> ApplicationResult<DropImportResult> {
    let paths = resolve_drop(drops, window_label, drop_id)?;
    let document_id = DocumentId::parse(document_id)?;
    require_open_and_writable(
        lock_sessions(sessions).session_mut(project_id)?,
        &document_id,
    )?;

    let mut result = DropImportResult {
        imported: Vec::new(),
        rejected: Vec::new(),
    };
    for path in paths {
        let file_name = base_name(&path);
        let imported = read_validated_image(&path).and_then(|image| {
            let mut guard = lock_sessions(sessions);
            let session = guard.session_mut(project_id)?;
            let content_path = store_image(session, &document_id, &file_name, &image.bytes)?;
            Ok(imported_image(content_path, image.natural))
        });
        match imported {
            Ok(image) => result.imported.push(image),
            Err(error) => result.rejected.push(RejectedFile { file_name, error }),
        }
    }
    Ok(result)
}

struct LocatedAsset {
    file_path: PathBuf,
    file_name: String,
    format: ImageFormat,
}

/// Resolves an asset's contentPath inside its Document: lexical rules first, then the real
/// path after symlinks, which must stay inside the Document root.
fn locate_asset(
    session: &ProjectSession,
    document_id: &DocumentId,
    content_path: &str,
) -> ApplicationResult<LocatedAsset> {
    let content_path = ContentPath::parse(BlockType::Image, content_path)?;
    let file_name = content_path
        .as_str()
        .rsplit(PATH_SEPARATOR)
        .next()
        .unwrap_or_default()
        .to_owned();
    let format = ImageFormat::from_file_name(&file_name).ok_or_else(|| {
        DomainError::new(
            DomainErrorKind::InvalidContentExtension,
            format!("unsupported image extension: {file_name:?}"),
        )
    })?;
    let base = session.document_base(document_id)?;
    let file_path = session.resolve_existing_path(&base, content_path.as_str())?;
    Ok(LocatedAsset {
        file_path,
        file_name,
        format,
    })
}

fn read_located(asset: &LocatedAsset) -> ApplicationResult<Vec<u8>> {
    let size = regular_file_size(&asset.file_path, &asset.file_name)?;
    read_within_limit(&asset.file_path, &asset.file_name, size)
}

/// For the `dawn-asset` protocol: the bytes and format of one asset of an opened Document.
/// Only the bytes are read; content validation happened at import time. The session lock is
/// held just long enough to resolve the path.
pub fn read_asset_for_url(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    document_id: &str,
    content_path: &str,
) -> ApplicationResult<AssetContent> {
    let project_id = ProjectId::parse(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let asset = {
        let guard = lock_sessions(sessions);
        let session = guard.get(&project_id)?;
        require_opened(session, &document_id)?;
        locate_asset(session, &document_id, content_path)?
    };
    Ok(AssetContent {
        bytes: read_located(&asset)?,
        format: asset.format,
    })
}

/// Copies an asset into another Document of the same Project (Block copy / paste across
/// Documents) under its own file name, with `-2`, `-3`, ... on collision. The source is
/// validated like an import. Copying into the Document the asset already lives in copies
/// nothing and returns the same contentPath: the pasted Block simply shares the file.
/// The target must be opened and writable in both cases, so the answer does not depend on the target.
pub fn copy_asset_to_document(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    source_document_id: &str,
    content_path: &str,
    target_document_id: &str,
) -> ApplicationResult<CopiedAsset> {
    let source_document_id = DocumentId::parse(source_document_id)?;
    let target_document_id = DocumentId::parse(target_document_id)?;
    let source = {
        let mut guard = lock_sessions(sessions);
        let session = guard.session_mut(project_id)?;
        // The source only has to belong to the Project: a copied Block can outlive the tab
        // it came from, and the bytes are copied here without ever reaching the Frontend.
        session.document(&source_document_id)?;
        require_open_and_writable(session, &target_document_id)?;
        locate_asset(session, &source_document_id, content_path)?
    };
    let image = validate_image(source.format, read_located(&source)?)?;
    let copied = |content_path: String| CopiedAsset {
        content_path,
        natural_width: image.natural.width,
        natural_height: image.natural.height,
    };
    if source_document_id == target_document_id {
        return Ok(copied(content_path.to_owned()));
    }
    let mut guard = lock_sessions(sessions);
    let session = guard.session_mut(project_id)?;
    let stored = store_image(
        session,
        &target_document_id,
        &source.file_name,
        &image.bytes,
    )?;
    Ok(copied(stored))
}
