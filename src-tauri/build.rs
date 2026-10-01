// Keep in sync with `COMMAND_NAMES` in src/commands/mod.rs and with the `allow-*`
// permissions in capabilities/default.json (enforced by tests/command_permissions.rs).
// Declaring the commands here makes Tauri require an explicit permission for each one.
const APP_COMMANDS: &[&str] = &[
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
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
