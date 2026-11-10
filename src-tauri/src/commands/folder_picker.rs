//! The real `FolderPicker`: the OS folder dialog opened from Rust through `tauri-plugin-dialog`.
//! Lives on the command side so the Application layer never depends on Tauri.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::application::file_dialogs::{FileDialogs, FileFilter};
use crate::application::folder_selection::{FolderPicker, FolderPickerError};
use crate::application::image_selection::ImagePicker;
use crate::domain::block_type::BlockType;

/// The name of the file type filter of the image dialog. The OS shows it next to the
/// extensions; the app's display language lives in the Frontend, so it is kept neutral.
const IMAGE_FILTER_NAME: &str = "Images";

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
    fn pick_folder(&self, start: Option<&Path>) -> Result<Option<PathBuf>, FolderPickerError> {
        let mut dialog = self.app.dialog().file();
        if let Some(start) = start {
            dialog = dialog.set_directory(start);
        }
        // `None` is the plugin's only signal for "closed without choosing".
        let Some(chosen) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        chosen.into_path().map(Some).map_err(|error| {
            FolderPickerError::new(format!("selected folder is not a local path: {error}"))
        })
    }
}

/// The real `ImagePicker`: the OS file dialog, limited to the image formats a Block accepts.
pub struct DialogImagePicker<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> DialogImagePicker<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> ImagePicker for DialogImagePicker<R> {
    /// Blocks like the folder dialog, so it must never run on the main thread either.
    fn pick_images(&self) -> Result<Vec<PathBuf>, FolderPickerError> {
        let extensions = BlockType::Image.definition().extensions;
        // `None` is the plugin's only signal for "closed without choosing".
        let Some(chosen) = self
            .app
            .dialog()
            .file()
            .add_filter(IMAGE_FILTER_NAME, extensions)
            .blocking_pick_files()
        else {
            return Ok(Vec::new());
        };
        chosen
            .into_iter()
            .map(|file| {
                file.into_path().map_err(|error| {
                    FolderPickerError::new(format!("selected file is not a local path: {error}"))
                })
            })
            .collect()
    }
}

/// The real `FileDialogs`: the OS open / save dialogs.
pub struct DialogFiles<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> DialogFiles<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

fn local_path(chosen: tauri_plugin_dialog::FilePath) -> Result<PathBuf, FolderPickerError> {
    chosen.into_path().map_err(|error| {
        FolderPickerError::new(format!("chosen file is not a local path: {error}"))
    })
}

impl<R: Runtime> FileDialogs for DialogFiles<R> {
    /// Blocks like the other dialogs, so it must never run on the main thread.
    fn pick_file(&self, filter: FileFilter) -> Result<Option<PathBuf>, FolderPickerError> {
        self.app
            .dialog()
            .file()
            .add_filter(filter.name, filter.extensions)
            .blocking_pick_file()
            .map(local_path)
            .transpose()
    }

    fn save_file(
        &self,
        filter: FileFilter,
        default_name: &str,
    ) -> Result<Option<PathBuf>, FolderPickerError> {
        self.app
            .dialog()
            .file()
            .add_filter(filter.name, filter.extensions)
            .set_file_name(default_name)
            .blocking_save_file()
            .map(local_path)
            .transpose()
    }
}
