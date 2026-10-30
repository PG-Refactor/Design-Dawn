use super::error::{ApplicationError, ApplicationResult};
use super::session::{ProjectSessions, SheetRecord};
use super::snapshot::{EntityState, SaveResult, SheetSnapshot};
use crate::domain::constants::{
    BLOCKS_DIRECTORY_NAME, CURRENT_SHEET_SCHEMA_VERSION, PATH_SEPARATOR, SHEETS_DIRECTORY_NAME,
};
use crate::domain::display_name::DisplayName;
use crate::domain::entity_id::{DocumentId, SheetId};
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::domain::sheet::{Sheet, SheetInput};
use crate::infrastructure::file_format::constants::{SHEET_FILE_NAME, SHEET_NAME_BASE};
use crate::infrastructure::file_format::dto::{to_json_bytes, SheetDto};
use crate::infrastructure::file_format::naming::unique_directory_name;
use crate::infrastructure::filesystem::atomic_write::WriteOutcome;

pub fn create_sheet(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet_id: &str,
    name: &str,
) -> ApplicationResult<SheetSnapshot> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let sheet = Sheet::new(&SheetInput {
        schema_version: i64::from(CURRENT_SHEET_SCHEMA_VERSION),
        sheet_id: sheet_id.to_owned(),
        name: DisplayName::new(name)?.as_str().to_owned(),
        blocks: Vec::new(),
    })?;
    let record = session.document(&document_id)?;
    if !record.writable {
        return Err(ApplicationError::not_writable(format!(
            "document {document_id} did not load and cannot be written"
        )));
    }
    if record.sheets.contains_key(sheet.sheet_id()) {
        return Err(DomainError::new(
            DomainErrorKind::DuplicateId,
            format!("sheetId already exists: {}", sheet.sheet_id()),
        )
        .into());
    }
    let base = session.document_base(&document_id)?;
    session.ensure_directory(&base, SHEETS_DIRECTORY_NAME)?;
    let existing = session.entry_names(&base, SHEETS_DIRECTORY_NAME)?;
    let directory_name = unique_directory_name(name, SHEET_NAME_BASE, &existing);
    let sheet_directory = format!("{SHEETS_DIRECTORY_NAME}{PATH_SEPARATOR}{directory_name}");

    // sheet.json first, mirroring create_document: it is what makes the directory a Sheet.
    let dto = SheetDto::from_domain(&sheet);
    session.create_directory(&base, &sheet_directory)?;
    session.create_file(
        &base,
        &format!("{sheet_directory}{PATH_SEPARATOR}{SHEET_FILE_NAME}"),
        &to_json_bytes(&dto)?,
    )?;
    session.create_directory(
        &base,
        &format!("{sheet_directory}{PATH_SEPARATOR}{BLOCKS_DIRECTORY_NAME}"),
    )?;
    session.document_mut(&document_id)?.sheets.insert(
        *sheet.sheet_id(),
        SheetRecord {
            directory_name,
            writable: true,
        },
    );
    Ok(SheetSnapshot {
        sheet_id: dto.sheet_id.clone(),
        name: Some(dto.name.clone()),
        state: EntityState::Loaded,
        sheet: Some(dto),
    })
}

pub fn save_sheet(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet: &SheetDto,
) -> ApplicationResult<SaveResult> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let sheet = sheet.to_domain()?;
    let record = session.document(&document_id)?;
    let sheet_record = record.sheets.get(sheet.sheet_id()).ok_or_else(|| {
        ApplicationError::entity_not_found(format!("unknown sheetId: {}", sheet.sheet_id()))
    })?;
    if !sheet_record.writable {
        return Err(ApplicationError::not_writable(format!(
            "sheet {} did not load and cannot be written",
            sheet.sheet_id()
        )));
    }
    // The target file is chosen by the payload's own ID, so one sheet's data can never be
    // written into another sheet's directory.
    let relative = format!(
        "{SHEETS_DIRECTORY_NAME}{PATH_SEPARATOR}{}{PATH_SEPARATOR}{SHEET_FILE_NAME}",
        sheet_record.directory_name
    );
    let base = session.document_base(&document_id)?;
    let bytes = to_json_bytes(&SheetDto::from_domain(&sheet))?;
    let outcome = session.write_file(&base, &relative, &bytes)?;
    Ok(SaveResult {
        written: outcome == WriteOutcome::Written,
    })
}

/// Deletes a Sheet directory. Destructive and not undoable; the caller has already confirmed
/// with the user and saved the Document without this Sheet, but nothing
/// here relies on that. `document.json` is deliberately left alone: a stale order entry is
/// reported as `missingEntity` by the loader. A Sheet that failed to load can be deleted too.
pub fn delete_sheet(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet_id: &str,
) -> ApplicationResult<()> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let sheet_id = SheetId::parse(sheet_id)?;
    let sheet_directory = session
        .document(&document_id)?
        .sheets
        .get(&sheet_id)
        .ok_or_else(|| ApplicationError::entity_not_found(format!("unknown sheetId: {sheet_id}")))?
        .directory_name
        .clone();
    let base = session.document_base(&document_id)?;
    let sheets_container = format!("{base}{PATH_SEPARATOR}{SHEETS_DIRECTORY_NAME}");
    let removal =
        session.remove_directory_tree(&sheets_container, &sheet_directory, SHEET_FILE_NAME);
    let forget = match &removal {
        Ok(()) => true,
        Err(failure) => !failure.metadata_survives,
    };
    if forget {
        session.document_mut(&document_id)?.sheets.remove(&sheet_id);
        session.forget_ledger_under(&format!(
            "{sheets_container}{PATH_SEPARATOR}{sheet_directory}"
        ));
        session.forget_block_numbers(&document_id, Some(&sheet_directory));
    }
    removal.map_err(|failure| failure.error.into())
}
