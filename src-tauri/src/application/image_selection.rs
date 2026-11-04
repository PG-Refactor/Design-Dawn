//! Choosing image files with the OS file dialog, as a way to add images besides dropping
//! them. The chosen files are recorded exactly like a drop (`DroppedFilesState`), so the
//! Frontend imports them with `import_dropped_images` and never sees a path.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use super::dropped_files::{register_drop, DroppedFilesState};
use super::error::ApplicationResult;
use super::folder_selection::FolderPickerError;

/// `Send + Sync` because the picker is shared through Tauri's managed state and called from a
/// blocking-pool thread.
pub trait ImagePicker: Send + Sync {
    /// The chosen files; empty when the user cancelled. `Err`: the dialog could not be shown
    /// or its result could not be read.
    fn pick_images(&self) -> Result<Vec<PathBuf>, FolderPickerError>;
}

/// Wire form: `{ status: "selected", dropId, fileCount }` or `{ status: "cancelled" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ImageSelection {
    #[serde(rename_all = "camelCase")]
    Selected {
        drop_id: String,
        file_count: usize,
    },
    Cancelled,
}

/// Opens the dialog and records the choice as the window's latest drop. The state lock is
/// taken only after the dialog closed.
pub fn select_image_files(
    picker: &dyn ImagePicker,
    drops: &Mutex<DroppedFilesState>,
    window_label: &str,
) -> ApplicationResult<ImageSelection> {
    let paths = picker.pick_images()?;
    Ok(match register_drop(drops, window_label, paths) {
        Some(dropped) => ImageSelection::Selected {
            drop_id: dropped.drop_id,
            file_count: dropped.file_count,
        },
        None => ImageSelection::Cancelled,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::dropped_files::resolve_drop;

    struct Choosing(Vec<PathBuf>);

    impl ImagePicker for Choosing {
        fn pick_images(&self) -> Result<Vec<PathBuf>, FolderPickerError> {
            Ok(self.0.clone())
        }
    }

    #[test]
    fn chosen_files_become_the_window_s_latest_drop() {
        let drops = Mutex::new(DroppedFilesState::default());
        let chosen = vec![
            PathBuf::from("/images/a.png"),
            PathBuf::from("/images/b.svg"),
        ];
        let selection = select_image_files(&Choosing(chosen.clone()), &drops, "main").unwrap();
        let ImageSelection::Selected {
            drop_id,
            file_count,
        } = selection
        else {
            panic!("expected a selection");
        };
        assert_eq!(file_count, 2);
        assert_eq!(resolve_drop(&drops, "main", &drop_id).unwrap(), chosen);
    }

    #[test]
    fn a_cancelled_dialog_records_nothing() {
        let drops = Mutex::new(DroppedFilesState::default());
        assert_eq!(
            select_image_files(&Choosing(Vec::new()), &drops, "main").unwrap(),
            ImageSelection::Cancelled
        );
    }
}
