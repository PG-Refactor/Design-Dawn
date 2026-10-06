pub mod application;
pub mod commands;
pub mod config;
pub mod domain;
pub mod infrastructure;

use std::sync::{Arc, Mutex};

use application::dropped_files::DroppedFilesState;
use application::folder_selection::FolderSelectionState;
use application::local_state::operations::{LocalState, LocalStateDirectories};
use application::session::ProjectSessions;
use commands::{CloseRequestSubscriber, DialogFolderPicker, DropSubscriber, SharedFolderPicker};
use tauri::{Builder, Manager, Runtime};

use commands::{respond_to_asset_request, ASSET_URL_SCHEME};

/// Registers the managed state and every command on `builder`. Production (`Wry`) and the
/// command-boundary tests (`MockRuntime`) both go through this one function, so the tested
/// registration cannot drift from the real one. It does not register a `SharedFolderPicker`:
/// the real dialog needs the running app, so `run` adds it and tests add a fake. The same
/// holds for `LocalState` (directories come from the app's path resolver in production and
/// from temporary directories in tests).
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .manage(Mutex::new(ProjectSessions::default()))
        .manage(Mutex::new(FolderSelectionState::default()))
        .manage(Mutex::new(DroppedFilesState::default()))
        .manage(DropSubscriber::default())
        .manage(CloseRequestSubscriber::default())
        // Read-only image access for `<img>`; the handler runs on the blocking pool because
        // an asset can be up to `ASSET_MAX_BYTES`.
        .register_asynchronous_uri_scheme_protocol(
            ASSET_URL_SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                let uri = request.uri().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let sessions = app.state::<Mutex<ProjectSessions>>();
                    responder.respond(respond_to_asset_request(&sessions, &uri));
                });
            },
        )
        .invoke_handler(tauri::generate_handler![
            commands::select_project_folder,
            commands::create_project,
            commands::open_project,
            commands::save_project,
            commands::create_document,
            commands::load_document,
            commands::close_document,
            commands::save_document,
            commands::create_sheet,
            commands::save_sheet,
            commands::create_block_content,
            commands::read_block_content,
            commands::write_block_content,
            commands::delete_block_content,
            commands::restore_block_content,
            commands::delete_sheet,
            commands::delete_document,
            commands::get_app_settings,
            commands::set_theme_preference,
            commands::set_auto_save,
            commands::get_sheet_viewport,
            commands::save_sheet_viewport,
            commands::import_dropped_images,
            commands::copy_asset_to_document,
            commands::subscribe_drop_notifications,
            commands::subscribe_close_requests,
            commands::confirm_window_close,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure(tauri::Builder::default())
        // Registered here, not in `configure`: only the real window produces native drops.
        .on_window_event(commands::handle_window_event)
        // Used from Rust only (`DialogExt`); no dialog permission is granted to the Frontend.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let picker: SharedFolderPicker =
                Arc::new(DialogFolderPicker::new(app.handle().clone()));
            app.manage(picker);
            // Resolved by Tauri per OS; a failure aborts startup (setup error) instead of
            // silently running without a place to keep settings.
            let directories = LocalStateDirectories {
                config_dir: app.path().app_config_dir()?,
                local_data_dir: app.path().app_local_data_dir()?,
            };
            app.manage(LocalState::new(directories));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Design Dawn");
}
