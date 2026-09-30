//! Text Block content files (`.md` / `.mmd`). Images are Assets and go through `asset_import`.

use super::error::{ApplicationError, ApplicationResult};
use super::session::{ProjectSession, ProjectSessions};
use super::snapshot::SaveResult;
use crate::domain::block_type::{BlockType, ContentLocation, BLOCK_TYPE_DEFINITIONS};
use crate::domain::constants::{BLOCKS_DIRECTORY_NAME, PATH_SEPARATOR, SHEETS_DIRECTORY_NAME};
use crate::domain::content_path::ContentPath;
use crate::domain::entity_id::{DocumentId, SheetId};
use crate::domain::error::DomainError;
use crate::infrastructure::file_format::naming::block_content_file_name;
use crate::infrastructure::filesystem::atomic_write::WriteOutcome;
use crate::infrastructure::filesystem::text_content::{decode_text, encode_text};

/// Text content lives in a sheet's `blocks/` directory; binary content (images) in `assets/`.
fn is_text_block_type(block_type: BlockType) -> bool {
    block_type.definition().location == ContentLocation::SheetBlocks
}

/// Validates a contentPath that arrives without its block type, by finding the text block
/// type whose rules it satisfies. Returns the sheet directory segment.
fn parse_text_content_path(content_path: &str) -> Result<String, DomainError> {
    let mut first_error = None;
    for definition in BLOCK_TYPE_DEFINITIONS
        .iter()
        .filter(|definition| is_text_block_type(definition.block_type))
    {
        match ContentPath::parse(definition.block_type, content_path) {
            Ok(path) => {
                // SheetBlocks paths are exactly `sheets/<sheet-dir>/blocks/<file>`.
                let sheet_directory = path
                    .as_str()
                    .split(PATH_SEPARATOR)
                    .nth(1)
                    .unwrap_or_default()
                    .to_owned();
                return Ok(sheet_directory);
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
    let base = session.document_base(&document_id)?;
    session.ensure_directory(&base, &blocks_directory)?;
    let existing = session.entry_names(&base, &blocks_directory)?;
    let file_name = block_content_file_name(block_type, &existing)?;
    let content_path = format!("{blocks_directory}{PATH_SEPARATOR}{file_name}");
    // Never hand out a path the domain would refuse on the next save.
    ContentPath::parse(block_type, &content_path)?;
    session.create_file(&base, &content_path, &encode_text(text))?;
    Ok(content_path)
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

pub fn write_block_content(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    content_path: &str,
    text: &str,
) -> ApplicationResult<SaveResult> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let sheet_directory = parse_text_content_path(content_path)?;
    require_writable_sheet_directory(session, &document_id, &sheet_directory)?;
    let base = session.document_base(&document_id)?;
    // Saving never creates content: a missing file (a `missingContent` issue) stays an error
    // until the user restores it, instead of silently starting an empty replacement.
    session.resolve_existing_path(&base, content_path)?;
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
    let sheet_directory = parse_text_content_path(content_path)?;
    require_writable_sheet_directory(session, &document_id, &sheet_directory)?;
    let base = session.document_base(&document_id)?;
    session.remove_file(&base, content_path)?;
    Ok(())
}
