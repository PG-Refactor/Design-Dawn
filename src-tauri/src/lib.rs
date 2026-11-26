pub mod application;
pub mod commands;
pub mod config;
pub mod domain;
pub mod infrastructure;
pub mod mcp;

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use application::document_transfer::DocumentTransfers;
use application::dropped_files::DroppedFilesState;
use application::export_folder::ExportFolders;
use application::folder_selection::FolderSelectionState;
use application::local_state::operations::{LocalState, LocalStateDirectories};
use application::open_request::{resolve_open_target, select_open_request, PendingOpenRequests};
use application::open_routing::WindowLabelAllocator;
use application::session::ProjectSessions;
use application::window_registry::WindowRegistry;
use commands::{
    AppRequestSubscriber, CloseRequestSubscriber, DialogFiles, DialogFolderPicker,
    DialogImagePicker, DropSubscriber, SharedFileDialogs, SharedFolderPicker, SharedImagePicker,
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
        .manage(Mutex::new(ExportFolders::default()))
        .manage(Mutex::new(commands::print_window::PrintWindows::default()))
        .manage(Mutex::new(PendingOpenRequests::default()))
        .manage(Mutex::new(WindowRegistry::default()))
        .manage(Mutex::new(commands::templates::TemplateEdits::default()))
        .manage(Mutex::new(DocumentTransfers::default()))
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
                // The requesting webview decides which Project may be read.
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
            commands::ai_access_overview,
            commands::add_open_project_to_ai,
            commands::add_ai_project_folder,
            commands::set_ai_write_access,
            commands::remove_ai_project,
            commands::select_image_files,
            commands::default_project_location,
            commands::set_default_project_location,
            commands::create_project,
            commands::open_project,
            commands::reload_project,
            commands::save_project,
            commands::create_folder,
            commands::save_folder,
            commands::move_entry,
            commands::delete_folder,
            commands::create_document,
            commands::load_document,
            commands::close_document,
            commands::show_document_name,
            commands::list_unused_assets,
            commands::delete_unused_assets,
            commands::save_document,
            commands::create_sheet,
            commands::reserve_sheet,
            commands::save_sheet,
            commands::create_block_content,
            commands::reserve_block_content,
            commands::read_block_content,
            commands::write_block_content,
            commands::delete_block_content,
            commands::restore_block_content,
            commands::delete_sheet,
            commands::delete_document,
            commands::get_app_settings,
            commands::set_theme_preference,
            commands::set_language_preference,
            commands::set_text_size,
            commands::set_auto_save,
            commands::set_project_tree_width,
            commands::get_sheet_viewport,
            commands::save_sheet_viewport,
            commands::get_active_sheet,
            commands::save_active_sheet,
            commands::templates::list_templates,
            commands::templates::read_template,
            commands::templates::save_template,
            commands::templates::rename_template,
            commands::templates::delete_template,
            commands::templates::move_template,
            commands::templates::import_template_asset,
            commands::templates::open_template_editor,
            commands::templates::template_edit_info,
            commands::templates::import_template_edit_asset,
            commands::templates::save_template_edit,
            commands::import_dropped_images,
            commands::import_pasted_image,
            commands::read_spreadsheet_via_dialog,
            commands::search_project,
            commands::export_document_markdown,
            commands::export_file,
            commands::export_folder::choose_export_folder,
            commands::export_folder::export_folder_existing,
            commands::export_folder::export_markdown_into_folder,
            commands::export_folder::export_into_folder,
            commands::export_folder::export_pdf_into_folder,
            commands::export_folder::export_pdf_file,
            commands::print_window::open_print_window,
            commands::print_window::print_windows_open,
            commands::print_window::close_print_windows,
            commands::print_window::set_print_windows_hidden,
            commands::asset_data_url,
            commands::ai_history,
            commands::git_conflict_versions,
            commands::git_sheet_versions,
            commands::git_resolve_conflict,
            commands::git_resolve_conflict_with_side,
            commands::copy_asset_to_document,
            commands::subscribe_drop_notifications,
            commands::subscribe_close_requests,
            commands::confirm_window_close,
            commands::bring_window_forward,
            commands::take_open_request,
            commands::close_project,
            commands::subscribe_app_requests,
            commands::ack_open_request,
            commands::open_project_in_new_window,
            commands::transfer_document,
            commands::take_document_transfer,
            commands::get_project_snapshot,
            commands::list_project_windows,
            commands::project_window_at,
            commands::show_project_in_title,
            commands::apply_window_theme,
            commands::git_status,
            commands::enable_git_long_paths,
            commands::git_stage,
            commands::git_unstage,
            commands::git_discard_impact,
            commands::git_discard,
            commands::git_diff,
            commands::git_commit,
            commands::git_undo_last_commit,
            commands::git_abort_merge,
            commands::git_history,
            commands::git_fetch,
            commands::git_pull,
            commands::git_push,
            commands::git_publish,
            commands::git_remotes,
            commands::check_external_changes,
            commands::accept_disk_state,
            commands::compare_block_content,
            commands::repair_load_issue,
            commands::update_outdated_files,
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
            let image_picker: SharedImagePicker =
                Arc::new(DialogImagePicker::new(app.handle().clone()));
            app.manage(image_picker);
            let file_dialogs: SharedFileDialogs = Arc::new(DialogFiles::new(app.handle().clone()));
            app.manage(file_dialogs);
            // Resolved by Tauri per OS; a failure aborts startup (setup error) instead of
            // silently running without a place to keep settings.
            let directories = LocalStateDirectories {
                config_dir: app.path().app_config_dir()?,
                local_data_dir: app.path().app_local_data_dir()?,
            };
            app.manage(LocalState::new(directories));
            // Projects made for editing templates last time are not in use now.
            commands::templates::clear_template_editing(&app.state::<LocalState>());
            // Real file watching only in the running app: tests start no watcher threads.
            commands::install_external_change_watching(app.handle());
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
        .build(tauri::generate_context!())
        .expect("error while building Design Dawn")
        .run(|_, _| {});
}
