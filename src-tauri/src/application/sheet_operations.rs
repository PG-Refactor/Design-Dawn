use super::error::{ApplicationError, ApplicationResult};
use std::fs;

use super::session::{ProjectSession, ProjectSessions, SheetRecord};
use super::snapshot::{EntityState, SaveResult, SheetSnapshot};
use crate::domain::constants::{
    BLOCKS_DIRECTORY_NAME, CURRENT_SHEET_SCHEMA_VERSION, PATH_SEPARATOR, SHEETS_DIRECTORY_NAME,
};
use crate::domain::display_name::DisplayName;
use crate::domain::entity_id::{DocumentId, SheetId};
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::domain::sheet::{Sheet, SheetInput};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::{
    DOCUMENT_FILE_NAME, SHEET_FILE_NAME, SHEET_NAME_BASE,
};
use crate::infrastructure::file_format::dto::{to_json_bytes, DocumentDto, SheetDto};
use crate::infrastructure::file_format::naming::unique_directory_name;
use crate::infrastructure::filesystem::atomic_write::WriteOutcome;

/// Creates a Sheet on disk now: its directory, `sheet.json` and `blocks/`, and its place at
/// the end of the order in `document.json`.
pub fn create_sheet(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet_id: &str,
    name: &str,
) -> ApplicationResult<SheetSnapshot> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let (sheet, directory_name) = new_sheet(session, &document_id, sheet_id, name)?;
    let dto = SheetDto::from_domain(&sheet);
    write_new_sheet(session, &document_id, &directory_name, &dto)?;
    session.document_mut(&document_id)?.sheets.insert(
        *sheet.sheet_id(),
        SheetRecord {
            directory_name,
            writable: true,
            reserved_name: None,
        },
    );
    Ok(loaded_snapshot(dto))
}

/// Reserves a Sheet without writing anything (Auto Save off): its directory name is chosen
/// and kept from other new sheets, and the first write into it (`save_sheet`, a block's
/// content) puts it on disk the way `create_sheet` does. Closing the Document without that
/// write forgets it.
pub fn reserve_sheet(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    sheet_id: &str,
    name: &str,
) -> ApplicationResult<SheetSnapshot> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let (sheet, directory_name) = new_sheet(session, &document_id, sheet_id, name)?;
    session.document_mut(&document_id)?.sheets.insert(
        *sheet.sheet_id(),
        SheetRecord {
            directory_name,
            writable: true,
            reserved_name: Some(sheet.name().as_str().to_owned()),
        },
    );
    Ok(loaded_snapshot(SheetDto::from_domain(&sheet)))
}

/// Puts a reserved Sheet on disk, empty and under the name it was reserved with, before
/// anything is written into it; a Sheet already on disk is left alone. Its blocks and
/// current name follow with the save that caused this.
pub(crate) fn write_reserved_sheet(
    session: &mut ProjectSession,
    document_id: &DocumentId,
    sheet_id: &SheetId,
) -> ApplicationResult<()> {
    let Some(record) = session.document(document_id)?.sheets.get(sheet_id) else {
        return Ok(());
    };
    let Some(name) = record.reserved_name.clone() else {
        return Ok(());
    };
    let directory_name = record.directory_name.clone();
    let sheet = empty_sheet(&sheet_id.to_string(), &name)?;
    write_new_sheet(
        session,
        document_id,
        &directory_name,
        &SheetDto::from_domain(&sheet),
    )?;
    if let Some(record) = session.document_mut(document_id)?.sheets.get_mut(sheet_id) {
        record.reserved_name = None;
    }
    Ok(())
}

fn empty_sheet(sheet_id: &str, name: &str) -> ApplicationResult<Sheet> {
    Ok(Sheet::new(&SheetInput {
        schema_version: i64::from(CURRENT_SHEET_SCHEMA_VERSION),
        sheet_id: sheet_id.to_owned(),
        name: DisplayName::new(name)?.as_str().to_owned(),
        blocks: Vec::new(),
    })?)
}

/// A new empty Sheet for a writable Document and a directory name no other Sheet of it has,
/// on disk or reserved.
fn new_sheet(
    session: &mut ProjectSession,
    document_id: &DocumentId,
    sheet_id: &str,
    name: &str,
) -> ApplicationResult<(Sheet, String)> {
    let sheet = empty_sheet(sheet_id, name)?;
    let record = session.document(document_id)?;
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
    let mut taken: Vec<String> = record
        .sheets
        .values()
        .filter(|sheet| sheet.reserved_name.is_some())
        .map(|sheet| sheet.directory_name.clone())
        .collect();
    let base = session.document_base(document_id)?;
    match session.entry_names(&base, SHEETS_DIRECTORY_NAME) {
        Ok(names) => taken.extend(names),
        // A Document whose last sheet was deleted may have no `sheets/` (Git keeps no empty
        // directory); it is made when a sheet is written.
        Err(error) if error.kind == PersistenceErrorKind::FileNotFound => {}
        Err(error) => return Err(error.into()),
    }
    let directory_name = unique_directory_name(name, SHEET_NAME_BASE, &taken);
    Ok((sheet, directory_name))
}

/// Writes a new Sheet's directory, `sheet.json` and `blocks/`, then adds it to the order in
/// `document.json` on disk. `sheet.json` goes first, mirroring `create_document`: it is
/// what makes the directory a Sheet.
fn write_new_sheet(
    session: &mut ProjectSession,
    document_id: &DocumentId,
    directory_name: &str,
    dto: &SheetDto,
) -> ApplicationResult<()> {
    let base = session.document_base(document_id)?;
    session.ensure_directory(&base, SHEETS_DIRECTORY_NAME)?;
    let sheet_directory = format!("{SHEETS_DIRECTORY_NAME}{PATH_SEPARATOR}{directory_name}");
    session.create_directory(&base, &sheet_directory)?;
    session.create_file(
        &base,
        &format!("{sheet_directory}{PATH_SEPARATOR}{SHEET_FILE_NAME}"),
        &to_json_bytes(dto)?,
    )?;
    session.create_directory(
        &base,
        &format!("{sheet_directory}{PATH_SEPARATOR}{BLOCKS_DIRECTORY_NAME}"),
    )?;
    // The new sheet joins the order in the document.json on disk, and nothing else there
    // changes: the Document's other unsaved edits stay unsaved (Auto Save may be off).
    // Without the order the sheet would not be part of the Document, so it is removed again.
    let sheet_id = SheetId::parse(&dto.sheet_id)?;
    if let Err(error) = append_to_saved_sheet_order(session, &base, &sheet_id) {
        let sheets_container = format!("{base}{PATH_SEPARATOR}{SHEETS_DIRECTORY_NAME}");
        let _ = session.remove_directory_tree(&sheets_container, directory_name, SHEET_FILE_NAME);
        return Err(error);
    }
    Ok(())
}

fn loaded_snapshot(dto: SheetDto) -> SheetSnapshot {
    SheetSnapshot {
        sheet_id: dto.sheet_id.clone(),
        name: Some(dto.name.clone()),
        state: EntityState::Loaded,
        sheet: Some(dto),
    }
}

/// Adds `sheet_id` to the end of the order in the Document's `document.json` as it is on
/// disk. The file is read without recording it, so a change made outside the app since the
/// session last read or wrote it still makes the write fail (`externallyModified`).
fn append_to_saved_sheet_order(
    session: &mut ProjectSession,
    base: &str,
    sheet_id: &SheetId,
) -> ApplicationResult<()> {
    session.ensure_file_unchanged(base, DOCUMENT_FILE_NAME)?;
    let path = session.resolve_existing_path(base, DOCUMENT_FILE_NAME)?;
    let bytes = fs::read(&path).map_err(|error| {
        PersistenceError::from_io(format!("read {DOCUMENT_FILE_NAME:?}"), &error)
    })?;
    let mut dto: DocumentDto = serde_json::from_slice(&bytes).map_err(|error| {
        PersistenceError::new(
            PersistenceErrorKind::InvalidJson,
            format!("{DOCUMENT_FILE_NAME}: {error}"),
        )
    })?;
    let id = sheet_id.to_string();
    if !dto.sheet_order.contains(&id) {
        dto.sheet_order.push(id);
    }
    let document = dto.to_domain()?;
    let bytes = to_json_bytes(&DocumentDto::from_domain(&document))?;
    session.write_file(base, DOCUMENT_FILE_NAME, &bytes)?;
    Ok(())
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
    let directory_name = sheet_record.directory_name.clone();
    if sheet_record.reserved_name.is_some() {
        write_reserved_sheet(session, &document_id, sheet.sheet_id())?;
    }
    // The target file is chosen by the payload's own ID, so one sheet's data can never be
    // written into another sheet's directory.
    let relative = format!(
        "{SHEETS_DIRECTORY_NAME}{PATH_SEPARATOR}{directory_name}{PATH_SEPARATOR}{SHEET_FILE_NAME}"
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
    let record = session
        .document(&document_id)?
        .sheets
        .get(&sheet_id)
        .ok_or_else(|| {
            ApplicationError::entity_not_found(format!("unknown sheetId: {sheet_id}"))
        })?;
    let sheet_directory = record.directory_name.clone();
    if record.reserved_name.is_some() {
        // Nothing of it is on disk: forgetting it is all there is to do.
        session.document_mut(&document_id)?.sheets.remove(&sheet_id);
        session.forget_block_numbers(&document_id, Some(&sheet_directory));
        return Ok(());
    }
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
