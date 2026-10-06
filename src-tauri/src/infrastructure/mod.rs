//! Adapters to the outside world: the on-disk file format and the filesystem.
//! Nothing here knows about Tauri or about the application's session model.

pub mod error;
pub mod file_format;
pub mod filesystem;
pub mod local_state;
