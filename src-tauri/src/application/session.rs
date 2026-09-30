//! Project Session: what the Rust side remembers about an opened Project
//! (docs/architecture.md §6.1). All file access for a Project goes through here so that
//! path containment checks and the hash ledger cannot be bypassed.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::error::{ApplicationError, ApplicationResult};
use crate::domain::constants::PATH_SEPARATOR;
use crate::domain::entity_id::{DocumentId, ProjectId, SheetId};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::DOCUMENTS_DIRECTORY_NAME;
use crate::infrastructure::file_format::dto::parse_json_text;
use crate::infrastructure::filesystem::atomic_write::{
    create_new_file, write_atomic, WriteOutcome,
};
use crate::infrastructure::filesystem::directory::list_directory;
use crate::infrastructure::filesystem::hashing::sha256_hex;
use crate::infrastructure::filesystem::path_resolution::{
    resolve_existing, resolve_for_create, resolve_for_write,
};
use crate::infrastructure::filesystem::text_content::decode_text;

/// Path → SHA-256 of the file content as last read or written by this process, keyed by
/// the Project-root-relative `/`-separated path. Phase 7 compares watcher events with it
/// to recognize the app's own writes.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct HashLedger {
    hashes: BTreeMap<String, String>,
}

impl HashLedger {
    pub fn record(&mut self, relative_path: &str, bytes: &[u8]) {
        self.hashes
            .insert(relative_path.to_owned(), sha256_hex(bytes));
    }

    pub fn forget(&mut self, relative_path: &str) {
        self.hashes.remove(relative_path);
    }

    pub fn hash_of(&self, relative_path: &str) -> Option<&str> {
        self.hashes.get(relative_path).map(String::as_str)
    }

    pub fn len(&self) -> usize {
        self.hashes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.hashes.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetRecord {
    pub directory_name: String,
    /// Only a sheet that loaded successfully (or was created here) may be written.
    pub writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentRecord {
    pub directory_name: String,
    pub writable: bool,
    /// Filled by `load_document` / `create_sheet`; empty until then.
    pub sheets: BTreeMap<SheetId, SheetRecord>,
}

#[derive(Debug)]
pub struct ProjectSession {
    root: PathBuf,
    project_id: ProjectId,
    documents: BTreeMap<DocumentId, DocumentRecord>,
    ledger: HashLedger,
}

fn join_key(base_relative: &str, relative: &str) -> String {
    match (base_relative.is_empty(), relative.is_empty()) {
        (true, _) => relative.to_owned(),
        (false, true) => base_relative.to_owned(),
        (false, false) => format!("{base_relative}{PATH_SEPARATOR}{relative}"),
    }
}

/// Reads a file inside `root`/`base_relative`, recording its hash. The containment check is
/// against `base_relative` (for example the Document root), not just the Project root.
pub fn read_recorded(
    root: &Path,
    ledger: &mut HashLedger,
    base_relative: &str,
    relative: &str,
) -> Result<Vec<u8>, PersistenceError> {
    let base = resolve_existing(root, base_relative)?;
    let path = resolve_existing(&base, relative)?;
    let bytes = fs::read(&path)
        .map_err(|error| PersistenceError::from_io(format!("read {relative:?}"), &error))?;
    ledger.record(&join_key(base_relative, relative), &bytes);
    Ok(bytes)
}

/// Reads a metadata file as JSON. Syntax errors are `invalidJson`, bad UTF-8 is `invalidEncoding`.
pub fn read_json_value(
    root: &Path,
    ledger: &mut HashLedger,
    base_relative: &str,
    relative: &str,
) -> Result<Value, PersistenceError> {
    let bytes = read_recorded(root, ledger, base_relative, relative)?;
    parse_json_text(&decode_text(&bytes)?)
}

impl ProjectSession {
    pub fn new(root: PathBuf, project_id: ProjectId, ledger: HashLedger) -> Self {
        Self {
            root,
            project_id,
            documents: BTreeMap::new(),
            ledger,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn project_id(&self) -> &ProjectId {
        &self.project_id
    }

    pub fn ledger(&self) -> &HashLedger {
        &self.ledger
    }

    pub fn documents(&self) -> &BTreeMap<DocumentId, DocumentRecord> {
        &self.documents
    }

    pub fn replace_documents(&mut self, documents: BTreeMap<DocumentId, DocumentRecord>) {
        self.documents = documents;
    }

    pub fn insert_document(&mut self, document_id: DocumentId, record: DocumentRecord) {
        self.documents.insert(document_id, record);
    }

    pub fn document(&self, document_id: &DocumentId) -> ApplicationResult<&DocumentRecord> {
        self.documents.get(document_id).ok_or_else(|| {
            ApplicationError::entity_not_found(format!("unknown documentId: {document_id}"))
        })
    }

    pub fn document_mut(
        &mut self,
        document_id: &DocumentId,
    ) -> ApplicationResult<&mut DocumentRecord> {
        self.documents.get_mut(document_id).ok_or_else(|| {
            ApplicationError::entity_not_found(format!("unknown documentId: {document_id}"))
        })
    }

    /// Project-root-relative directory of a Document.
    pub fn document_base(&self, document_id: &DocumentId) -> ApplicationResult<String> {
        Ok(document_base_path(
            &self.document(document_id)?.directory_name,
        ))
    }

    pub fn resolve_existing_path(
        &self,
        base_relative: &str,
        relative: &str,
    ) -> Result<PathBuf, PersistenceError> {
        let base = resolve_existing(&self.root, base_relative)?;
        resolve_existing(&base, relative)
    }

    pub fn read_file(
        &mut self,
        base_relative: &str,
        relative: &str,
    ) -> Result<Vec<u8>, PersistenceError> {
        read_recorded(&self.root, &mut self.ledger, base_relative, relative)
    }

    pub fn read_json(
        &mut self,
        base_relative: &str,
        relative: &str,
    ) -> Result<Value, PersistenceError> {
        read_json_value(&self.root, &mut self.ledger, base_relative, relative)
    }

    /// Atomic overwrite (or recreation of a file removed externally).
    pub fn write_file(
        &mut self,
        base_relative: &str,
        relative: &str,
        bytes: &[u8],
    ) -> Result<WriteOutcome, PersistenceError> {
        let base = resolve_existing(&self.root, base_relative)?;
        let path = resolve_for_write(&base, relative)?;
        let outcome = write_atomic(&path, bytes)?;
        self.ledger
            .record(&join_key(base_relative, relative), bytes);
        Ok(outcome)
    }

    /// Create-only write: `alreadyExists` if anything is at the target.
    pub fn create_file(
        &mut self,
        base_relative: &str,
        relative: &str,
        bytes: &[u8],
    ) -> Result<(), PersistenceError> {
        let base = resolve_existing(&self.root, base_relative)?;
        let path = resolve_for_create(&base, relative)?;
        create_new_file(&path, bytes)?;
        self.ledger
            .record(&join_key(base_relative, relative), bytes);
        Ok(())
    }

    /// Creates exactly one new directory; `alreadyExists` if it is already there.
    pub fn create_directory(
        &mut self,
        base_relative: &str,
        relative: &str,
    ) -> Result<(), PersistenceError> {
        let base = resolve_existing(&self.root, base_relative)?;
        let path = resolve_for_create(&base, relative)?;
        fs::create_dir(&path).map_err(|error| {
            PersistenceError::from_io(format!("create directory {relative:?}"), &error)
        })
    }

    /// Like `create_directory`, but an existing directory is fine.
    pub fn ensure_directory(
        &mut self,
        base_relative: &str,
        relative: &str,
    ) -> Result<(), PersistenceError> {
        match self.create_directory(base_relative, relative) {
            Err(error) if error.kind == PersistenceErrorKind::AlreadyExists => {
                let existing = self.resolve_existing_path(base_relative, relative)?;
                if existing.is_dir() {
                    Ok(())
                } else {
                    Err(error)
                }
            }
            other => other,
        }
    }

    /// Names of every entry in a directory, for collision-free name generation.
    pub fn entry_names(
        &self,
        base_relative: &str,
        relative: &str,
    ) -> Result<Vec<String>, PersistenceError> {
        let path = self.resolve_existing_path(base_relative, relative)?;
        Ok(list_directory(&path)?
            .into_iter()
            .map(|entry| entry.name)
            .collect())
    }

    /// Records the hash of a file read outside the session's own helpers (the `.dawn`).
    pub fn record_hash(&mut self, relative_path: &str, bytes: &[u8]) {
        self.ledger.record(relative_path, bytes);
    }

    pub fn remove_file(
        &mut self,
        base_relative: &str,
        relative: &str,
    ) -> Result<(), PersistenceError> {
        // Containment is proven on the resolved target, but the entry itself is removed:
        // if it is a symlink, deleting the resolved target would destroy another file
        // (for example a different Block's content) instead of this Block's link.
        self.resolve_existing_path(base_relative, relative)?;
        let base = resolve_existing(&self.root, base_relative)?;
        let path = resolve_for_create(&base, relative)?;
        fs::remove_file(&path)
            .map_err(|error| PersistenceError::from_io(format!("remove {relative:?}"), &error))?;
        self.ledger.forget(&join_key(base_relative, relative));
        Ok(())
    }
}

pub fn document_base_path(directory_name: &str) -> String {
    format!("{DOCUMENTS_DIRECTORY_NAME}{PATH_SEPARATOR}{directory_name}")
}

/// All opened Projects, keyed by ID. Held as Tauri managed state behind a `Mutex`.
#[derive(Debug, Default)]
pub struct ProjectSessions {
    sessions: HashMap<ProjectId, ProjectSession>,
}

impl ProjectSessions {
    /// Reopening a Project replaces its session, so stale writability flags cannot survive.
    pub fn insert(&mut self, session: ProjectSession) {
        self.sessions.insert(*session.project_id(), session);
    }

    /// Parses the ID text first, so malformed IDs are `invalidEntityId` rather than "not open".
    pub fn session_mut(&mut self, project_id: &str) -> ApplicationResult<&mut ProjectSession> {
        let project_id = ProjectId::parse(project_id)?;
        self.get_mut(&project_id)
    }

    pub fn get(&self, project_id: &ProjectId) -> ApplicationResult<&ProjectSession> {
        self.sessions.get(project_id).ok_or_else(|| {
            ApplicationError::project_not_open(format!("project is not open: {project_id}"))
        })
    }

    pub fn get_mut(&mut self, project_id: &ProjectId) -> ApplicationResult<&mut ProjectSession> {
        self.sessions.get_mut(project_id).ok_or_else(|| {
            ApplicationError::project_not_open(format!("project is not open: {project_id}"))
        })
    }
}
