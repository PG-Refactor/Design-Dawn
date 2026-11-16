//! Image files that were imported into a Document and then never kept: dropped while
//! auto-save was off and the changes were discarded, or whose block was removed before the
//! Document closed. Left in `assets/`, they would end up in a commit. When a Document
//! closes, its undo history is gone, so an image this session created that nothing on disk
//! refers to has no way back and is removed.
//!
//! Deliberately cautious: only files this session created are candidates (an asset that was
//! there before is the user's), "refers to" is any mention of the file name in any other
//! file of the Document (sheet metadata, Markdown, Mermaid), and anything unexpected while
//! looking (a file that cannot be read, a symbolic link) keeps every candidate.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::domain::constants::{ASSETS_DIRECTORY_NAME, PATH_SEPARATOR};
use crate::domain::entity_id::DocumentId;
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::filesystem::directory::{list_directory, EntryKind};
use crate::infrastructure::filesystem::path_resolution::resolve_existing;

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
        if text.contains(&file_name_of(&content_path).to_lowercase()) {
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
