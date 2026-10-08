//! Thin Tauri commands (docs/architecture.md §6.2). Each one parses its arguments, locks the
//! session state and calls the Application layer; no logic lives here. `import_asset` is
//! not a command: images enter through `import_dropped_images` (the dropped paths never
//! reach the Frontend) or `copy_asset_to_document`.

mod asset_protocol;
mod drag_drop;
mod folder_picker;
mod window_close;

use std::sync::{Arc, Mutex, PoisonError};

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::application::asset_import::{
    copy_asset_to_document as copy_asset, import_dropped_images as import_dropped, CopiedAsset,
    DropImportResult,
};
use crate::application::block_content_operations as block_content;
use crate::application::document_operations as documents;
use crate::application::dropped_files::DroppedFilesState;
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::folder_operations as folders;
use crate::application::folder_selection::{
    resolve_selection, select_project_folder as select_folder, FolderPicker, FolderSelection,
    FolderSelectionState,
};
use crate::application::local_state::operations::{AppSettings, LocalState, SheetViewportResult};
use crate::application::open_request::{self, OpenedRequest, PendingOpenRequests};
use crate::application::project_operations as projects;
use crate::application::session::ProjectSessions;
use crate::application::sheet_operations as sheets;
use crate::application::snapshot::{
    DocumentSnapshot, FolderSnapshot, ProjectSnapshot, SaveResult, SheetSnapshot,
};
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::file_format::dto::{
    parse_dto, DocumentDto, FolderDto, ProjectDto, SheetDto,
};

/// Every exposed command. `build.rs` (app manifest) and `capabilities/default.json`
/// must list exactly these; `tests/command_permissions.rs` enforces that.
pub const COMMAND_NAMES: [&str; 33] = [
    "select_project_folder",
    "create_project",
    "open_project",
    "save_project",
    "create_folder",
    "save_folder",
    "move_entry",
    "delete_folder",
    "create_document",
    "load_document",
    "close_document",
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
    "set_auto_save",
    "set_project_tree_width",
    "get_sheet_viewport",
    "save_sheet_viewport",
    "import_dropped_images",
    "copy_asset_to_document",
    "subscribe_drop_notifications",
    "subscribe_close_requests",
    "confirm_window_close",
    "take_open_request",
];

pub use asset_protocol::{respond_to_asset_request, ASSET_URL_SCHEME};
pub use drag_drop::{DropNotification, DropSubscriber};
pub use folder_picker::DialogFolderPicker;
pub use window_close::{
    confirm_close, handle_close_requested, CloseNotification, CloseNotificationSink,
    CloseRequestHub, CloseRequestSubscriber,
};

/// The one window event handler (registered in `run`). Each event kind has its own thin
/// handler; the drag & drop branch is unchanged.
pub fn handle_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::DragDrop(drag_drop) => {
            drag_drop::handle_drag_drop_event(window, drag_drop);
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            let hub = window.state::<CloseRequestSubscriber>();
            handle_close_requested(&hub, || api.prevent_close());
        }
        _ => {}
    }
}

/// The folder dialog as managed state. Production registers the real dialog-backed picker;
/// integration tests register a fake, so the command itself runs unchanged in both.
pub type SharedFolderPicker = Arc<dyn FolderPicker>;

type SessionState<'a> = State<'a, Mutex<ProjectSessions>>;
type FolderSelectionStateHandle<'a> = State<'a, Mutex<FolderSelectionState>>;

/// The Frontend only receives a fixed description per error kind, so the full internal
/// error (with paths) goes to the terminal here instead, for developers. Not a log file:
/// nothing is persisted.
fn log_failure<T>(command_result: ApplicationResult<T>) -> ApplicationResult<T> {
    if let Err(error) = &command_result {
        eprintln!("command failed: {error}");
    }
    command_result
}

fn with_sessions<T>(
    state: &SessionState<'_>,
    operation: impl FnOnce(&mut ProjectSessions) -> ApplicationResult<T>,
) -> Result<T, ApplicationError> {
    // A panic in another command must not brick every later command; the session data is
    // still structurally valid, and writes are re-validated against the filesystem anyway.
    let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
    log_failure(operation(&mut sessions))
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
    parent_folder_id: Option<String>,
) -> Result<DocumentSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        documents::create_document(
            sessions,
            &project_id,
            &document_id,
            &name,
            parent_folder_id.as_deref(),
        )
    })
}

#[tauri::command]
pub fn create_folder(
    state: SessionState<'_>,
    project_id: String,
    parent_folder_id: Option<String>,
    folder_id: String,
    name: String,
) -> Result<FolderSnapshot, ApplicationError> {
    with_sessions(&state, |sessions| {
        folders::create_folder(
            sessions,
            &project_id,
            parent_folder_id.as_deref(),
            &folder_id,
            &name,
        )
    })
}

#[tauri::command]
pub fn save_folder(
    state: SessionState<'_>,
    project_id: String,
    folder: Value,
) -> Result<SaveResult, ApplicationError> {
    with_sessions(&state, |sessions| {
        let folder: FolderDto = parse_dto(folder)?;
        folders::save_folder(sessions, &project_id, &folder)
    })
}

#[tauri::command]
pub fn move_entry(
    state: SessionState<'_>,
    project_id: String,
    entry_id: String,
    target_parent_folder_id: Option<String>,
) -> Result<(), ApplicationError> {
    with_sessions(&state, |sessions| {
        folders::move_entry(
            sessions,
            &project_id,
            &entry_id,
            target_parent_folder_id.as_deref(),
        )
    })
}

#[tauri::command]
pub fn delete_folder(
    state: SessionState<'_>,
    project_id: String,
    folder_id: String,
) -> Result<(), ApplicationError> {
    with_sessions(&state, |sessions| {
        folders::delete_folder(sessions, &project_id, &folder_id)
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
pub fn close_document(
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
) -> Result<(), ApplicationError> {
    with_sessions(&state, |sessions| {
        documents::close_document(sessions, &project_id, &document_id)
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
    log_failure(operation(state.inner()))
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
pub fn set_auto_save<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, ApplicationError> {
    with_local_state(&app, |local_state| local_state.set_auto_save(enabled))
}

#[tauri::command]
pub fn set_project_tree_width<R: Runtime>(
    app: AppHandle<R>,
    width: serde_json::Number,
) -> Result<AppSettings, ApplicationError> {
    with_local_state(&app, |local_state| {
        local_state.set_project_tree_width(&width)
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
    tauri::async_runtime::spawn_blocking(move || log_failure(operation()))
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

/// Replaces the channel that receives drag and drop notifications (latest subscription wins).
#[tauri::command]
pub fn subscribe_drop_notifications(
    subscriber: State<'_, DropSubscriber>,
    channel: Channel<DropNotification>,
) {
    subscriber.replace(channel);
}

/// Registers the channel for close requests and returns the token the notifications carry
/// (docs/architecture.md §10.1).
#[tauri::command]
pub fn subscribe_close_requests(
    subscriber: State<'_, CloseRequestSubscriber>,
    channel: Channel<CloseNotification>,
) -> String {
    subscriber.subscribe(channel)
}

#[tauri::command]
pub fn confirm_window_close<R: Runtime>(
    subscriber: State<'_, CloseRequestSubscriber>,
    window: tauri::Window<R>,
    subscription_token: String,
) -> Result<(), ApplicationError> {
    log_failure(confirm_close(&subscriber, &window, &subscription_token))
}

/// The request a launch argument left for this window, consumed on the first call. The
/// caller is identified by its window label, so a window can only take its own request.
#[tauri::command]
pub fn take_open_request<R: Runtime>(
    window: tauri::Window<R>,
    pending: State<'_, Mutex<PendingOpenRequests>>,
    state: SessionState<'_>,
) -> Result<Option<OpenedRequest>, ApplicationError> {
    with_sessions(&state, |sessions| {
        open_request::take_open_request(&pending, sessions, window.label())
    })
}
