//! Thin Tauri commands (docs/architecture.md §6.2). Each one parses its arguments, locks the
//! session state and calls the Application layer; no logic lives here. `import_asset` is
//! not a command: images enter through `import_dropped_images` (the dropped paths never
//! reach the Frontend) or `copy_asset_to_document`.

mod asset_protocol;
mod drag_drop;
mod folder_picker;

use std::sync::{Arc, Mutex, PoisonError};

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::application::asset_import::{
    copy_asset_to_document as copy_asset, import_dropped_images as import_dropped, CopiedAsset,
    DropImportResult,
};
use crate::application::block_content_operations as block_content;
use crate::application::document_operations as documents;
use crate::application::dropped_files::DroppedFilesState;
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::folder_selection::{
    resolve_selection, select_project_folder as select_folder, FolderPicker, FolderSelection,
    FolderSelectionState,
};
use crate::application::local_state::operations::{AppSettings, LocalState, SheetViewportResult};
use crate::application::project_operations as projects;
use crate::application::session::ProjectSessions;
use crate::application::sheet_operations as sheets;
use crate::application::snapshot::{DocumentSnapshot, ProjectSnapshot, SaveResult, SheetSnapshot};
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::file_format::dto::{parse_dto, DocumentDto, ProjectDto, SheetDto};

/// Every exposed command. `build.rs` (app manifest) and `capabilities/default.json`
/// must list exactly these; `tests/command_permissions.rs` enforces that.
pub const COMMAND_NAMES: [&str; 22] = [
    "select_project_folder",
    "create_project",
    "open_project",
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
    "restore_block_content",
    "delete_sheet",
    "delete_document",
    "get_app_settings",
    "set_theme_preference",
    "get_sheet_viewport",
    "save_sheet_viewport",
    "import_dropped_images",
    "copy_asset_to_document",
];

pub use asset_protocol::{respond_to_asset_request, ASSET_URL_SCHEME};
pub use drag_drop::{handle_window_event, DRAG_STATE_EVENT, FILES_DROPPED_EVENT};
pub use folder_picker::DialogFolderPicker;

/// The folder dialog as managed state. Production registers the real dialog-backed picker;
/// integration tests register a fake, so the command itself runs unchanged in both.
pub type SharedFolderPicker = Arc<dyn FolderPicker>;

type SessionState<'a> = State<'a, Mutex<ProjectSessions>>;
type FolderSelectionStateHandle<'a> = State<'a, Mutex<FolderSelectionState>>;

fn with_sessions<T>(
    state: &SessionState<'_>,
    operation: impl FnOnce(&mut ProjectSessions) -> ApplicationResult<T>,
) -> Result<T, ApplicationError> {
    // A panic in another command must not brick every later command; the session data is
    // still structurally valid, and writes are re-validated against the filesystem anyway.
    let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
    operation(&mut sessions)
}

/// Async so it never runs on the main thread, and the blocking dialog runs on a thread of
/// the blocking pool so no async worker is held for as long as the user keeps it open.
/// Neither state lock is held while the dialog is open (the selection lock is taken only
/// after it closed); the two locks are never held at the same time anywhere.
#[tauri::command]
pub async fn select_project_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<FolderSelection, ApplicationError> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app.try_state::<SharedFolderPicker>().ok_or_else(|| {
            ApplicationError::new(ErrorKind::DialogFailed, "no folder picker is registered")
        })?;
        let selections = app.state::<Mutex<FolderSelectionState>>();
        select_folder(picker.inner().as_ref(), &selections)
    })
    .await
    .map_err(|error| {
        ApplicationError::new(
            ErrorKind::DialogFailed,
            format!("folder dialog task failed: {error}"),
        )
    })?
}

#[tauri::command]
pub fn create_project(
    state: SessionState<'_>,
    selections: FolderSelectionStateHandle<'_>,
    selection_id: String,
    name: String,
) -> Result<ProjectSnapshot, ApplicationError> {
    let project_root = resolve_selection(&selections, &selection_id)?;
    with_sessions(&state, |sessions| {
        projects::create_project(sessions, &project_root, &name)
    })
}

#[tauri::command]
pub fn open_project(
    state: SessionState<'_>,
    selections: FolderSelectionStateHandle<'_>,
    selection_id: String,
) -> Result<ProjectSnapshot, ApplicationError> {
    let project_root = resolve_selection(&selections, &selection_id)?;
    with_sessions(&state, |sessions| {
        projects::open_project(sessions, &project_root)
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

#[tauri::command]
pub fn restore_block_content(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    block_type: String,
    content_path: String,
    text: String,
) -> Result<(), ApplicationError> {
    with_sessions(&state, |sessions| {
        block_content::restore_block_content(
            sessions,
            &project_id,
            &document_id,
            &block_type,
            &content_path,
            &text,
        )
    })
}

#[tauri::command]
pub fn delete_sheet(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet_id: String,
) -> Result<(), ApplicationError> {
    with_sessions(&state, |sessions| {
        sheets::delete_sheet(sessions, &project_id, &document_id, &sheet_id)
    })
}

#[tauri::command]
pub fn delete_document(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
) -> Result<(), ApplicationError> {
    with_sessions(&state, |sessions| {
        documents::delete_document(sessions, &project_id, &document_id)
    })
}

/// The directories are registered at startup (`run`) or by the test harness. A missing
/// registration is a wiring bug, reported as an error instead of a panic.
fn with_local_state<R: Runtime, T>(
    app: &AppHandle<R>,
    operation: impl FnOnce(&LocalState) -> ApplicationResult<T>,
) -> Result<T, ApplicationError> {
    let state = app.try_state::<LocalState>().ok_or_else(|| {
        ApplicationError::persistence(
            PersistenceErrorKind::IoError,
            "the local state directories are not registered",
        )
    })?;
    operation(state.inner())
}

#[tauri::command]
pub fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> Result<AppSettings, ApplicationError> {
    with_local_state(&app, |local_state| Ok(local_state.get_app_settings()))
}

#[tauri::command]
pub fn set_theme_preference<R: Runtime>(
    app: AppHandle<R>,
    theme_preference: String,
) -> Result<AppSettings, ApplicationError> {
    with_local_state(&app, |local_state| {
        local_state.set_theme_preference(&theme_preference)
    })
}

#[tauri::command]
pub fn get_sheet_viewport<R: Runtime>(
    app: AppHandle<R>,
    project_id: String,
    document_id: String,
    sheet_id: String,
) -> Result<SheetViewportResult, ApplicationError> {
    with_local_state(&app, |local_state| {
        local_state.get_sheet_viewport(&project_id, &document_id, &sheet_id)
    })
}

#[tauri::command]
pub fn save_sheet_viewport<R: Runtime>(
    app: AppHandle<R>,
    project_id: String,
    document_id: String,
    sheet_id: String,
    viewport: Value,
) -> Result<(), ApplicationError> {
    with_local_state(&app, |local_state| {
        local_state.save_sheet_viewport(&project_id, &document_id, &sheet_id, viewport)
    })
}

/// Asset files can be large (up to `ASSET_MAX_BYTES` each), so these two commands run on the
/// blocking pool instead of the main thread, like the folder dialog.
async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> ApplicationResult<T> + Send + 'static,
) -> Result<T, ApplicationError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            ApplicationError::persistence(
                PersistenceErrorKind::IoError,
                format!("asset task failed: {error}"),
            )
        })?
}

/// `drop_id` comes from the `files dropped` event; the Frontend never passes a path.
#[tauri::command]
pub async fn import_dropped_images<R: Runtime>(
    app: AppHandle<R>,
    drop_id: String,
    project_id: String,
    document_id: String,
) -> Result<DropImportResult, ApplicationError> {
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        let drops = app.state::<Mutex<DroppedFilesState>>();
        import_dropped(&sessions, &drops, &drop_id, &project_id, &document_id)
    })
    .await
}

#[tauri::command]
pub async fn copy_asset_to_document<R: Runtime>(
    app: AppHandle<R>,
    project_id: String,
    source_document_id: String,
    content_path: String,
    target_document_id: String,
) -> Result<CopiedAsset, ApplicationError> {
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        copy_asset(
            &sessions,
            &project_id,
            &source_document_id,
            &content_path,
            &target_document_id,
        )
    })
    .await
}
