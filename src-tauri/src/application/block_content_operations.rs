//! Text Block content files (`.md` / `.mmd`). Images are Assets and go through `asset_import`.

use serde::Serialize;

use super::error::{ApplicationError, ApplicationResult};
use super::line_diff::{unified_diff, LineDiff};
use super::session::{ProjectSession, ProjectSessions};
use super::snapshot::SaveResult;
use crate::domain::block_type::{BlockType, ContentLocation, BLOCK_TYPE_DEFINITIONS};
use crate::domain::constants::{BLOCKS_DIRECTORY_NAME, PATH_SEPARATOR, SHEETS_DIRECTORY_NAME};
use crate::domain::content_path::ContentPath;
use crate::domain::entity_id::{DocumentId, SheetId};
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::naming::{block_content_file_name, block_content_number};
use crate::infrastructure::filesystem::atomic_write::WriteOutcome;
use crate::infrastructure::filesystem::text_content::{decode_text, encode_text};

/// Text content lives in a sheet's `blocks/` directory; binary content (images) in `assets/`.
pub(super) fn is_text_block_type(block_type: BlockType) -> bool {
    block_type.definition().location == ContentLocation::SheetBlocks
}

/// A text content path split into the parts the operations need.
struct TextContentPath {
    block_type: BlockType,
    sheet_directory: String,
    /// The `<n>` of `<blockType>-<n>.<ext>`; `None` for hand-made names outside the pattern.
    number: Option<u64>,
}

impl TextContentPath {
    fn from_validated(block_type: BlockType, path: &ContentPath) -> Self {
        // SheetBlocks paths are exactly `sheets/<sheet-dir>/blocks/<file>`.
        let mut segments = path.as_str().split(PATH_SEPARATOR);
        let sheet_directory = segments.nth(1).unwrap_or_default().to_owned();
        let number = segments
            .nth(1)
            .and_then(|file_name| block_content_number(block_type, file_name));
        Self {
            block_type,
            sheet_directory,
            number,
        }
    }
}

/// Validates a contentPath that arrives without its block type, by finding the text block
/// type whose rules it satisfies.
fn parse_text_content_path(content_path: &str) -> Result<TextContentPath, DomainError> {
    let mut first_error = None;
    for definition in BLOCK_TYPE_DEFINITIONS
        .iter()
        .filter(|definition| is_text_block_type(definition.block_type))
    {
        match ContentPath::parse(definition.block_type, content_path) {
            Ok(path) => {
                return Ok(TextContentPath::from_validated(
                    definition.block_type,
                    &path,
                ))
            }
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    Err(first_error.expect("at least one text block type is defined"))
}

fn require_writable_sheet_directory(
    session: &ProjectSession,
    document_id: &DocumentId,
    sheet_directory: &str,
) -> ApplicationResult<()> {
    let record = session.document(document_id)?;
    let sheet_record = record
        .sheets
        .values()
        .find(|sheet| sheet.directory_name == sheet_directory)
        .ok_or_else(|| {
            ApplicationError::entity_not_found(format!(
                "no loaded sheet uses directory {sheet_directory:?}"
            ))
        })?;
    if sheet_record.writable {
        Ok(())
    } else {
        Err(ApplicationError::not_writable(format!(
            "sheet directory {sheet_directory:?} did not load and cannot be written"
        )))
    }
}

pub fn create_block_content(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet_id: &str,
    block_type: &str,
    text: &str,
) -> ApplicationResult<String> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let sheet_id = SheetId::parse(sheet_id)?;
    let block_type = BlockType::parse(block_type)?;
    let record = session.document(&document_id)?;
    let sheet_record = record.sheets.get(&sheet_id).ok_or_else(|| {
        ApplicationError::entity_not_found(format!("unknown sheetId: {sheet_id}"))
    })?;
    if !sheet_record.writable {
        return Err(ApplicationError::not_writable(format!(
            "sheet {sheet_id} did not load and cannot be written"
        )));
    }
    let blocks_directory = format!(
        "{SHEETS_DIRECTORY_NAME}{PATH_SEPARATOR}{}{PATH_SEPARATOR}{BLOCKS_DIRECTORY_NAME}",
        sheet_record.directory_name
    );
    let sheet_directory = sheet_record.directory_name.clone();
    let base = session.document_base(&document_id)?;
    session.ensure_directory(&base, &blocks_directory)?;
    loop {
        let existing = session.entry_names(&base, &blocks_directory)?;
        let high_water =
            session.block_number_high_water(&document_id, &sheet_directory, block_type);
        let file_name = block_content_file_name(block_type, &existing, high_water)?;
        let content_path = format!("{blocks_directory}{PATH_SEPARATOR}{file_name}");
        // Never hand out a path the domain would refuse on the next save.
        let parsed = ContentPath::parse(block_type, &content_path)?;
        match session.create_file(&base, &content_path, &encode_text(text)) {
            Ok(()) => {
                note_issued_number(
                    session,
                    &document_id,
                    &TextContentPath::from_validated(block_type, &parsed),
                );
                return Ok(content_path);
            }
            // Something appeared under this name after it was listed. Counting it as issued
            // makes the next attempt move on instead of retrying the same name.
            Err(error) if error.kind == PersistenceErrorKind::AlreadyExists => {
                note_issued_number(
                    session,
                    &document_id,
                    &TextContentPath::from_validated(block_type, &parsed),
                );
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn note_issued_number(
    session: &mut ProjectSession,
    document_id: &DocumentId,
    path: &TextContentPath,
) {
    if let Some(number) = path.number {
        session.note_block_number(document_id, &path.sheet_directory, path.block_type, number);
    }
}

pub fn read_block_content(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    content_path: &str,
) -> ApplicationResult<String> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    parse_text_content_path(content_path)?;
    let base = session.document_base(&document_id)?;
    let bytes = session.read_file(&base, content_path)?;
    Ok(decode_text(&bytes)?)
}

/// The disk side of a comparison is refused above this size (Block text files are small).
pub const COMPARE_MAX_BYTES: u64 = 1024 * 1024;
/// Names of the two sides in the diff header.
const COMPARE_DISK_LABEL: &str = "disk";
const COMPARE_MEMORY_LABEL: &str = "memory";

/// How a Block's text in memory differs from its file on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum BlockContentComparison {
    Identical,
    /// A unified diff, the disk as the old side and `text` (memory) as the new side.
    Text {
        diff: String,
    },
    /// The file no longer exists on disk.
    RemovedOnDisk,
    NotUtf8,
    #[serde(rename_all = "camelCase")]
    TooLarge {
        limit_bytes: u64,
    },
}

/// Compares `text` (the caller's committed content; drafts are not part of it) with the file
/// on disk. Read-only: the session's record of the file is not touched, so the file still counts
/// as changed afterwards.
pub fn compare_block_content(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    content_path: &str,
    text: &str,
) -> ApplicationResult<BlockContentComparison> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    parse_text_content_path(content_path)?;
    let base = session.document_base(&document_id)?;
    let path = match session.resolve_existing_path(&base, content_path) {
        Ok(path) => path,
        Err(error) if error.kind == PersistenceErrorKind::FileNotFound => {
            return Ok(BlockContentComparison::RemovedOnDisk);
        }
        Err(error) => return Err(error.into()),
    };
    let size = std::fs::metadata(&path)
        .map_err(|error| PersistenceError::from_io(format!("stat {content_path:?}"), &error))?
        .len();
    if size > COMPARE_MAX_BYTES {
        return Ok(BlockContentComparison::TooLarge {
            limit_bytes: COMPARE_MAX_BYTES,
        });
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| PersistenceError::from_io(format!("read {content_path:?}"), &error))?;
    let Ok(on_disk) = decode_text(&bytes) else {
        return Ok(BlockContentComparison::NotUtf8);
    };
    Ok(
        match unified_diff(&on_disk, text, COMPARE_DISK_LABEL, COMPARE_MEMORY_LABEL) {
            LineDiff::Identical => BlockContentComparison::Identical,
            LineDiff::Text(diff) => BlockContentComparison::Text { diff },
            LineDiff::TooLarge => BlockContentComparison::TooLarge {
                limit_bytes: COMPARE_MAX_BYTES,
            },
        },
    )
}

pub fn write_block_content(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    content_path: &str,
    text: &str,
) -> ApplicationResult<SaveResult> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let parsed = parse_text_content_path(content_path)?;
    require_writable_sheet_directory(session, &document_id, &parsed.sheet_directory)?;
    let base = session.document_base(&document_id)?;
    // Saving never creates content: a missing file (a `missingContent` issue) stays an error
    // until the user restores it, instead of silently starting an empty replacement.
    // A file this session read or wrote that is gone now was removed outside the app: that
    // is reported by `write_file` as `externallyModified`, not as an ordinary missing file.
    match session.resolve_existing_path(&base, content_path) {
        Err(error)
            if error.kind == PersistenceErrorKind::FileNotFound
                && session.has_record(&base, content_path) => {}
        other => {
            other?;
        }
    }
    let outcome = session.write_file(&base, content_path, &encode_text(text))?;
    Ok(SaveResult {
        written: outcome == WriteOutcome::Written,
    })
}

pub fn delete_block_content(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    content_path: &str,
) -> ApplicationResult<()> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let parsed = parse_text_content_path(content_path)?;
    require_writable_sheet_directory(session, &document_id, &parsed.sheet_directory)?;
    let base = session.document_base(&document_id)?;
    session.remove_file(&base, content_path)?;
    // Remembered so a number that was handed out is not handed out again this session.
    note_issued_number(session, &document_id, &parsed);
    Ok(())
}

/// Puts a block's text back at its original path for Undo / Redo. Create-only: anything at
/// the target (even a dangling symlink) is `alreadyExists` and nothing is touched.
pub fn restore_block_content(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    block_type: &str,
    content_path: &str,
    text: &str,
) -> ApplicationResult<()> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let block_type = BlockType::parse(block_type)?;
    if !is_text_block_type(block_type) {
        return Err(DomainError::new(
            DomainErrorKind::UnsupportedBlockType,
            format!(
                "{} content is an asset, not restorable text",
                block_type.as_str()
            ),
        )
        .into());
    }
    let parsed =
        TextContentPath::from_validated(block_type, &ContentPath::parse(block_type, content_path)?);
    require_writable_sheet_directory(session, &document_id, &parsed.sheet_directory)?;
    let base = session.document_base(&document_id)?;
    // Git does not keep empty directories, so a sheet whose last block was deleted may
    // have no `blocks/` after a clone; restoring must work there just like creating.
    let blocks_directory = format!(
        "{SHEETS_DIRECTORY_NAME}{PATH_SEPARATOR}{}{PATH_SEPARATOR}{BLOCKS_DIRECTORY_NAME}",
        parsed.sheet_directory
    );
    session.ensure_directory(&base, &blocks_directory)?;
    session.create_file(&base, content_path, &encode_text(text))?;
    note_issued_number(session, &document_id, &parsed);
    Ok(())
}
