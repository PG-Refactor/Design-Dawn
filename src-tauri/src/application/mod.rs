//! Entity-level operations (open / load / save / create / delete). Independent of Tauri and
//! of the UI, so a future MCP server can call them directly (docs/architecture.md §5).

pub mod asset_import;
pub mod authoring;
pub mod block_content_operations;
pub mod document_operations;
pub mod dropped_files;
pub mod entity_id_generator;
pub mod error;
pub mod external_change;
pub mod folder_operations;
pub mod folder_selection;
pub mod format_update;
pub mod fresh_scan;
pub mod git_commit;
pub mod git_discard;
pub mod git_history;
pub mod git_operations;
pub mod git_remote;
pub mod line_diff;
pub mod load_issue;
pub mod load_issue_repair;
pub mod loader;
pub mod local_state;
pub mod open_request;
pub mod open_routing;
pub mod project_operations;
pub mod session;
pub mod sheet_operations;
pub mod snapshot;
pub mod window_binding;
pub mod window_registry;
