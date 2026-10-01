//! Application Local State (docs/architecture.md §6.2.2): the theme preference and the
//! per-sheet viewport. App-owned data that never goes into a Project, so it is not part of
//! the Domain. Independent of Tauri; the commands only call `LocalState`.

pub mod constants;
pub mod operations;
pub mod theme;
pub mod viewport;
