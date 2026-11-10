//! The OS file dialogs (open one file, choose where to save one) as a port, so the
//! Application layer never depends on Tauri and tests can answer for the user. The Frontend
//! never sends or receives a path: Rust shows the dialog and works with what was chosen.

use std::path::PathBuf;

use serde::Serialize;

use super::folder_selection::FolderPickerError;

/// The answer to a save dialog. Wire form: `{ status: "saved", fileName }` or
/// `{ status: "cancelled" }`; only the chosen file's name reaches the Frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    #[serde(rename_all = "camelCase")]
    Saved {
        file_name: String,
    },
    Cancelled,
}

/// A file type filter of a dialog: the name the OS shows and the extensions (without dots).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileFilter {
    pub name: &'static str,
    pub extensions: &'static [&'static str],
}

/// `Send + Sync` because the dialogs are shared through Tauri's managed state and called from
/// a blocking-pool thread. `Ok(None)`: the user cancelled.
pub trait FileDialogs: Send + Sync {
    fn pick_file(&self, filter: FileFilter) -> Result<Option<PathBuf>, FolderPickerError>;
    fn save_file(
        &self,
        filter: FileFilter,
        default_name: &str,
    ) -> Result<Option<PathBuf>, FolderPickerError>;
}
