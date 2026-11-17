//! Image files that were imported into a Document and then never kept: dropped while
//! auto-save was off and the changes were discarded, or whose block was removed before the
//! Document closed. Left in `assets/`, they would end up in a commit. When a Document
//! closes, its undo history is gone, so an image this session created that nothing on disk
//! refers to has no way back and is removed.
//!
//! Deliberately cautious: only files this session created are candidates (an asset that was
//! there before is the user's), "refers to" is any mention of `assets/<file name>` in any
//! other file of the Document (sheet metadata, Markdown image paths such as
//! `../../../assets/x.png`, Mermaid), and anything unexpected while looking (a file that
//! cannot be read, a symbolic link) keeps every candidate. The bare file name is not enough:
//! a note that only names the file ("drop photo.png here") does not use it.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::domain::constants::{ASSETS_DIRECTORY_NAME, PATH_SEPARATOR, WINDOWS_PATH_SEPARATOR};
use crate::domain::entity_id::DocumentId;
use serde::Serialize;

use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::filesystem::directory::{list_directory, EntryKind};
use crate::infrastructure::filesystem::path_resolution::resolve_existing;

use super::error::ApplicationResult;
use super::session::ProjectSession;

/// Everything the Document's files other than its assets say, lowercased (file names are
/// compared without case: Windows and macOS file systems ignore it). `None` when something
/// could not be read.
fn document_text(document_directory: &Path) -> Option<String> {
    let mut text = String::new();
    let mut pending = vec![(document_directory.to_path_buf(), true)];
    while let Some((directory, top_level)) = pending.pop() {
        for entry in list_directory(&directory).ok()? {
            if entry.is_symlink || entry.kind == EntryKind::Other {
                return None;
            }
            let path = directory.join(&entry.name);
            match entry.kind {
                EntryKind::Directory if top_level && entry.name == ASSETS_DIRECTORY_NAME => {}
                EntryKind::Directory => pending.push((path, false)),
                _ => {
                    let bytes = fs::read(&path).ok()?;
                    text.push_str(&String::from_utf8_lossy(&bytes).to_lowercase());
                    text.push('\n');
                }
            }
        }
    }
    Some(text)
}

fn file_name_of(content_path: &str) -> &str {
    content_path
        .rsplit_once(PATH_SEPARATOR)
        .map_or(content_path, |(_, name)| name)
}

/// Text that refers to the asset: its path below the Document, with either separator (a
/// path written by hand on Windows) and with the name as written or percent-encoded (a
/// Markdown destination).
fn is_referred_to(text: &str, content_path: &str) -> bool {
    let name = file_name_of(content_path).to_lowercase();
    let encoded = percent_encoded(&name);
    [name.as_str(), encoded.as_str()].iter().any(|written| {
        [PATH_SEPARATOR, WINDOWS_PATH_SEPARATOR]
            .iter()
            .any(|separator| text.contains(&format!("{ASSETS_DIRECTORY_NAME}{separator}{written}")))
    })
}

/// Every byte outside the unreserved set as `%XX` (lowercase hex: `text` is lowercased).
fn percent_encoded(name: &str) -> String {
    name.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02x}")
            }
        })
        .collect()
}

/// Removes the images this session created in the Document that nothing on disk refers to.
/// Returns the removed contentPaths. Called once the Document is closed; a file that cannot
/// be removed stays (left over is the safe side) and is looked at again on the next close.
pub fn remove_unused_new_assets(
    session: &mut ProjectSession,
    document_id: &DocumentId,
) -> Vec<String> {
    let candidates = session.take_new_assets(document_id);
    if candidates.is_empty() {
        return Vec::new();
    }
    let keep_all = |session: &mut ProjectSession, kept: &BTreeSet<String>| {
        for content_path in kept {
            session.note_new_asset(document_id, content_path);
        }
    };
    let Ok(base) = session.document_base(document_id) else {
        return Vec::new();
    };
    let text = resolve_existing(session.root(), &base)
        .ok()
        .and_then(|directory| document_text(&directory));
    let Some(text) = text else {
        keep_all(session, &candidates);
        return Vec::new();
    };
    let mut removed = Vec::new();
    for content_path in candidates {
        if is_referred_to(&text, &content_path) {
            session.note_new_asset(document_id, &content_path);
            continue;
        }
        match session.remove_file(&base, &content_path) {
            Ok(()) => removed.push(content_path),
            Err(error) if error.kind == PersistenceErrorKind::FileNotFound => {}
            Err(_) => session.note_new_asset(document_id, &content_path),
        }
    }
    removed
}

/// The session ends (its last window is gone): every Document's history with it.
pub fn remove_all_unused_new_assets(session: &mut ProjectSession) {
    for document_id in session.documents_with_new_assets() {
        remove_unused_new_assets(session, &document_id);
    }
}

/// A file in the Document's `assets/` that nothing in the Document refers to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedAsset {
    pub content_path: String,
    pub size: u64,
}

/// The files of the Document's `assets/` that no other file of the Document refers to (as
/// the cleanup on close judges it), for the user to look through and delete. Anything
/// unexpected while reading the Document (a file that cannot be read, a symbolic link)
/// is an error, not an empty list: nothing may look unused because it was not read.
pub fn list_unused_assets(
    session: &ProjectSession,
    document_id: &DocumentId,
) -> ApplicationResult<Vec<UnusedAsset>> {
    let base = session.document_base(document_id)?;
    let directory = resolve_existing(session.root(), &base)?;
    let text = document_text(&directory).ok_or_else(|| {
        PersistenceError::new(
            PersistenceErrorKind::IoError,
            format!("read the files of {base:?} to find what they refer to"),
        )
    })?;
    let assets = directory.join(ASSETS_DIRECTORY_NAME);
    if !assets.is_dir() {
        return Ok(Vec::new());
    }
    let mut unused = Vec::new();
    for entry in list_directory(&assets)? {
        // Only plain files of assets/ itself; a link or a folder is left to the user.
        if entry.is_symlink || entry.kind != EntryKind::File || !entry.is_utf8_name {
            continue;
        }
        let content_path = format!("{ASSETS_DIRECTORY_NAME}{PATH_SEPARATOR}{}", entry.name);
        if is_referred_to(&text, &content_path) {
            continue;
        }
        let size = fs::symlink_metadata(assets.join(&entry.name)).map_or(0, |meta| meta.len());
        unused.push(UnusedAsset { content_path, size });
    }
    Ok(unused)
}

/// Deletes the chosen files, each only if it is still unused now (the Document may have
/// changed since the list was shown). Returns the contentPaths that were removed; a file
/// that could not be removed stays.
pub fn delete_unused_assets(
    session: &mut ProjectSession,
    document_id: &DocumentId,
    content_paths: &[String],
) -> ApplicationResult<Vec<String>> {
    let still_unused: BTreeSet<String> = list_unused_assets(session, document_id)?
        .into_iter()
        .map(|asset| asset.content_path)
        .collect();
    let base = session.document_base(document_id)?;
    let mut removed = Vec::new();
    for content_path in content_paths {
        if !still_unused.contains(content_path) {
            continue;
        }
        if session.remove_file(&base, content_path).is_ok() {
            removed.push(content_path.clone());
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::is_referred_to;

    #[test]
    fn only_a_path_into_assets_refers_to_an_asset() {
        let path = "assets/photo.png";
        assert!(is_referred_to("![](../../../assets/photo.png)", path));
        assert!(is_referred_to(
            "\"contentpath\": \"assets/photo.png\"",
            path
        ));
        assert!(is_referred_to("..\\assets\\photo.png", path));
        assert!(!is_referred_to("drop `photo.png` from samples\\", path));
        assert!(is_referred_to(
            "![](../../../assets/%e5%9b%b3.png)",
            "assets/\u{56f3}.png"
        ));
    }
}
