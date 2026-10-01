//! Asset import. Deliberately not a Tauri Command yet: exposing it needs the Drag & Drop
//! design of Phase 5, where the dropped file's path is received on the Rust side.

use std::fs;
use std::path::Path;

use super::error::{ApplicationError, ApplicationResult};
use super::session::ProjectSessions;
use crate::domain::block_type::BlockType;
use crate::domain::constants::{ASSETS_DIRECTORY_NAME, PATH_SEPARATOR};
use crate::domain::content_path::ContentPath;
use crate::domain::entity_id::DocumentId;
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::naming::asset_file_name;

/// Copies `source_path` into the Document's `assets/` under a sanitized, collision-free name
/// and returns the new contentPath. Existing assets are never overwritten.
pub fn import_asset(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    source_path: &Path,
) -> ApplicationResult<String> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let record = session.document(&document_id)?;
    if !record.writable {
        return Err(ApplicationError::not_writable(format!(
            "document {document_id} did not load and cannot be written"
        )));
    }
    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            ApplicationError::persistence(
                PersistenceErrorKind::IoError,
                format!("source has no usable file name: {}", source_path.display()),
            )
        })?;
    let bytes = fs::read(source_path).map_err(|error| {
        PersistenceError::from_io(format!("read {}", source_path.display()), &error)
    })?;
    let base = session.document_base(&document_id)?;
    session.ensure_directory(&base, ASSETS_DIRECTORY_NAME)?;
    let existing = session.entry_names(&base, ASSETS_DIRECTORY_NAME)?;
    let file_name = asset_file_name(original_name, &existing)?;
    let content_path = format!("{ASSETS_DIRECTORY_NAME}{PATH_SEPARATOR}{file_name}");
    ContentPath::parse(BlockType::Image, &content_path)?;
    session.create_file(&base, &content_path, &bytes)?;
    Ok(content_path)
}
