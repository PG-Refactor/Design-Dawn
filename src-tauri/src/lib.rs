pub mod application;
pub mod commands;
pub mod config;
pub mod domain;
pub mod infrastructure;

use std::sync::{Arc, Mutex};

use application::folder_selection::FolderSelectionState;
use application::session::ProjectSessions;
use commands::{DialogFolderPicker, SharedFolderPicker};
use tauri::{Builder, Manager, Runtime};

/// Registers the managed state and every command on `builder`. Production (`Wry`) and the
/// command-boundary tests (`MockRuntime`) both go through this one function, so the tested
/// registration cannot drift from the real one. It does not register a `SharedFolderPicker`:
/// the real dialog needs the running app, so `run` adds it and tests add a fake.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .manage(Mutex::new(ProjectSessions::default()))
        .manage(Mutex::new(FolderSelectionState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::select_project_folder,
            commands::create_project,
            commands::open_project,
            commands::save_project,
            commands::create_document,
            commands::load_document,
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
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure(tauri::Builder::default())
        // Used from Rust only (`DialogExt`); no dialog permission is granted to the Frontend.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let picker: SharedFolderPicker =
                Arc::new(DialogFolderPicker::new(app.handle().clone()));
            app.manage(picker);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Design Dawn");
}
