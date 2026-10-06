//! The real `FolderPicker`: the OS folder dialog opened from Rust through `tauri-plugin-dialog`.
//! Lives on the command side so the Application layer never depends on Tauri.

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::application::folder_selection::{FolderPicker, FolderPickerError};

/// Generic over the runtime only so it type-checks wherever `configure` is generic; the
/// production app is the only place that registers it (tests register a fake picker).
pub struct DialogFolderPicker<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> DialogFolderPicker<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> FolderPicker for DialogFolderPicker<R> {
    /// Blocks the calling thread until the dialog closes, so it must never run on the main
    /// thread (the dialog is shown through the main thread's event loop and would deadlock).
    fn pick_folder(&self) -> Result<Option<PathBuf>, FolderPickerError> {
        // `None` is the plugin's only signal for "closed without choosing".
        let Some(chosen) = self.app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        chosen.into_path().map(Some).map_err(|error| {
            FolderPickerError::new(format!("selected folder is not a local path: {error}"))
        })
    }
}
