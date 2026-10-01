//! The real `FolderPicker`: the OS folder dialog opened from Rust through `tauri-plugin-dialog`.
//! Lives on the command side so the Application layer never depends on Tauri.

use std::path::PathBuf;

use tauri::{AppHandle, Wry};
use tauri_plugin_dialog::DialogExt;

use crate::application::folder_selection::{FolderPicker, FolderPickerError};

pub struct DialogFolderPicker {
    app: AppHandle<Wry>,
}

impl DialogFolderPicker {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }
}

impl FolderPicker for DialogFolderPicker {
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
