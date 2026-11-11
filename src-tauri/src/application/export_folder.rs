//! Exports of several Documents into one folder: the user chooses the folder in Rust's
//! dialog, the Frontend gets a token for it (never the path), and each file is written into
//! that folder under a name made from the Document's name.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::export_file::{check_export, suggested_name, ExportKind};
use super::export_markdown::{markdown_file_name, write_file_atomically};

/// The answer to the folder dialog. Wire form: `{ status: "chosen", token, folderName }` or
/// `{ status: "cancelled" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ExportFolderChoice {
    #[serde(rename_all = "camelCase")]
    Chosen {
        token: String,
        folder_name: String,
    },
    Cancelled,
}

/// One file to write: the stem (a Document's name) and its type (`md`, `html`, `pdf`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFolderFile {
    pub stem: String,
    pub format: String,
    /// The folders under the chosen one it goes into (the Project's folders), outermost
    /// first; empty for the chosen folder itself.
    #[serde(default)]
    pub folders: Vec<String>,
}

const SUBFOLDER_FALLBACK: &str = "folder";
const UNSAFE_FOLDER_CHARACTERS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// The folder under `folder` named by `segments` (each made a safe single name: the
/// characters Windows refuses become `_`, and `.` / `..` / empty become a plain name), so
/// a file can never land outside the chosen folder.
pub fn subfolder(folder: &Path, segments: &[String]) -> PathBuf {
    segments.iter().fold(folder.to_path_buf(), |path, segment| {
        let cleaned: String = segment
            .chars()
            .map(|character| {
                if UNSAFE_FOLDER_CHARACTERS.contains(&character) || character.is_control() {
                    '_'
                } else {
                    character
                }
            })
            .collect();
        let cleaned = cleaned.trim().trim_end_matches('.');
        path.join(if cleaned.is_empty() {
            SUBFOLDER_FALLBACK
        } else {
            cleaned
        })
    })
}

const MARKDOWN_FORMAT: &str = "md";

/// The folders chosen in this run of the app, by token. Kept until the app ends (a few
/// entries per export).
#[derive(Debug, Default)]
pub struct ExportFolders {
    folders: HashMap<String, PathBuf>,
}

impl ExportFolders {
    /// Keeps a folder the user chose and names it by a new token.
    pub fn remember(&mut self, folder: PathBuf) -> ExportFolderChoice {
        let token = Uuid::now_v7().to_string();
        let folder_name = folder.file_name().map_or_else(
            || folder.to_string_lossy().into_owned(),
            |name| name.to_string_lossy().into_owned(),
        );
        self.folders.insert(token.clone(), folder);
        ExportFolderChoice::Chosen { token, folder_name }
    }

    pub fn folder(&self, token: &str) -> ApplicationResult<PathBuf> {
        self.folders
            .get(token)
            .cloned()
            .ok_or_else(|| ApplicationError::new(ErrorKind::ExportFailed, "unknown export folder"))
    }
}

/// The name a file gets in the folder.
pub fn folder_file_name(file: &ExportFolderFile) -> ApplicationResult<String> {
    if file.format == MARKDOWN_FORMAT {
        return Ok(markdown_file_name(&file.stem));
    }
    let kind = folder_kind(&file.format)?;
    Ok(suggested_name(&file.stem, kind))
}

fn folder_kind(format: &str) -> ApplicationResult<ExportKind> {
    match ExportKind::parse(format) {
        Some(kind @ (ExportKind::Html | ExportKind::Pdf)) => Ok(kind),
        _ => Err(ApplicationError::new(
            ErrorKind::ExportFailed,
            format!("not a folder export format: {format}"),
        )),
    }
}

/// The names of those files that are already in the folder (they would be replaced).
pub fn existing_files(folder: &Path, files: &[ExportFolderFile]) -> ApplicationResult<Vec<String>> {
    let mut existing = Vec::new();
    for file in files {
        let name = folder_file_name(file)?;
        if subfolder(folder, &file.folders).join(&name).exists() {
            existing.push(
                file.folders
                    .iter()
                    .map(String::as_str)
                    .chain(std::iter::once(name.as_str()))
                    .collect::<Vec<_>>()
                    .join("/"),
            );
        }
    }
    Ok(existing)
}

/// Writes an HTML or PDF file the Frontend (or the PDF printer) made into the folder,
/// replacing one of the same name. Returns the file's name.
pub fn write_into_folder(
    folder: &Path,
    format: &str,
    stem: &str,
    bytes: &[u8],
) -> ApplicationResult<String> {
    let kind = folder_kind(format)?;
    check_export(kind, bytes)?;
    std::fs::create_dir_all(folder).map_err(|error| {
        ApplicationError::new(ErrorKind::ExportFailed, format!("export folder: {error}"))
    })?;
    let name = suggested_name(stem, kind);
    write_file_atomically(&folder.join(&name), bytes)?;
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("dawn-export-folder-{name}-{}", Uuid::now_v7()));
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn a_chosen_folder_is_known_by_its_token_only() {
        let folder = temporary_folder("choose");
        let mut folders = ExportFolders::default();
        let ExportFolderChoice::Chosen { token, folder_name } = folders.remember(folder.clone())
        else {
            panic!("expected a folder");
        };
        assert_eq!(folders.folder(&token).unwrap(), folder);
        assert!(folder_name.starts_with("dawn-export-folder-choose"));
        assert!(folders.folder("other").is_err());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn files_get_safe_names_and_existing_ones_are_reported() {
        let folder = temporary_folder("write");
        let name = write_into_folder(&folder, "html", "API: v2", b"<p>x</p>").unwrap();
        assert_eq!(name, "API_ v2.html");
        let file = |format: &str| ExportFolderFile {
            stem: "API: v2".into(),
            format: format.into(),
            folders: Vec::new(),
        };
        let files = [file("html"), file("pdf"), file("md")];
        assert_eq!(existing_files(&folder, &files).unwrap(), ["API_ v2.html"]);
        assert!(write_into_folder(&folder, "pdf", "x", b"not a pdf").is_err());
        assert!(write_into_folder(&folder, "png", "x", b"\x89PNG\r\n\x1a\n").is_err());
        assert_eq!(
            write_into_folder(&folder, "pdf", "x", b"%PDF-1.7 ...").unwrap(),
            "x.pdf"
        );
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn subfolders_stay_inside_the_chosen_folder() {
        let base = Path::new("/out");
        assert_eq!(
            subfolder(base, &["設計".into(), "API: v2".into()]),
            Path::new("/out/設計/API_ v2")
        );
        assert_eq!(
            subfolder(base, &["..".into(), "a/b".into(), " ".into()]),
            Path::new("/out/folder/a_b/folder")
        );
    }
}
