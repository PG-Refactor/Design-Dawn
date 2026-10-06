use std::fs;
use std::path::Path;

use crate::infrastructure::error::PersistenceError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    Directory,
    File,
    /// Sockets, dangling symlinks and anything else the application never reads.
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryEntry {
    /// Lossy for names that are not valid UTF-8; see `is_utf8_name`.
    pub name: String,
    pub is_utf8_name: bool,
    pub kind: EntryKind,
    /// The entry itself is a symbolic link (`kind` describes what it points at).
    pub is_symlink: bool,
}

/// Entries sorted by the byte order of their names, so every load is deterministic
/// regardless of the order the OS happens to enumerate them in.
pub fn list_directory(path: &Path) -> Result<Vec<DirectoryEntry>, PersistenceError> {
    let context = format!("read directory {}", path.display());
    let mut raw_entries = fs::read_dir(path)
        .map_err(|error| PersistenceError::from_io(&context, &error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| PersistenceError::from_io(&context, &error))?;
    raw_entries.sort_by(|left, right| {
        left.file_name()
            .as_encoded_bytes()
            .cmp(right.file_name().as_encoded_bytes())
    });
    Ok(raw_entries
        .into_iter()
        .map(|entry| {
            // `metadata` follows symlinks; containment is checked separately on resolution.
            let kind = match fs::metadata(entry.path()) {
                Ok(metadata) if metadata.is_dir() => EntryKind::Directory,
                Ok(metadata) if metadata.is_file() => EntryKind::File,
                _ => EntryKind::Other,
            };
            let file_name = entry.file_name();
            let utf8_name = file_name.to_str().map(str::to_owned);
            DirectoryEntry {
                is_utf8_name: utf8_name.is_some(),
                name: utf8_name.unwrap_or_else(|| file_name.to_string_lossy().into_owned()),
                kind,
                is_symlink: entry
                    .file_type()
                    .is_ok_and(|file_type| file_type.is_symlink()),
            }
        })
        .collect())
}
