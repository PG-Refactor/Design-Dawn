//! Application Local State: the theme and language
//! preferences, the UI text size, the auto-save, Project Tree width and window size settings and the per-sheet viewport. App-owned data that never goes into a Project, so it is not part of
//! the Domain. Independent of Tauri; the commands only call `LocalState`.

pub mod ai_access;
pub mod constants;
pub mod language;
pub mod layout;
pub mod operations;
pub mod text_size;
pub mod theme;
pub mod viewport;
pub mod window_size;
