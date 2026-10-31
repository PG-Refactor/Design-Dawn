//! Thin Tauri commands. Each one parses its arguments, locks the
//! session state and calls the Application layer; no logic lives here. `import_asset` is
//! not a command: images enter through `import_dropped_images` (the dropped paths never
//! reach the Frontend) or `copy_asset_to_document`.

mod app_channel;
mod asset_protocol;
mod drag_drop;
mod external_watch;
mod folder_picker;
mod open_dispatch;
mod window_close;
mod window_size;

use std::sync::{Arc, Mutex, PoisonError};

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State, Window};

use crate::application::asset_import::{
    copy_asset_to_document as copy_asset, import_dropped_images as import_dropped, CopiedAsset,
    DropImportResult,
};
use crate::application::block_content_operations::{self as block_content, BlockContentComparison};
use crate::application::document_operations as documents;
use crate::application::dropped_files::DroppedFilesState;
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::external_change::{self, ExternalChanges};
use crate::application::folder_operations as folders;
use crate::application::folder_selection::{
    resolve_selection, select_project_folder as select_folder, FolderPicker, FolderSelection,
    FolderSelectionState,
};
use crate::application::format_update::{self, FormatUpdateResult};
use crate::application::git_commit;
use crate::application::git_discard;
use crate::application::git_history;
use crate::application::git_operations::{self, GitStatusResult};
use crate::application::git_remote;
use crate::application::load_issue_repair::{self, RepairAction, RepairIssueRef, RepairOutcome};
use crate::application::local_state::operations::{AppSettings, LocalState, SheetViewportResult};
use crate::application::open_request::{self, OpenRequest, OpenedRequest, PendingOpenRequests};
use crate::application::project_operations as projects;
use crate::application::session::ProjectSessions;
use crate::application::sheet_operations as sheets;
use crate::application::snapshot::{
    DocumentSnapshot, FolderSnapshot, ProjectSnapshot, SaveResult, SheetSnapshot,
};
use crate::application::window_binding::{
    close_window_project, create_project_in_window, open_project_in_window, release_window_project,
    reload_project_in_window, WindowOpenError,
};
use crate::application::window_registry::WindowRegistry;
use crate::domain::entity_id::ProjectId;
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::file_format::dto::{
    parse_dto, DocumentDto, FolderDto, ProjectDto, SheetDto,
};

/// Every exposed command. `build.rs` (app manifest) and `capabilities/default.json`
/// must list exactly these; `tests/command_permissions.rs` enforces that.
pub const COMMAND_NAMES: [&str; 59] = [
    "select_project_folder",
    "create_project",
    "open_project",
    "reload_project",
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
    "set_language_preference",
    "set_text_size",
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
    "close_project",
    "subscribe_app_requests",
    "ack_open_request",
    "open_project_in_new_window",
    "git_status",
    "git_stage",
    "git_unstage",
    "git_discard_impact",
    "git_discard",
    "git_diff",
    "git_commit",
    "git_undo_last_commit",
    "git_history",
    "git_fetch",
    "git_pull",
    "git_push",
    "git_publish",
    "git_remotes",
    "check_external_changes",
    "accept_disk_state",
    "compare_block_content",
    "repair_load_issue",
    "update_outdated_files",
];

pub use app_channel::{AppNotification, AppNotificationSink, AppRequestHub, AppRequestSubscriber};
pub use asset_protocol::{respond_to_asset_request, ASSET_URL_SCHEME};
pub use drag_drop::{DropNotification, DropSubscriber};
pub use external_watch::install_external_change_watching;
pub use folder_picker::DialogFolderPicker;
pub use open_dispatch::{
    dispatch_in_background, handle_second_launch, placement_following, reroute_unacknowledged,
    route_external_request, route_open_request, with_routing_state, PlacementSource, RouteOutcome,
    RoutingState, TauriWindowHost, WindowGeometry, WindowHost, WindowPlacement,
};
pub use window_close::{
    confirm_close, handle_close_requested, CloseNotification, CloseNotificationSink,
    CloseRequestHub, CloseRequestSubscriber,
};
pub use window_size::apply_startup_window_size;

/// The one window event handler (registered in `run`). Each event kind has its own thin
/// handler; the drag & drop branch is unchanged.
pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::DragDrop(drag_drop) => {
            drag_drop::handle_drag_drop_event(window, drag_drop);
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            let hub = window.state::<CloseRequestSubscriber>();
            handle_close_requested(&hub, window.label(), || api.prevent_close());
        }
        tauri::WindowEvent::Focused(true) => {
            lock_registry(&window.state::<Mutex<WindowRegistry>>()).touch_focus(window.label());
        }
        tauri::WindowEvent::Destroyed => release_window_state(window),
        _ => {}
    }
}

fn lock_registry(registry: &Mutex<WindowRegistry>) -> std::sync::MutexGuard<'_, WindowRegistry> {
    // Plain maps of labels and IDs, kept consistent by single operations.
    registry.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Everything the Rust side keeps for a window that no longer exists: its Project binding
/// and session, and every per-window state. `try_state`: during app shutdown the managed
/// state may already be gone, and there is nothing left to release then.
fn release_window_state<R: Runtime>(window: &Window<R>) {
    let label = window.label();
    if let (Some(sessions), Some(registry)) = (
        window.try_state::<Mutex<ProjectSessions>>(),
        window.try_state::<Mutex<WindowRegistry>>(),
    ) {
        // Sessions first, then the registry (the order every command uses).
        let mut sessions = sessions.lock().unwrap_or_else(PoisonError::into_inner);
        release_window_project(&mut sessions, &mut lock_registry(&registry), label);
    }
    if let Some(drops) = window.try_state::<Mutex<DroppedFilesState>>() {
        drops
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .discard_window(label);
    }
    if let Some(selections) = window.try_state::<Mutex<FolderSelectionState>>() {
        selections
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .discard_window(label);
    }
    if let Some(pending) = window.try_state::<Mutex<PendingOpenRequests>>() {
        pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .discard(label);
    }
    if let Some(subscriber) = window.try_state::<DropSubscriber>() {
        subscriber.discard_window(label);
    }
    if let Some(hub) = window.try_state::<CloseRequestSubscriber>() {
        hub.discard_window(label);
    }
    // Last, after the window's Project was released: what it never acknowledged goes to
    // another window or a new one. This runs on the main thread inside the event handler,
    // where a window must not be created, so the routing runs on the blocking pool.
    if let Some(hub) = window.try_state::<AppRequestSubscriber>() {
        let lost = hub.discard_window(label);
        if !lost.is_empty() {
            dispatch_in_background(window.app_handle(), move |state, host| {
                reroute_unacknowledged(state, host, lost);
            });
        }
    }
}

/// Brings another window forward (unminimize + focus). Failures are only logged: the caller
/// reports `projectOpenInOtherWindow` either way.
fn bring_window_to_front<R: Runtime>(window: &Window<R>, target_label: &str) {
    let Some(target) = window.app_handle().get_webview_window(target_label) else {
        eprintln!("window {target_label} to bring forward does not exist");
        return;
    };
    if let Err(error) = target.unminimize() {
        eprintln!("failed to restore window {target_label}: {error}");
    }
    if let Err(error) = target.set_focus() {
        eprintln!("failed to focus window {target_label}: {error}");
    }
}

/// Turns the outcome of opening a Project into the command result. The other window is
/// brought forward here, after the state locks were released.
fn settle_open<R: Runtime, T>(
    window: &Window<R>,
    outcome: Result<T, WindowOpenError>,
) -> Result<T, ApplicationError> {
    if let Err(WindowOpenError::OpenInOtherWindow { window_label }) = &outcome {
        bring_window_to_front(window, window_label);
    }
    log_failure(outcome.map_err(ApplicationError::from))
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

/// The one check that keeps a window to its own Project: the caller must have `project_id`
/// open. An unbound or foreign Project is `projectNotOpen`, like an unknown one. The
/// registry lock is released before the sessions lock is taken.
fn ensure_window_project<R: Runtime>(
    window: &Window<R>,
    project_id: &str,
) -> ApplicationResult<()> {
    let project_id = ProjectId::parse(project_id)?;
    let registry = window.state::<Mutex<WindowRegistry>>();
    let outcome = lock_registry(&registry).ensure_bound(window.label(), &project_id);
    log_failure(outcome)
}

fn with_project_sessions<R: Runtime, T>(
    window: &Window<R>,
    state: &SessionState<'_>,
    project_id: &str,
    operation: impl FnOnce(&mut ProjectSessions) -> ApplicationResult<T>,
) -> Result<T, ApplicationError> {
    ensure_window_project(window, project_id)?;
    with_sessions(state, operation)
}

/// Async so it never runs on the main thread, and the blocking dialog runs on a thread of
/// the blocking pool so no async worker is held for as long as the user keeps it open.
/// Neither state lock is held while the dialog is open (the selection lock is taken only
/// after it closed); the two locks are never held at the same time anywhere.
#[tauri::command]
pub async fn select_project_folder<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
) -> Result<FolderSelection, ApplicationError> {
    let window_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app.try_state::<SharedFolderPicker>().ok_or_else(|| {
            ApplicationError::new(ErrorKind::DialogFailed, "no folder picker is registered")
        })?;
        let selections = app.state::<Mutex<FolderSelectionState>>();
        select_folder(picker.inner().as_ref(), &selections, &window_label)
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
pub fn create_project<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    registry: State<'_, Mutex<WindowRegistry>>,
    selections: FolderSelectionStateHandle<'_>,
    selection_id: String,
    name: String,
) -> Result<ProjectSnapshot, ApplicationError> {
    let project_root = resolve_selection(&selections, window.label(), &selection_id)?;
    let outcome = {
        let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
        create_project_in_window(
            &mut sessions,
            &mut lock_registry(&registry),
            window.label(),
            &project_root,
            &name,
        )
    };
    settle_open(&window, outcome)
}

#[tauri::command]
pub fn open_project<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    registry: State<'_, Mutex<WindowRegistry>>,
    selections: FolderSelectionStateHandle<'_>,
    selection_id: String,
) -> Result<ProjectSnapshot, ApplicationError> {
    let project_root = resolve_selection(&selections, window.label(), &selection_id)?;
    let outcome = {
        let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
        open_project_in_window(
            &mut sessions,
            &mut lock_registry(&registry),
            window.label(),
            &project_root,
        )
    };
    settle_open(&window, outcome)
}

/// Reads the Project this window has open again from its own root on disk (after files
/// changed underneath, e.g. a Git discard). The Frontend names the Project only by id; no
/// path crosses IPC. Behaves like `open_project` of the same Project.
#[tauri::command]
pub fn reload_project<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    registry: State<'_, Mutex<WindowRegistry>>,
    project_id: String,
) -> Result<ProjectSnapshot, ApplicationError> {
    let outcome = ProjectId::parse(&project_id)
        .map_err(ApplicationError::from)
        .map_err(WindowOpenError::from)
        .and_then(|project_id| {
            let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
            reload_project_in_window(
                &mut sessions,
                &mut lock_registry(&registry),
                window.label(),
                &project_id,
            )
        });
    settle_open(&window, outcome)
}

/// The window closed its Project: unbinds it and drops its session.
#[tauri::command]
pub fn close_project<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    registry: State<'_, Mutex<WindowRegistry>>,
) {
    let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
    close_window_project(&mut sessions, &mut lock_registry(&registry), window.label());
}

#[tauri::command]
pub fn save_project<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    project: Value,
) -> Result<SaveResult, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        let project: ProjectDto = parse_dto(project)?;
        projects::save_project(sessions, &project_id, &project)
    })
}

#[tauri::command]
pub fn create_document<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    name: String,
    parent_folder_id: Option<String>,
) -> Result<DocumentSnapshot, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
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
pub fn create_folder<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    parent_folder_id: Option<String>,
    folder_id: String,
    name: String,
) -> Result<FolderSnapshot, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
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
pub fn save_folder<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    folder: Value,
) -> Result<SaveResult, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        let folder: FolderDto = parse_dto(folder)?;
        folders::save_folder(sessions, &project_id, &folder)
    })
}

#[tauri::command]
pub fn move_entry<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    entry_id: String,
    target_parent_folder_id: Option<String>,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        folders::move_entry(
            sessions,
            &project_id,
            &entry_id,
            target_parent_folder_id.as_deref(),
        )
    })
}

#[tauri::command]
pub fn delete_folder<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    folder_id: String,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        folders::delete_folder(sessions, &project_id, &folder_id)
    })
}

#[tauri::command]
pub fn load_document<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
) -> Result<DocumentSnapshot, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        documents::load_document(sessions, &project_id, &document_id)
    })
}

#[tauri::command]
pub fn close_document<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        documents::close_document(sessions, &project_id, &document_id)
    })
}

#[tauri::command]
pub fn save_document<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document: Value,
) -> Result<SaveResult, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        let document: DocumentDto = parse_dto(document)?;
        documents::save_document(sessions, &project_id, &document)
    })
}

#[tauri::command]
pub fn create_sheet<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet_id: String,
    name: String,
) -> Result<SheetSnapshot, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        sheets::create_sheet(sessions, &project_id, &document_id, &sheet_id, &name)
    })
}

#[tauri::command]
pub fn save_sheet<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet: Value,
) -> Result<SaveResult, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        let sheet: SheetDto = parse_dto(sheet)?;
        sheets::save_sheet(sessions, &project_id, &document_id, &sheet)
    })
}

#[tauri::command]
pub fn create_block_content<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet_id: String,
    block_type: String,
    text: String,
) -> Result<String, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
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
pub fn read_block_content<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    content_path: String,
) -> Result<String, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        block_content::read_block_content(sessions, &project_id, &document_id, &content_path)
    })
}

#[tauri::command]
pub fn write_block_content<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    content_path: String,
    text: String,
) -> Result<SaveResult, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        block_content::write_block_content(
            sessions,
            &project_id,
            &document_id,
            &content_path,
            &text,
        )
    })
}

/// Compares a Block's committed text (sent by the Frontend; drafts are not part of it) with
/// the file on disk, for the "compare" choice of an external change. Read-only.
#[tauri::command]
pub fn compare_block_content<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    content_path: String,
    text: String,
) -> Result<BlockContentComparison, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        block_content::compare_block_content(
            sessions,
            &project_id,
            &document_id,
            &content_path,
            &text,
        )
    })
}

#[tauri::command]
pub fn delete_block_content<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    content_path: String,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        block_content::delete_block_content(sessions, &project_id, &document_id, &content_path)
    })
}

#[tauri::command]
pub fn restore_block_content<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    block_type: String,
    content_path: String,
    text: String,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
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

/// Compares the Project's recorded files with the disk and reports what changed behind the
/// app's back. Read-only: nothing is saved or re-recorded.
#[tauri::command]
pub fn check_external_changes<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
) -> Result<ExternalChanges, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        external_change::check_external_changes(sessions, &project_id)
    })
}

/// The user chose to overwrite the files that changed on disk: records their current state
/// so the next save is allowed. `document_id` absent means the Project-level files.
#[tauri::command]
pub fn accept_disk_state<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: Option<String>,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        external_change::accept_disk_state(sessions, &project_id, document_id.as_deref())
    })
}

/// Plans (`dry_run`) or applies one explicit repair of a Load Issue the user confirmed.
/// `document_id` is the Document whose load reported it.
#[tauri::command]
pub fn repair_load_issue<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: Option<String>,
    issue: RepairIssueRef,
    action: RepairAction,
    dry_run: bool,
) -> Result<RepairOutcome, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        load_issue_repair::repair_load_issue(
            sessions,
            &project_id,
            document_id.as_deref(),
            &issue,
            action,
            dry_run,
        )
    })
}

/// "Update all now": writes every file that was read in an older format in the current one.
#[tauri::command]
pub fn update_outdated_files<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
) -> Result<FormatUpdateResult, ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        format_update::update_outdated_files(sessions, &project_id)
    })
}

#[tauri::command]
pub fn delete_sheet<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
    sheet_id: String,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
        sheets::delete_sheet(sessions, &project_id, &document_id, &sheet_id)
    })
}

#[tauri::command]
pub fn delete_document<R: Runtime>(
    window: Window<R>,
    state: SessionState<'_>,
    project_id: String,
    document_id: String,
) -> Result<(), ApplicationError> {
    with_project_sessions(&window, &state, &project_id, |sessions| {
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

/// Tells every other window with an app channel about the new theme, language, text size and
/// auto-save values.
/// The caller already updated itself from the command result. Not sent for the Project Tree
/// width: that is a per-window state.
fn broadcast_settings<R: Runtime>(window: &Window<R>, settings: &AppSettings) {
    if let Some(hub) = window.try_state::<AppRequestSubscriber>() {
        hub.broadcast_settings_changed(
            window.label(),
            settings.theme_preference,
            settings.language_preference,
            settings.text_size,
            settings.auto_save,
        );
    }
}

#[tauri::command]
pub fn set_theme_preference<R: Runtime>(
    window: Window<R>,
    theme_preference: String,
) -> Result<AppSettings, ApplicationError> {
    let settings = with_local_state(window.app_handle(), |local_state| {
        local_state.set_theme_preference(&theme_preference)
    })?;
    broadcast_settings(&window, &settings);
    Ok(settings)
}

#[tauri::command]
pub fn set_language_preference<R: Runtime>(
    window: Window<R>,
    language_preference: String,
) -> Result<AppSettings, ApplicationError> {
    let settings = with_local_state(window.app_handle(), |local_state| {
        local_state.set_language_preference(&language_preference)
    })?;
    broadcast_settings(&window, &settings);
    Ok(settings)
}

#[tauri::command]
pub fn set_text_size<R: Runtime>(
    window: Window<R>,
    text_size: String,
) -> Result<AppSettings, ApplicationError> {
    let settings = with_local_state(window.app_handle(), |local_state| {
        local_state.set_text_size(&text_size)
    })?;
    broadcast_settings(&window, &settings);
    Ok(settings)
}

#[tauri::command]
pub fn set_auto_save<R: Runtime>(
    window: Window<R>,
    enabled: bool,
) -> Result<AppSettings, ApplicationError> {
    let settings = with_local_state(window.app_handle(), |local_state| {
        local_state.set_auto_save(enabled)
    })?;
    broadcast_settings(&window, &settings);
    Ok(settings)
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
    window: Window<R>,
    drop_id: String,
    project_id: String,
    document_id: String,
) -> Result<DropImportResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    let window_label = window.label().to_owned();
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        let drops = app.state::<Mutex<DroppedFilesState>>();
        import_dropped(
            &sessions,
            &drops,
            &window_label,
            &drop_id,
            &project_id,
            &document_id,
        )
    })
    .await
}

#[tauri::command]
pub async fn copy_asset_to_document<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    source_document_id: String,
    content_path: String,
    target_document_id: String,
) -> Result<CopiedAsset, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
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

/// Repository state and changed files of the calling window's Project.
/// `async` + the blocking pool: git can take seconds, and the
/// sessions lock is held only to copy the Project root out.
#[tauri::command]
pub async fn git_status<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<GitStatusResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_operations::git_status(&sessions, &project_id)
    })
    .await
}

/// Stages changed files of the calling window's Project and returns the status read after
/// it. Not an Undo step and never saves.
#[tauri::command]
pub async fn git_stage<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    paths: Vec<String>,
) -> Result<GitStatusResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_operations::git_stage(&sessions, &project_id, &paths)
    })
    .await
}

/// Unstages files of the calling window's Project and returns the status read after it.
/// Not an Undo step and never saves.
#[tauri::command]
pub async fn git_unstage<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    paths: Vec<String>,
) -> Result<GitStatusResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_operations::git_unstage(&sessions, &project_id, &paths)
    })
    .await
}

/// Which Documents and Project files of the calling window's Project the given paths belong
/// to. Read-only: no git process, no absolute paths.
#[tauri::command]
pub async fn git_discard_impact<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    paths: Vec<String>,
) -> Result<git_discard::GitDiscardImpact, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_discard::git_discard_impact(&sessions, &project_id, &paths)
    })
    .await
}

/// Discards working tree changes of the calling window's Project (restores tracked files,
/// deletes untracked ones) and returns the status read after it. Not an Undo step and never saves; the UI must have asked for confirmation.
#[tauri::command]
pub async fn git_discard<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    paths: Vec<String>,
) -> Result<GitStatusResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_discard::git_discard(&sessions, &project_id, &paths)
    })
    .await
}

/// Diff of one changed file of the calling window's Project.
/// Read-only: never saves, not an Undo step. `side` must be `unstaged` or `staged`.
#[tauri::command]
pub async fn git_diff<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    path: String,
    side: git_operations::DiffSide,
) -> Result<git_operations::GitDiff, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_operations::git_diff(&sessions, &project_id, &path, side)
    })
    .await
}

/// Commits the staged changes of the calling window's Project. Not an Undo step and never saves. The message is user text: it is passed on
/// to the application layer only and is never logged or echoed here.
#[tauri::command]
pub async fn git_commit<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    message: String,
    options: git_commit::GitCommitOptions,
) -> Result<git_commit::GitCommitResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_commit::git_commit(&sessions, &project_id, &message, options)
    })
    .await
}

/// Takes the last commit of the calling window's Project back, keeping the index and the
/// working tree. Not an Undo step and never saves. The
/// returned message is user text and is never logged here.
#[tauri::command]
pub async fn git_undo_last_commit<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<git_commit::GitUndoCommitResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_commit::git_undo_last_commit(&sessions, &project_id)
    })
    .await
}

/// Fetches the calling window's Project. Network access with the user's own git credentials; never saves and is not an Undo step.
#[tauri::command]
pub async fn git_fetch<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<git_remote::GitRemoteResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_remote::git_fetch(&sessions, &project_id)
    })
    .await
}

/// Pulls (merge, never rebase) the calling window's Project. Rewrites working tree files: the caller saves first and reloads afterwards. Not an Undo step.
#[tauri::command]
pub async fn git_pull<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<git_remote::GitRemoteResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_remote::git_pull(&sessions, &project_id)
    })
    .await
}

/// Pushes the current branch of the calling window's Project to its upstream. Never forces.
#[tauri::command]
pub async fn git_push<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<git_remote::GitRemoteResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_remote::git_push(&sessions, &project_id)
    })
    .await
}

/// Pushes the current branch to `remote` and sets it as upstream. `remote` is user text: the core accepts only a name `git remote` lists.
#[tauri::command]
pub async fn git_publish<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    remote: String,
) -> Result<git_remote::GitRemoteResult, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_remote::git_publish(&sessions, &project_id, &remote)
    })
    .await
}

/// Names of the remotes of the calling window's Project. Names only, never URLs.
#[tauri::command]
pub async fn git_remotes<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<Vec<String>, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_remote::git_remotes(&sessions, &project_id)
    })
    .await
}

/// One page of the commit history of the calling window's Project. Read-only: never saves, not an Undo step. `limit` is taken as a signed 64 bit
/// integer, so a negative number is not an argument error but an out-of-range page size
/// that the core refuses as `invalidHistoryRequest`; a non-integer or beyond-i64 value is
/// rejected by Tauri's argument deserialization. The cursor is opaque; the core checks it.
/// The entries are repository data and are never logged here.
#[tauri::command]
pub async fn git_history<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    limit: i64,
    cursor: Option<String>,
) -> Result<git_history::GitHistory, ApplicationError> {
    ensure_window_project(&window, &project_id)?;
    // A negative limit becomes usize::MAX, which the core's range check refuses.
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    run_blocking(move || {
        let sessions = app.state::<Mutex<ProjectSessions>>();
        git_history::git_history(&sessions, &project_id, limit, cursor.as_deref())
    })
    .await
}

/// Replaces the calling window's channel for drag and drop notifications (its latest
/// subscription wins).
#[tauri::command]
pub fn subscribe_drop_notifications<R: Runtime>(
    window: Window<R>,
    subscriber: State<'_, DropSubscriber>,
    channel: Channel<DropNotification>,
) {
    subscriber.replace(window.label(), channel);
}

/// Registers the channel for close requests and returns the token the notifications carry.
#[tauri::command]
pub fn subscribe_close_requests<R: Runtime>(
    window: Window<R>,
    subscriber: State<'_, CloseRequestSubscriber>,
    channel: Channel<CloseNotification>,
) -> String {
    subscriber.subscribe(window.label(), channel)
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
    window: Window<R>,
    pending: State<'_, Mutex<PendingOpenRequests>>,
    state: SessionState<'_>,
    registry: State<'_, Mutex<WindowRegistry>>,
) -> Result<Option<OpenedRequest>, ApplicationError> {
    let outcome = {
        let mut sessions = state.lock().unwrap_or_else(PoisonError::into_inner);
        open_request::take_open_request(
            &pending,
            &mut sessions,
            &mut lock_registry(&registry),
            window.label(),
        )
    };
    settle_open(&window, outcome)
}

/// Replaces the calling window's app channel (its latest subscription wins) and sends it
/// the requests it has not acknowledged yet.
#[tauri::command]
pub fn subscribe_app_requests<R: Runtime>(
    window: Window<R>,
    hub: State<'_, AppRequestSubscriber>,
    channel: Channel<AppNotification>,
) {
    hub.subscribe(window.label(), channel);
}

/// The window handled (or deliberately set aside) an `openDocument`. A request id of
/// another window, or an unknown one, changes nothing.
#[tauri::command]
pub fn ack_open_request<R: Runtime>(
    window: Window<R>,
    hub: State<'_, AppRequestSubscriber>,
    request_id: String,
) {
    hub.acknowledge(window.label(), &request_id);
}

/// `{ "status": "focusedExisting", "inThisWindow": bool }` when a window already has the
/// Project (it was brought forward), `{ "status": "openedInNewWindow" }` when a window was
/// created for it. No label or path.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OpenInNewWindowResult {
    #[serde(rename_all = "camelCase")]
    FocusedExisting {
        in_this_window: bool,
    },
    OpenedInNewWindow,
}

/// Opens the Project of the folder the caller selected in a window of its own, or brings
/// forward the window that has it. `async` and on the blocking pool: creating a window from
/// a synchronous command deadlocks on Windows (see `open_dispatch`).
#[tauri::command]
pub async fn open_project_in_new_window<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    selection_id: String,
) -> Result<OpenInNewWindowResult, ApplicationError> {
    let origin = window.label().to_owned();
    let folder = {
        let selections = app.state::<Mutex<FolderSelectionState>>();
        log_failure(resolve_selection(&selections, &origin, &selection_id))?
    };
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let host = TauriWindowHost::new(app.clone());
        with_routing_state(&app, |state| {
            route_open_request(
                state,
                &host,
                OpenRequest::ProjectFolder(folder),
                &PlacementSource::Origin(origin.clone()),
            )
            .map(|outcome| (outcome, origin))
        })
    })
    .await
    .map_err(|error| {
        ApplicationError::persistence(
            PersistenceErrorKind::IoError,
            format!("open in new window task failed: {error}"),
        )
    })?;
    let (outcome, origin) = log_failure(outcome)?;
    Ok(match outcome {
        RouteOutcome::FocusedExisting { window_label } => OpenInNewWindowResult::FocusedExisting {
            in_this_window: window_label == origin,
        },
        RouteOutcome::OpenedInNewWindow { .. } => OpenInNewWindowResult::OpenedInNewWindow,
    })
}
