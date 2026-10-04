//! Entity-level operations (open / load / save / create / delete). Independent of Tauri and
//! of the UI, so a future MCP server can call them directly (docs/architecture.md §5).

pub mod asset_import;
pub mod block_content_operations;
pub mod document_operations;
pub mod dropped_files;
pub mod entity_id_generator;
pub mod error;
pub mod folder_selection;
pub mod load_issue;
pub mod loader;
pub mod local_state;
pub mod project_operations;
pub mod session;
pub mod sheet_operations;
pub mod snapshot;
