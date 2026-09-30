//! Thin Tauri commands (docs/architecture.md §6.2). Each one parses its arguments, locks the
//! session state and calls the Application layer; no logic lives here. `import_asset` is
//! intentionally absent until Phase 5.

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use serde_json::Value;
use tauri::State;

use crate::application::block_content_operations as block_content;
use crate::application::document_operations as documents;
use crate::application::error::{ApplicationError, ApplicationResult};
use crate::application::project_operations as projects;
use crate::application::session::ProjectSessions;
use crate::application::sheet_operations as sheets;
use crate::application::snapshot::{
    DocumentSnapshot, EntryPointSnapshot, ProjectSnapshot, SaveResult, SheetSnapshot,
};
use crate::infrastructure::file_format::dto::{parse_dto, DocumentDto, ProjectDto, SheetDto};

/// Every exposed command. `build.rs` (app manifest) and `capabilities/default.json`
/// must list exactly these; `tests/command_permissions.rs` enforces that.
pub const COMMAND_NAMES: [&str; 13] = [
    "create_project",
    "open_project",
    "open_entry_point",
    "save_project",
    "create_document",
    "load_document",
    "save_document",
    "create_sheet",
    "save_sheet",
    "create_block_content",
    "read_block_content",
    "write_block_content",
    "delete_block_content",
];

type SessionState<'a> = State<'a, Mutex<ProjectSessions>>;

fn with_sessions<T>(
    state: &SessionState<'_>,
    operation: impl FnOnce(&mut ProjectSessions) -> ApplicationResult<T>,
) -> Result<T, ApplicationError> {
    // A panic in another command must not brick every later command; the session data is
    // still structurally valid, and writes are re-validated against the filesystem anyway.
    let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
    operation(&mut sessions)
}

#[tauri::command]
pub fn create_project(
    state: SessionState<'_>,
    project_root: String,
    name: String,
) -> Result<ProjectSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        projects::create_project(sessions, Path::new(&project_root), &name)
    })
}

#[tauri::command]
pub fn open_project(
    state: SessionState<'_>,
    project_root: String,
) -> Result<ProjectSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        projects::open_project(sessions, Path::new(&project_root))
    })
}

#[tauri::command]
pub fn open_entry_point(
    state: SessionState<'_>,
    entry_point_path: String,
) -> Result<EntryPointSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        projects::open_entry_point(sessions, Path::new(&entry_point_path))
            .map(|opened| opened.snapshot)
    })
}

#[tauri::command]
pub fn save_project(
    state: SessionState<'_>,
    project_id: String,
    project: Value,
) -> Result<SaveResult, ApplicationError> {
    with_sessions(&state, |sessions| {
        let project: ProjectDto = parse_dto(project)?;
        projects::save_project(sessions, &project_id, &project)
    })
}

#[tauri::command]
pub fn create_document(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    name: String,
) -> Result<DocumentSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        documents::create_document(sessions, &project_id, &document_id, &name)
    })
}

#[tauri::command]
pub fn load_document(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
) -> Result<DocumentSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        documents::load_document(sessions, &project_id, &document_id)
    })
}

#[tauri::command]
pub fn save_document(
    state: SessionState<'_>,
    project_id: String,
    document: Value,
) -> Result<SaveResult, ApplicationError> {
    with_sessions(&state, |sessions| {
        let document: DocumentDto = parse_dto(document)?;
        documents::save_document(sessions, &project_id, &document)
    })
}

#[tauri::command]
pub fn create_sheet(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet_id: String,
    name: String,
) -> Result<SheetSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        sheets::create_sheet(sessions, &project_id, &document_id, &sheet_id, &name)
    })
}

#[tauri::command]
pub fn save_sheet(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet: Value,
) -> Result<SaveResult, ApplicationError> {
    with_sessions(&state, |sessions| {
        let sheet: SheetDto = parse_dto(sheet)?;
        sheets::save_sheet(sessions, &project_id, &document_id, &sheet)
    })
}

#[tauri::command]
pub fn create_block_content(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet_id: String,
    block_type: String,
    text: String,
) -> Result<String, ApplicationError> {
    with_sessions(&state, |sessions| {
        block_content::create_block_content(
            sessions,
            &project_id,
            &document_id,
            &sheet_id,
            &block_type,
            &text,
        )
    })
}

#[tauri::command]
pub fn read_block_content(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    content_path: String,
) -> Result<String, ApplicationError> {
    with_sessions(&state, |sessions| {
        block_content::read_block_content(sessions, &project_id, &document_id, &content_path)
    })
}

#[tauri::command]
pub fn write_block_content(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    content_path: String,
    text: String,
) -> Result<SaveResult, ApplicationError> {
    with_sessions(&state, |sessions| {
        block_content::write_block_content(
            sessions,
            &project_id,
            &document_id,
            &content_path,
            &text,
        )
    })
}

#[tauri::command]
pub fn delete_block_content(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    content_path: String,
) -> Result<(), ApplicationError> {
    with_sessions(&state, |sessions| {
        block_content::delete_block_content(sessions, &project_id, &document_id, &content_path)
    })
}
