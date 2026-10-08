pub mod application;
pub mod commands;
pub mod config;
pub mod domain;
pub mod infrastructure;

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use application::dropped_files::DroppedFilesState;
use application::folder_selection::FolderSelectionState;
use application::local_state::operations::{LocalState, LocalStateDirectories};
use application::open_request::{resolve_open_target, select_open_request, PendingOpenRequests};
use application::open_routing::WindowLabelAllocator;
use application::session::ProjectSessions;
use application::window_registry::WindowRegistry;
use commands::{
    AppRequestSubscriber, CloseRequestSubscriber, DialogFolderPicker, DropSubscriber,
    SharedFolderPicker,
};
use config::MAIN_WINDOW_LABEL;
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
        .manage(Mutex::new(PendingOpenRequests::default()))
        .manage(Mutex::new(WindowRegistry::default()))
        .manage(Mutex::new(WindowLabelAllocator::default()))
        .manage(AppRequestSubscriber::default())
        .manage(DropSubscriber::default())
        .manage(CloseRequestSubscriber::default())
        // Read-only image access for `<img>`; the handler runs on the blocking pool because
        // an asset can be up to `ASSET_MAX_BYTES`.
        .register_asynchronous_uri_scheme_protocol(
            ASSET_URL_SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                let uri = request.uri().clone();
                // The requesting webview decides which Project may be read (security.md).
                let webview_label = context.webview_label().to_owned();
                tauri::async_runtime::spawn_blocking(move || {
                    let sessions = app.state::<Mutex<ProjectSessions>>();
                    let registry = app.state::<Mutex<WindowRegistry>>();
                    responder.respond(respond_to_asset_request(
                        &sessions,
                        &registry,
                        &webview_label,
                        &uri,
                    ));
                });
            },
        )
        .invoke_handler(tauri::generate_handler![
            commands::select_project_folder,
            commands::create_project,
            commands::open_project,
            commands::save_project,
            commands::create_folder,
            commands::save_folder,
            commands::move_entry,
            commands::delete_folder,
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
            commands::set_project_tree_width,
            commands::get_sheet_viewport,
            commands::save_sheet_viewport,
            commands::import_dropped_images,
            commands::copy_asset_to_document,
            commands::subscribe_drop_notifications,
            commands::subscribe_close_requests,
            commands::confirm_window_close,
            commands::take_open_request,
            commands::close_project,
            commands::subscribe_app_requests,
            commands::ack_open_request,
            commands::open_project_in_new_window,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // The plugin must be registered before every other plugin (its docs): a second launch
    // has to exit before anything else initialises. Not in `configure`: tests use the mock
    // runtime and must not claim a per-user D-Bus name / named mutex.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        // The callback is not on a thread that may create windows; the routing (which can
        // create one) runs on the blocking pool.
        let arguments: Vec<OsString> = argv.into_iter().map(OsString::from).collect();
        let working_directory = PathBuf::from(cwd);
        commands::dispatch_in_background(app, move |state, host| {
            commands::handle_second_launch(state, host, arguments, &working_directory);
        });
    }));
    configure(builder)
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
            app.state::<Mutex<WindowRegistry>>()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .register(MAIN_WINDOW_LABEL);
            // A `.dawn` passed on the command line (double click / "open with"); the main
            // window's Frontend takes it at start-up. An unreadable cwd only disables
            // relative paths, it must not stop the app from starting.
            match std::env::current_dir() {
                Ok(working_directory) => {
                    if let Some(request) =
                        select_open_request(std::env::args_os(), &working_directory)
                    {
                        // Until the window takes it, a second launch of the same Project
                        // must find `main` instead of creating a window. A request that
                        // cannot be read reserves nothing; `main` shows the error.
                        if let Ok(target) = resolve_open_target(&request) {
                            app.state::<Mutex<WindowRegistry>>()
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner)
                                .reserve_project(MAIN_WINDOW_LABEL, target.project_id);
                        }
                        app.state::<Mutex<PendingOpenRequests>>()
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .put(MAIN_WINDOW_LABEL, request);
                    }
                }
                Err(error) => eprintln!("failed to read the working directory: {error}"),
            }
            // Last: the window stays hidden until the recorded size is applied.
            commands::apply_startup_window_size(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Design Dawn");
}
