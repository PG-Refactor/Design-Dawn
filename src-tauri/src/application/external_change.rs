//! Finding out what changed on disk behind the app's back (docs/architecture.md §14.3–§14.5).
//!
//! A change is never taken from a file system event: it is decided by comparing the file
//! as it is now with the hash the session recorded when it last read or wrote it
//! (`HashLedger`). The app's own saves, an identical rewrite and a mere timestamp change
//! therefore all come out as "no change". Nothing here modifies the session: the ledger is
//! only brought up to date by reading the Document again or by `accept_disk_state`.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;

use super::error::ApplicationResult;
use super::session::{document_base_path, ProjectSession, ProjectSessions};
use crate::domain::constants::PATH_SEPARATOR;
use crate::domain::entity_id::{DocumentId, ProjectId};
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::file_format::constants::{
    DOCUMENTS_DIRECTORY_NAME, DOCUMENT_FILE_NAME, FOLDER_FILE_NAME, PROJECT_FILE_NAME,
};
use crate::infrastructure::file_format::dto::parse_json_text;
use crate::infrastructure::filesystem::directory::{list_directory, EntryKind};
use crate::infrastructure::filesystem::hashing::sha256_hex;
use crate::infrastructure::filesystem::path_resolution::resolve_existing;
use crate::infrastructure::filesystem::text_content::decode_text;
use crate::infrastructure::watcher::WatchBatch;

/// File extension of the metadata files, which are checked for being valid JSON.
const JSON_EXTENSION: &str = ".json";
/// Deepest folder nesting the structure scan descends into. A Project nested deeper than the
/// app can show is not scanned further; the loader has the same practical limit.
const STRUCTURE_SCAN_MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChange {
    /// The content differs from what the session last read or wrote.
    Modified,
    /// The file no longer exists. A rename is a removal plus an addition (not tracked).
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// `/`-separated, relative to the Document root (for a Document) or to the Project root
    /// (for the Project level). Never absolute.
    pub path: String,
    pub change: FileChange,
    /// Whether the new content can be read back: valid UTF-8, and valid JSON for metadata.
    /// A removed file is not readable. The Frontend reloads by itself only when everything
    /// that changed is readable.
    pub readable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChanges {
    pub document_id: String,
    pub files: Vec<ChangedFile>,
}

/// Changes that concern the Project as a whole: `project.json`, `folder.json` files and the
/// set of Documents and Folders.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChanges {
    /// A Document or Folder directory appeared or disappeared on disk, compared with what the
    /// session knows.
    pub structure: bool,
    pub files: Vec<ChangedFile>,
}

impl ProjectChanges {
    fn is_empty(&self) -> bool {
        !self.structure && self.files.is_empty()
    }
}

/// What changed, in the shape of the `projectFilesChanged` notification and of the
/// `check_external_changes` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChanges {
    pub session_generation: u64,
    /// The file watcher runs for this Project. When it does not (it could not start), changes
    /// are only found by the checks the Frontend asks for, which it tells the user once.
    pub watching: bool,
    /// The result covers everything (a full comparison), not just the files an event named.
    pub rescan: bool,
    pub project: ProjectChanges,
    /// Only Documents that are open: an unopened Document is read fresh when it is opened.
    pub documents: Vec<DocumentChanges>,
}

impl ExternalChanges {
    pub fn is_empty(&self) -> bool {
        self.project.is_empty() && self.documents.is_empty()
    }
}

/// Which recorded files to compare.
pub enum Scope<'a> {
    /// Every recorded file (a full check).
    All,
    /// Only these Project-root-relative paths (what a watcher batch names). Directory
    /// structure is always compared, because a new directory has no record to look at.
    Paths(&'a BTreeSet<String>),
}

fn is_readable(path: &str, bytes: &[u8]) -> bool {
    let Ok(text) = decode_text(bytes) else {
        return false;
    };
    !path.ends_with(JSON_EXTENSION) || parse_json_text(&text).is_ok()
}

enum Observed {
    Unchanged,
    Changed(ChangedFileKind),
}

struct ChangedFileKind {
    change: FileChange,
    readable: bool,
}

/// Compares one recorded file with the disk. Reads through `resolve_existing`, so a path that
/// now leads outside the Project (a swapped-in link) is a change that cannot be read, never
/// something followed.
fn observe(root: &Path, key: &str, recorded: &str) -> Observed {
    let resolved = match resolve_existing(root, key) {
        Ok(resolved) => resolved,
        Err(error) if error.kind == PersistenceErrorKind::FileNotFound => {
            return Observed::Changed(ChangedFileKind {
                change: FileChange::Removed,
                readable: false,
            });
        }
        Err(_) => {
            return Observed::Changed(ChangedFileKind {
                change: FileChange::Modified,
                readable: false,
            });
        }
    };
    match fs::read(resolved) {
        Ok(bytes) if sha256_hex(&bytes) == recorded => Observed::Unchanged,
        Ok(bytes) => Observed::Changed(ChangedFileKind {
            change: FileChange::Modified,
            readable: is_readable(key, &bytes),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Observed::Changed(ChangedFileKind {
                change: FileChange::Removed,
                readable: false,
            })
        }
        Err(_) => Observed::Changed(ChangedFileKind {
            change: FileChange::Modified,
            readable: false,
        }),
    }
}

/// Where a recorded path belongs.
enum Owner {
    Project,
    Document(DocumentId, String),
    /// A recorded file the Frontend has nothing to say about (`.dawn`, `.gitattributes`,
    /// an unopened Document, something that is not a known entry).
    Ignored,
}

fn owner_of(session: &ProjectSession, path: &str) -> Owner {
    if path == PROJECT_FILE_NAME {
        return Owner::Project;
    }
    let Some(under_documents) = path
        .strip_prefix(DOCUMENTS_DIRECTORY_NAME)
        .and_then(|rest| rest.strip_prefix(PATH_SEPARATOR))
    else {
        return Owner::Ignored;
    };
    for (document_id, record) in session.documents() {
        let base = format!(
            "{}{PATH_SEPARATOR}",
            document_base_path(&record.relative_path)
        );
        if let Some(relative) = path.strip_prefix(&base) {
            return if record.opened {
                Owner::Document(*document_id, relative.to_owned())
            } else {
                Owner::Ignored
            };
        }
    }
    let is_folder_file =
        under_documents
            .rsplit_once(PATH_SEPARATOR)
            .is_some_and(|(folder, file)| {
                file == FOLDER_FILE_NAME
                    && session
                        .folders()
                        .values()
                        .any(|record| record.relative_path == folder)
            });
    if is_folder_file {
        Owner::Project
    } else {
        Owner::Ignored
    }
}

/// Document and Folder directories found on disk, as paths relative to `documents/`. A
/// directory counts when it holds `document.json` or `folder.json` (the loader's rule);
/// only a Folder is searched further, and links are never followed.
fn entries_on_disk(session: &ProjectSession) -> Option<BTreeSet<String>> {
    let documents_root = resolve_existing(session.root(), DOCUMENTS_DIRECTORY_NAME).ok()?;
    let mut found = BTreeSet::new();
    collect_entries(&documents_root, "", 0, &mut found);
    Some(found)
}

fn collect_entries(directory: &Path, prefix: &str, depth: usize, found: &mut BTreeSet<String>) {
    if depth >= STRUCTURE_SCAN_MAX_DEPTH {
        return;
    }
    let Ok(entries) = list_directory(directory) else {
        return;
    };
    for entry in entries {
        if entry.kind != EntryKind::Directory || entry.is_symlink || !entry.is_utf8_name {
            continue;
        }
        let path = directory.join(&entry.name);
        let has_folder_file = fs::symlink_metadata(path.join(FOLDER_FILE_NAME)).is_ok();
        let has_document_file = fs::symlink_metadata(path.join(DOCUMENT_FILE_NAME)).is_ok();
        if !has_folder_file && !has_document_file {
            continue;
        }
        let relative = if prefix.is_empty() {
            entry.name.clone()
        } else {
            format!("{prefix}{PATH_SEPARATOR}{}", entry.name)
        };
        if has_folder_file {
            collect_entries(&path, &relative, depth + 1, found);
        }
        found.insert(relative);
    }
}

fn known_entries(session: &ProjectSession) -> BTreeSet<String> {
    session
        .documents()
        .values()
        .map(|record| record.relative_path.clone())
        .chain(
            session
                .folders()
                .values()
                .map(|record| record.relative_path.clone()),
        )
        .collect()
}

/// Whether the Document and Folder directories on disk differ from the session's records. A
/// `documents/` directory that cannot be read at all counts as a change (everything vanished).
fn structure_changed(session: &ProjectSession) -> bool {
    match entries_on_disk(session) {
        Some(on_disk) => on_disk != known_entries(session),
        None => !known_entries(session).is_empty(),
    }
}

/// Compares the session's recorded files (all, or those named) and the Document / Folder
/// structure with the disk.
pub fn detect(session: &ProjectSession, scope: &Scope<'_>, rescan: bool) -> ExternalChanges {
    let mut project = ProjectChanges::default();
    let mut documents: Vec<DocumentChanges> = Vec::new();
    for (path, recorded) in session.ledger().entries() {
        if let Scope::Paths(named) = scope {
            if !named.contains(path) {
                continue;
            }
        }
        let Observed::Changed(kind) = observe(session.root(), path, recorded) else {
            continue;
        };
        match owner_of(session, path) {
            Owner::Ignored => {}
            Owner::Project => project.files.push(ChangedFile {
                path: path.to_owned(),
                change: kind.change,
                readable: kind.readable,
            }),
            Owner::Document(document_id, relative) => {
                let file = ChangedFile {
                    path: relative,
                    change: kind.change,
                    readable: kind.readable,
                };
                match documents
                    .iter_mut()
                    .find(|changes| changes.document_id == document_id.to_string())
                {
                    Some(changes) => changes.files.push(file),
                    None => documents.push(DocumentChanges {
                        document_id: document_id.to_string(),
                        files: vec![file],
                    }),
                }
            }
        }
    }
    project.structure = structure_changed(session);
    ExternalChanges {
        session_generation: session.generation(),
        watching: session.is_watched(),
        rescan,
        project,
        documents,
    }
}

/// Whether a recorded path belongs to the Document (for `accept_disk_state`).
pub fn is_document_file(session: &ProjectSession, document_id: &DocumentId, path: &str) -> bool {
    matches!(owner_of(session, path), Owner::Document(owner, _) if owner == *document_id)
}

/// Whether a recorded path is a Project-level file (`project.json`, a `folder.json`).
pub fn is_project_file(session: &ProjectSession, path: &str) -> bool {
    matches!(owner_of(session, path), Owner::Project)
}

/// What the watcher thread does with a batch of events.
#[derive(Debug, PartialEq, Eq)]
pub enum BatchOutcome {
    /// The session this watcher was started for is gone or replaced: the watcher ends.
    Stop,
    /// Tell the window. Sent when the comparison found changes, and also when events named
    /// files the app does not track (an added asset, a new file) or may have been lost: no
    /// content to reload, but the Git status behind the window is stale.
    Report(ExternalChanges),
    /// The events were the app's own saves or timestamp noise.
    Quiet,
}

/// Decides, under the sessions lock (so it is serialized with the app's own writes), what a
/// batch of file system events amounts to (docs/architecture.md §14.4 step 3).
pub fn confirm_batch(
    sessions: &Mutex<ProjectSessions>,
    project_id: &ProjectId,
    generation: u64,
    batch: &WatchBatch,
) -> BatchOutcome {
    // A poisoned lock holds no broken invariant: the session data is rechecked against the disk.
    let guard = sessions.lock().unwrap_or_else(PoisonError::into_inner);
    let Ok(session) = guard.get(project_id) else {
        return BatchOutcome::Stop;
    };
    if session.generation() != generation {
        return BatchOutcome::Stop;
    }
    let scope = if batch.rescan {
        Scope::All
    } else {
        Scope::Paths(&batch.paths)
    };
    let changes = detect(session, &scope, batch.rescan);
    let touches_untracked_file = batch
        .paths
        .iter()
        .any(|path| session.ledger().hash_of(path).is_none());
    if changes.is_empty() && !batch.rescan && !touches_untracked_file {
        BatchOutcome::Quiet
    } else {
        BatchOutcome::Report(changes)
    }
}

/// `check_external_changes`: a full comparison of the Project (docs/architecture.md §14.4).
/// The frontend asks when its window regains focus, after the watcher reported lost events or
/// could not start, and after a Git operation that rewrote files.
pub fn check_external_changes(
    sessions: &mut ProjectSessions,
    project_id: &str,
) -> ApplicationResult<ExternalChanges> {
    let session = sessions.session_mut(project_id)?;
    Ok(detect(session, &Scope::All, true))
}

/// `accept_disk_state`: the user chose to overwrite what is on disk with the in-memory
/// content. Without a Document the Project-level files (`project.json`, `folder.json`) are
/// accepted. See `ProjectSession::accept_disk_state`.
pub fn accept_disk_state(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: Option<&str>,
) -> ApplicationResult<()> {
    let document_id = document_id.map(DocumentId::parse).transpose()?;
    let session = sessions.session_mut(project_id)?;
    if let Some(document_id) = &document_id {
        session.document(document_id)?;
    }
    // The ownership test needs the whole session, so the matching paths are decided first.
    let accepted: BTreeSet<String> = session
        .ledger()
        .entries()
        .map(|(path, _)| path)
        .filter(|path| match &document_id {
            Some(document_id) => is_document_file(session, document_id, path),
            None => is_project_file(session, path),
        })
        .map(str::to_owned)
        .collect();
    session.accept_disk_state(|path| accepted.contains(path));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_is_readable_only_when_it_parses() {
        assert!(is_readable("sheet.json", b"{\"a\":1}"));
        assert!(!is_readable("sheet.json", b"{ nope"));
        assert!(is_readable("notes.md", b"{ nope"));
        assert!(!is_readable("notes.md", &[0xFF, 0xFE]));
    }
}
