//! Project folder selection (docs/architecture.md §6.2.2). The native dialog is abstracted
//! behind `FolderPicker` so this layer stays free of Tauri and testable without a dialog.
//! Rust keeps the picked path; the Frontend only ever sees an opaque `selectionId`.

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use uuid::Uuid;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};

/// Why the dialog could not produce a result. A user cancelling is not a failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderPickerError {
    pub detail: String,
}

impl FolderPickerError {
    pub fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
        }
    }
}

impl fmt::Display for FolderPickerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.detail)
    }
}

impl std::error::Error for FolderPickerError {}

impl From<FolderPickerError> for ApplicationError {
    fn from(error: FolderPickerError) -> Self {
        Self::new(ErrorKind::DialogFailed, error.detail)
    }
}

/// `Send + Sync` because the picker is shared through Tauri's managed state and called from a
/// blocking-pool thread.
pub trait FolderPicker: Send + Sync {
    /// `Ok(Some(path))`: a folder was chosen. `Ok(None)`: the user cancelled.
    /// `Err`: the dialog could not be shown or its result could not be read.
    fn pick_folder(&self) -> Result<Option<PathBuf>, FolderPickerError>;
}

/// Wire form of the command result: `{ status: "selected", selectionId, displayPath }` or
/// `{ status: "cancelled" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FolderSelection {
    #[serde(rename_all = "camelCase")]
    Selected {
        selection_id: String,
        /// Display only; never accepted back as input.
        display_path: String,
    },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SelectedFolder {
    selection_id: String,
    path: PathBuf,
}

/// The latest selection of each window. A new selection replaces that window's one (stale ids
/// stop resolving); a cancelled dialog and failed or successful open / create leave it
/// untouched. A `selectionId` only resolves for the window whose dialog produced it.
#[derive(Debug, Default)]
pub struct FolderSelectionState {
    latest_by_window: HashMap<String, SelectedFolder>,
}

impl FolderSelectionState {
    fn replace(&mut self, window_label: &str, path: PathBuf) -> String {
        let selection_id = Uuid::now_v7().hyphenated().to_string();
        self.latest_by_window.insert(
            window_label.to_owned(),
            SelectedFolder {
                selection_id: selection_id.clone(),
                path,
            },
        );
        selection_id
    }

    /// Unknown, replaced and other windows' ids are indistinguishable on purpose: all are
    /// `invalidFolderSelection`.
    pub fn resolve(&self, window_label: &str, selection_id: &str) -> ApplicationResult<PathBuf> {
        match self.latest_by_window.get(window_label) {
            Some(selected) if selected.selection_id == selection_id => Ok(selected.path.clone()),
            _ => Err(ApplicationError::new(
                ErrorKind::InvalidFolderSelection,
                format!("unknown or expired selectionId: {selection_id}"),
            )),
        }
    }

    /// For a destroyed window.
    pub fn discard_window(&mut self, window_label: &str) {
        self.latest_by_window.remove(window_label);
    }
}

/// Opens the dialog and records the choice. Performs no validation or loading of the folder;
/// that is `open_project` / `create_project`'s job. The state lock is taken only after the
/// dialog closed, so a dialog that stays open never blocks other commands.
pub fn select_project_folder(
    picker: &dyn FolderPicker,
    state: &Mutex<FolderSelectionState>,
    window_label: &str,
) -> ApplicationResult<FolderSelection> {
    let Some(path) = picker.pick_folder()? else {
        return Ok(FolderSelection::Cancelled);
    };
    let display_path = path.display().to_string();
    // The state is a single replaceable value, so a poisoned lock cannot hold a broken invariant.
    let selection_id = state
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .replace(window_label, path);
    Ok(FolderSelection::Selected {
        selection_id,
        display_path,
    })
}

/// Looks the path up and releases the lock before the caller touches the filesystem.
pub fn resolve_selection(
    state: &Mutex<FolderSelectionState>,
    window_label: &str,
    selection_id: &str,
) -> ApplicationResult<PathBuf> {
    state
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .resolve(window_label, selection_id)
}
