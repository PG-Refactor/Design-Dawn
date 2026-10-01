pub mod application;
pub mod commands;
pub mod config;
pub mod domain;
pub mod infrastructure;

use std::sync::Mutex;

use application::session::ProjectSessions;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(ProjectSessions::default()))
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::open_project,
            commands::open_entry_point,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Design Dawn");
}
