//! Application Local State (docs/architecture.md §6.2.2): the theme preference, the
//! auto-save and Project Tree width settings and the per-sheet viewport. App-owned data that never goes into a Project, so it is not part of
//! the Domain. Independent of Tauri; the commands only call `LocalState`.

pub mod constants;
pub mod layout;
pub mod operations;
pub mod theme;
pub mod viewport;
