use std::collections::BTreeMap;

use super::error::{ApplicationError, ApplicationResult};
use super::load_issue::LoadIssue;
use super::loader::{
    assets_path, check_duplicate_block_ids, check_sheet_content, join_path, load_document_file,
    reconcile_children, report_leftover_temp_files, scan_sheet_directories,
};
use super::session::{DocumentRecord, ProjectSessions, SheetRecord};
use super::snapshot::{DocumentSnapshot, EntityState, SaveResult, SheetSnapshot};
use crate::domain::constants::ASSETS_DIRECTORY_NAME;
use crate::domain::constants::{
    BLOCKS_DIRECTORY_NAME, CURRENT_DOCUMENT_SCHEMA_VERSION, SHEETS_DIRECTORY_NAME,
};
use crate::domain::display_name::DisplayName;
use crate::domain::document::{Document, DocumentInput};
use crate::domain::entity_id::DocumentId;
use crate::domain::sheet::Sheet;
use crate::infrastructure::file_format::constants::DOCUMENTS_DIRECTORY_NAME;
use crate::infrastructure::file_format::constants::{DOCUMENT_FILE_NAME, DOCUMENT_NAME_BASE};
use crate::infrastructure::file_format::dto::{to_json_bytes, DocumentDto, SheetDto};
use crate::infrastructure::file_format::naming::unique_directory_name;
use crate::infrastructure::filesystem::atomic_write::WriteOutcome;

pub fn create_document(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
    name: &str,
) -> ApplicationResult<DocumentSnapshot> {
    let session = sessions.session_mut(project_id)?;
    let document = Document::new(&DocumentInput {
        schema_version: i64::from(CURRENT_DOCUMENT_SCHEMA_VERSION),
        document_id: document_id.to_owned(),
        name: DisplayName::new(name)?.as_str().to_owned(),
        sheet_order: Vec::new(),
    })?;
    if session.documents().contains_key(document.document_id()) {
        return Err(crate::domain::error::DomainError::new(
            crate::domain::error::DomainErrorKind::DuplicateId,
            format!("documentId already exists: {}", document.document_id()),
        )
        .into());
    }
    session.ensure_directory("", DOCUMENTS_DIRECTORY_NAME)?;
    let existing = session.entry_names("", DOCUMENTS_DIRECTORY_NAME)?;
    let directory_name = unique_directory_name(name, DOCUMENT_NAME_BASE, &existing);
    let base = super::session::document_base_path(&directory_name);

    // document.json goes in first: a directory without it is reported as unrecognized,
    // while a document.json without its sub-directories still loads.
    let dto = DocumentDto::from_domain(&document);
    session.create_directory("", &base)?;
    session.create_file(&base, DOCUMENT_FILE_NAME, &to_json_bytes(&dto)?)?;
    session.create_directory(&base, SHEETS_DIRECTORY_NAME)?;
    session.create_directory(&base, ASSETS_DIRECTORY_NAME)?;
    session.insert_document(
        *document.document_id(),
        DocumentRecord {
            directory_name,
            writable: true,
            sheets: BTreeMap::new(),
        },
    );
    Ok(DocumentSnapshot {
        document: dto,
        sheets: Vec::new(),
        issues: Vec::new(),
    })
}

pub fn load_document(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: &str,
) -> ApplicationResult<DocumentSnapshot> {
    let session = sessions.session_mut(project_id)?;
    let document_id = DocumentId::parse(document_id)?;
    let base = session.document_base(&document_id)?;
    let document_file = join_path(&base, DOCUMENT_FILE_NAME);

    let mut issues: Vec<LoadIssue> = Vec::new();
    let loaded = load_document_file(session, &document_file, &mut issues);
    let document = match loaded.entity {
        Ok(document) if *document.document_id() == document_id => document,
        Ok(document) => {
            session.document_mut(&document_id)?.writable = false;
            return Err(ApplicationError::entity_not_found(format!(
                "{document_file} now holds document {}, not {document_id}",
                document.document_id()
            )));
        }
        Err(error) => {
            // A Document that cannot be read now must not be overwritten, even if it loaded before.
            session.document_mut(&document_id)?.writable = false;
            return Err(error);
        }
    };

    report_leftover_temp_files(session, &base, &mut issues);
    report_leftover_temp_files(session, &assets_path(&base), &mut issues);
    let sheets_container = join_path(&base, SHEETS_DIRECTORY_NAME);
    let scans = scan_sheet_directories(session, &sheets_container, &mut issues);
    let accepted = reconcile_children(
        scans,
        document.sheet_order(),
        &sheets_container,
        &document_file,
        "sheet",
        &mut issues,
    );

    let mut sheet_records = BTreeMap::new();
    let mut entries = Vec::with_capacity(accepted.len());
    let mut effective_order = Vec::with_capacity(accepted.len());
    let mut loaded_sheets: Vec<(String, String, &Sheet)> = Vec::new();
    for child in &accepted {
        let sheet_directory = join_path(&sheets_container, &child.directory_name);
        report_leftover_temp_files(session, &sheet_directory, &mut issues);
        report_leftover_temp_files(
            session,
            &join_path(&sheet_directory, BLOCKS_DIRECTORY_NAME),
            &mut issues,
        );
        if let Some(sheet) = &child.payload {
            check_sheet_content(session, &base, &child.directory_name, sheet, &mut issues)?;
            loaded_sheets.push((
                join_path(
                    &sheet_directory,
                    crate::infrastructure::file_format::constants::SHEET_FILE_NAME,
                ),
                child.id.to_string(),
                sheet,
            ));
        }
        sheet_records.insert(
            child.id,
            SheetRecord {
                directory_name: child.directory_name.clone(),
                writable: child.payload.is_some(),
            },
        );
        effective_order.push(child.id.to_string());
        entries.push(SheetSnapshot {
            sheet_id: child.id.to_string(),
            name: child.name.clone(),
            state: if child.payload.is_some() {
                EntityState::Loaded
            } else {
                EntityState::LoadFailed
            },
            sheet: child.payload.as_ref().map(SheetDto::from_domain),
        });
    }
    let borrowed: Vec<(&str, &str, &Sheet)> = loaded_sheets
        .iter()
        .map(|(path, id, sheet)| (path.as_str(), id.as_str(), *sheet))
        .collect();
    check_duplicate_block_ids(&borrowed, &mut issues);

    let mut document_dto = DocumentDto::from_domain(&document);
    document_dto.sheet_order = effective_order;
    let record = session.document_mut(&document_id)?;
    record.writable = true;
    record.sheets = sheet_records;
    Ok(DocumentSnapshot {
        document: document_dto,
        sheets: entries,
        issues,
    })
}

pub fn save_document(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document: &DocumentDto,
) -> ApplicationResult<SaveResult> {
    let session = sessions.session_mut(project_id)?;
    let document = document.to_domain()?;
    let record = session.document(document.document_id())?;
    if !record.writable {
        return Err(ApplicationError::not_writable(format!(
            "document {} did not load and cannot be written",
            document.document_id()
        )));
    }
    let base = session.document_base(document.document_id())?;
    let bytes = to_json_bytes(&DocumentDto::from_domain(&document))?;
    let outcome = session.write_file(&base, DOCUMENT_FILE_NAME, &bytes)?;
    Ok(SaveResult {
        written: outcome == WriteOutcome::Written,
    })
}
