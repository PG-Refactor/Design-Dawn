//! Project Session: what the Rust side remembers about an opened Project
//! (docs/architecture.md §6.1). All file access for a Project goes through here so that
//! path containment checks and the hash ledger cannot be bypassed.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::domain::block_type::BlockType;
use crate::domain::constants::PATH_SEPARATOR;
use crate::domain::entity_id::{DocumentId, FolderId, ProjectId, SheetId};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::{DOCUMENTS_DIRECTORY_NAME, FOLDER_FILE_NAME};
use crate::infrastructure::file_format::dto::parse_json_text;
use crate::infrastructure::file_format::naming::moved_directory_name;
use crate::infrastructure::filesystem::atomic_write::{
    create_new_file, is_temp_file_name, write_atomic, WriteOutcome,
};
use crate::infrastructure::filesystem::directory::{list_directory, EntryKind};
use crate::infrastructure::filesystem::hashing::sha256_hex;
use crate::infrastructure::filesystem::path_resolution::{
    resolve_existing, resolve_for_create, resolve_for_write, resolve_real_directory,
    resolve_removable_directory,
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

    /// Every recorded `(path, hash)`, in path order.
    pub fn entries(&self) -> impl Iterator<Item = (&str, &str)> {
        self.hashes
            .iter()
            .map(|(path, hash)| (path.as_str(), hash.as_str()))
    }

    /// Whether `bytes` are exactly what was last recorded for the path. `None` when the path
    /// was never read or written, so there is nothing to compare with.
    pub fn matches(&self, relative_path: &str, bytes: &[u8]) -> Option<bool> {
        self.hash_of(relative_path)
            .map(|recorded| recorded == sha256_hex(bytes))
    }

    pub fn is_empty(&self) -> bool {
        self.hashes.is_empty()
    }

    /// Re-keys the entry for `old_directory` itself and everything below it, after the
    /// directory was renamed or moved, so the recorded hashes keep describing the same files.
    pub fn rename_under(&mut self, old_directory: &str, new_directory: &str) {
        let prefix = format!("{old_directory}{PATH_SEPARATOR}");
        let moved: Vec<(String, String)> = self
            .hashes
            .keys()
            .filter(|path| path.as_str() == old_directory || path.starts_with(&prefix))
            .map(|path| {
                (
                    path.clone(),
                    format!("{new_directory}{}", &path[old_directory.len()..]),
                )
            })
            .collect();
        for (old_path, new_path) in moved {
            if let Some(hash) = self.hashes.remove(&old_path) {
                self.hashes.insert(new_path, hash);
            }
        }
    }

    /// Drops the entry for `directory_relative` itself and everything below it.
    pub fn forget_under(&mut self, directory_relative: &str) {
        let prefix = format!("{directory_relative}{PATH_SEPARATOR}");
        self.hashes
            .retain(|path, _| path != directory_relative && !path.starts_with(&prefix));
    }
}

/// Identifies one numbering sequence: block content files of one type in one sheet
/// directory (file-format.md §9.3).
type BlockNumberKey = (DocumentId, String, BlockType);

/// Why a directory could not be removed, and whether the entity can still be loaded.
#[derive(Debug)]
pub struct DirectoryRemovalError {
    pub error: PersistenceError,
    /// False only when the removal started and its metadata file is gone, so the entity can
    /// no longer be loaded and the session must stop tracking it.
    pub metadata_survives: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetRecord {
    pub directory_name: String,
    /// Only a sheet that loaded successfully (or was created here) may be written.
    pub writable: bool,
}

/// Where a Folder lives and whether it may be written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderRecord {
    /// Path relative to `documents/` (`/`-separated, one segment per nesting level).
    pub relative_path: String,
    /// Only a folder whose `folder.json` loaded (or was created here) may be written.
    pub writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentRecord {
    /// Path relative to `documents/` (`/`-separated). A Document inside Folders has several
    /// segments, so this is never joined as a single directory name.
    pub relative_path: String,
    pub writable: bool,
    /// True between a successful `load_document` / `create_document` and `close_document`.
    /// Only an opened Document is served by the `dawn-asset` protocol or receives assets:
    /// a Document the user has not opened has no reason to expose its files to the webview.
    pub opened: bool,
    /// Filled by `load_document` / `create_sheet`; empty until then.
    pub sheets: BTreeMap<SheetId, SheetRecord>,
}

/// Source of `ProjectSession::generation`. Process-wide so that a session opened again for the
/// same Project (reload, reopen) always has a number no earlier session had.
static NEXT_SESSION_GENERATION: AtomicU64 = AtomicU64::new(FIRST_SESSION_GENERATION);
const FIRST_SESSION_GENERATION: u64 = 1;

#[derive(Debug)]
pub struct ProjectSession {
    root: PathBuf,
    project_id: ProjectId,
    /// Tells the Frontend which read of the Project a notification belongs to
    /// (docs/architecture.md §14.4): a notification made for an earlier session of the same
    /// Project describes files the Frontend has since read again.
    generation: u64,
    documents: BTreeMap<DocumentId, DocumentRecord>,
    folders: BTreeMap<FolderId, FolderRecord>,
    ledger: HashLedger,
    /// Highest block content number this session issued, restored or deleted per sequence.
    /// Kept in memory only: numbers are derived from file names, never stored in metadata,
    /// so after a restart a deleted highest number can be reused (file-format.md §9.3).
    block_numbers: HashMap<BlockNumberKey, u64>,
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
            generation: NEXT_SESSION_GENERATION.fetch_add(1, Ordering::Relaxed),
            documents: BTreeMap::new(),
            folders: BTreeMap::new(),
            ledger,
            block_numbers: HashMap::new(),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn project_id(&self) -> &ProjectId {
        &self.project_id
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn ledger(&self) -> &HashLedger {
        &self.ledger
    }

    pub fn documents(&self) -> &BTreeMap<DocumentId, DocumentRecord> {
        &self.documents
    }

    pub fn folders(&self) -> &BTreeMap<FolderId, FolderRecord> {
        &self.folders
    }

    /// Replaces everything the session knows about the Document tree, as one step so the two
    /// maps cannot disagree after a (re)load.
    pub fn replace_tree(
        &mut self,
        documents: BTreeMap<DocumentId, DocumentRecord>,
        folders: BTreeMap<FolderId, FolderRecord>,
    ) {
        self.documents = documents;
        self.folders = folders;
    }

    pub fn folder(&self, folder_id: &FolderId) -> ApplicationResult<&FolderRecord> {
        self.folders.get(folder_id).ok_or_else(|| {
            ApplicationError::entity_not_found(format!("unknown folderId: {folder_id}"))
        })
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
            &self.document(document_id)?.relative_path,
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

    /// Whether the session has read or written this file, so an external removal of it is a
    /// change (and not a file that was never there to begin with).
    pub fn has_record(&self, base_relative: &str, relative: &str) -> bool {
        self.ledger
            .hash_of(&join_key(base_relative, relative))
            .is_some()
    }

    /// Fails with `externallyModified` when the file this session has read or written is no
    /// longer what it recorded (changed, replaced or removed outside the app, docs/architecture.md
    /// §14.6): the write would discard that change. A path the session never read or wrote
    /// has nothing to compare with and passes.
    fn ensure_unchanged_since_recorded(
        &self,
        key: &str,
        path: &Path,
    ) -> Result<(), PersistenceError> {
        if self.ledger.hash_of(key).is_none() {
            return Ok(());
        }
        match fs::read(path) {
            Ok(bytes) if self.ledger.matches(key, &bytes) == Some(true) => Ok(()),
            Ok(_) => Err(PersistenceError::new(
                PersistenceErrorKind::ExternallyModified,
                format!("{key:?} changed on disk since it was last read or written"),
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Err(PersistenceError::new(
                    PersistenceErrorKind::ExternallyModified,
                    format!("{key:?} was removed from disk since it was last read or written"),
                ))
            }
            Err(error) => Err(PersistenceError::from_io(format!("read {key:?}"), &error)),
        }
    }

    /// Atomic overwrite. Refuses (`externallyModified`) when the file changed or disappeared
    /// outside the app since the session last read or wrote it, so an external edit is never
    /// overwritten silently; `accept_disk_state` is the explicit way past that.
    pub fn write_file(
        &mut self,
        base_relative: &str,
        relative: &str,
        bytes: &[u8],
    ) -> Result<WriteOutcome, PersistenceError> {
        let base = resolve_existing(&self.root, base_relative)?;
        let path = resolve_for_write(&base, relative)?;
        self.ensure_unchanged_since_recorded(&join_key(base_relative, relative), &path)?;
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

    /// Highest number the session has seen for this sequence, if any.
    pub fn block_number_high_water(
        &self,
        document_id: &DocumentId,
        sheet_directory: &str,
        block_type: BlockType,
    ) -> Option<u64> {
        self.block_numbers
            .get(&(*document_id, sheet_directory.to_owned(), block_type))
            .copied()
    }

    /// Raises (never lowers) the high-water mark of a sequence.
    pub fn note_block_number(
        &mut self,
        document_id: &DocumentId,
        sheet_directory: &str,
        block_type: BlockType,
        number: u64,
    ) {
        let mark = self
            .block_numbers
            .entry((*document_id, sheet_directory.to_owned(), block_type))
            .or_insert(number);
        *mark = (*mark).max(number);
    }

    /// Forgets the marks of one sheet directory, or of the whole document when `None`.
    pub fn forget_block_numbers(
        &mut self,
        document_id: &DocumentId,
        sheet_directory: Option<&str>,
    ) {
        self.block_numbers.retain(|(document, directory, _), _| {
            document != document_id
                || sheet_directory.is_some_and(|forgotten| forgotten != directory)
        });
    }

    /// The user chose to overwrite what is on disk (docs/architecture.md §14.6, §14.9):
    /// every recorded file under `scope_prefix` is recorded again as it is now, and a file that
    /// is gone is forgotten so a save can create it again. Files outside the scope keep their
    /// record. A file that cannot be read for another reason keeps its record, so a later
    /// save still refuses it.
    pub fn accept_disk_state(&mut self, in_scope: impl Fn(&str) -> bool) {
        let paths: Vec<String> = self
            .ledger
            .entries()
            .map(|(path, _)| path.to_owned())
            .filter(|path| in_scope(path))
            .collect();
        for path in paths {
            match resolve_existing(&self.root, &path) {
                Ok(resolved) => {
                    if let Ok(bytes) = fs::read(resolved) {
                        self.ledger.record(&path, &bytes);
                    }
                }
                Err(error) if error.kind == PersistenceErrorKind::FileNotFound => {
                    self.ledger.forget(&path);
                }
                Err(_) => {}
            }
        }
    }

    pub fn forget_ledger_under(&mut self, directory_relative: &str) {
        self.ledger.forget_under(directory_relative);
    }

    pub fn insert_folder(&mut self, folder_id: FolderId, record: FolderRecord) {
        self.folders.insert(folder_id, record);
    }

    /// Project-root-relative directory of a Folder.
    pub fn folder_base(&self, folder_id: &FolderId) -> ApplicationResult<String> {
        Ok(document_base_path(&self.folder(folder_id)?.relative_path))
    }

    /// Whether any Folder or Document of this Project already uses the ID (IDs are unique
    /// across both kinds).
    pub fn entry_id_in_use(&self, entry_id: &uuid::Uuid) -> bool {
        self.documents.keys().any(|id| id.as_uuid() == entry_id)
            || self.folders.keys().any(|id| id.as_uuid() == entry_id)
    }

    /// Moves the directory `source_parent_relative/source_name` into
    /// `target_parent_relative` (both Project-root-relative) and returns the name it now has
    /// there: the same name, or a collision-free variant. Nothing is overwritten and no link
    /// is followed: the source must be a real directory and both parents must be reached
    /// without crossing a symlink. The directory is renamed in place on the same filesystem
    /// (`documents/`), so it is atomic. Session records are updated by the caller.
    pub fn move_directory(
        &mut self,
        source_parent_relative: &str,
        source_name: &str,
        target_parent_relative: &str,
    ) -> Result<String, PersistenceError> {
        let source = resolve_removable_directory(&self.root, source_parent_relative, source_name)?;
        resolve_real_directory(&self.root, source_parent_relative)?;
        let target_parent = resolve_real_directory(&self.root, target_parent_relative)?;
        if target_parent.starts_with(&source) {
            return Err(PersistenceError::new(
                PersistenceErrorKind::PathOutsideRoot,
                format!("{target_parent_relative:?} is inside the directory being moved"),
            ));
        }
        let existing: Vec<String> = list_directory(&target_parent)?
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        let new_name = moved_directory_name(source_name, &existing);
        let destination = target_parent.join(&new_name);
        // `rename` onto an empty directory would replace it on some platforms, so the
        // destination is checked right before (the listing above may be stale).
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(PersistenceError::new(
                PersistenceErrorKind::AlreadyExists,
                format!("{new_name:?} already exists in the target"),
            ));
        }
        fs::rename(&source, &destination).map_err(|error| {
            PersistenceError::from_io(format!("move directory {source_name:?}"), &error)
        })?;
        Ok(new_name)
    }

    /// After a directory moved: every Folder and Document record at or below `old_path`
    /// (relative to `documents/`) now lives under `new_path`, and the hash ledger follows.
    pub fn rename_tree(&mut self, old_path: &str, new_path: &str) {
        let prefix = format!("{old_path}{PATH_SEPARATOR}");
        let rebase = |path: &str| -> Option<String> {
            if path == old_path {
                Some(new_path.to_owned())
            } else {
                path.strip_prefix(&prefix)
                    .map(|rest| format!("{new_path}{PATH_SEPARATOR}{rest}"))
            }
        };
        for record in self.documents.values_mut() {
            if let Some(path) = rebase(&record.relative_path) {
                record.relative_path = path;
            }
        }
        for record in self.folders.values_mut() {
            if let Some(path) = rebase(&record.relative_path) {
                record.relative_path = path;
            }
        }
        self.ledger
            .rename_under(&document_base_path(old_path), &document_base_path(new_path));
    }

    /// Removes a Folder directory that holds nothing but `folder.json` and leftover temp
    /// files, then forgets the Folder. Anything else (a Document, a sub-folder, a stray
    /// file, a link) is `folderNotEmpty` and nothing is touched. The directory must be a real
    /// directory (never a link). The Folder is forgotten once `folder.json` is gone, since
    /// it can no longer be loaded.
    pub fn remove_empty_folder(&mut self, folder_id: &FolderId) -> ApplicationResult<()> {
        let relative_path = self.folder(folder_id)?.relative_path.clone();
        let (parent, directory_name) = split_entry_path(&relative_path);
        let directory = resolve_removable_directory(&self.root, &parent, directory_name)?;
        let mut removable = Vec::new();
        for entry in list_directory(&directory)? {
            let is_plain_file = entry.kind == EntryKind::File && !entry.is_symlink;
            let is_removable = entry.is_utf8_name
                && is_plain_file
                && (entry.name == FOLDER_FILE_NAME || is_temp_file_name(&entry.name));
            if !is_removable {
                return Err(ApplicationError::new(
                    ErrorKind::FolderNotEmpty,
                    format!("folder {folder_id} holds {:?}", entry.name),
                ));
            }
            removable.push(entry.name);
        }
        // `folder.json` last, so an interrupted removal leaves a folder that still loads.
        removable.sort_by_key(|name| name == FOLDER_FILE_NAME);
        let result = (|| -> Result<(), PersistenceError> {
            for name in &removable {
                fs::remove_file(directory.join(name)).map_err(|error| {
                    PersistenceError::from_io(format!("remove {name:?}"), &error)
                })?;
            }
            fs::remove_dir(&directory).map_err(|error| {
                PersistenceError::from_io(format!("remove directory {directory_name:?}"), &error)
            })
        })();
        let metadata_survives = fs::symlink_metadata(directory.join(FOLDER_FILE_NAME)).is_ok();
        if result.is_ok() || !metadata_survives {
            self.folders.remove(folder_id);
            self.ledger
                .forget_under(&document_base_path(&relative_path));
        }
        result.map_err(ApplicationError::from)
    }

    pub fn remove_document_record(&mut self, document_id: &DocumentId) {
        self.documents.remove(document_id);
    }

    /// Recursively deletes `parent_relative/directory_name` after proving it is a real
    /// directory inside the Project (see `resolve_removable_directory`). `remove_dir_all`
    /// removes symlinks it meets as links and never follows them. On failure the caller keeps
    /// the entity only while its `metadata_file_name` still exists: a half-deleted entity
    /// that can still load can be retried, one that cannot would only be reported as broken.
    pub fn remove_directory_tree(
        &mut self,
        parent_relative: &str,
        directory_name: &str,
        metadata_file_name: &str,
    ) -> Result<(), DirectoryRemovalError> {
        let directory = resolve_removable_directory(&self.root, parent_relative, directory_name)
            .map_err(|error| DirectoryRemovalError {
                error,
                metadata_survives: true,
            })?;
        fs::remove_dir_all(&directory).map_err(|error| DirectoryRemovalError {
            error: PersistenceError::new(
                PersistenceErrorKind::IoError,
                format!("remove directory {directory_name:?}: {error}"),
            ),
            metadata_survives: fs::symlink_metadata(directory.join(metadata_file_name)).is_ok(),
        })
    }

    pub fn remove_file(
        &mut self,
        base_relative: &str,
        relative: &str,
    ) -> Result<(), PersistenceError> {
        // Containment is proven on the resolved target, but the entry itself is removed:
        // if it is a symlink, deleting the resolved target would destroy another file
        // (for example a different Block's content) instead of this Block's link.
        let target = self.resolve_existing_path(base_relative, relative)?;
        let base = resolve_existing(&self.root, base_relative)?;
        let path = resolve_for_create(&base, relative)?;
        self.ensure_unchanged_since_recorded(&join_key(base_relative, relative), &target)?;
        fs::remove_file(&path)
            .map_err(|error| PersistenceError::from_io(format!("remove {relative:?}"), &error))?;
        self.ledger.forget(&join_key(base_relative, relative));
        Ok(())
    }
}

/// Project-root-relative directory of a Document or Folder given its path under `documents/`.
pub fn document_base_path(relative_path: &str) -> String {
    format!("{DOCUMENTS_DIRECTORY_NAME}{PATH_SEPARATOR}{relative_path}")
}

/// Splits a path under `documents/` into the Project-root-relative parent directory and the
/// last segment, which is the form `remove_directory_tree` needs.
pub fn split_entry_path(relative_path: &str) -> (String, &str) {
    match relative_path.rsplit_once(PATH_SEPARATOR) {
        Some((parent, name)) => (document_base_path(parent), name),
        None => (DOCUMENTS_DIRECTORY_NAME.to_owned(), relative_path),
    }
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

    /// Drops the session of a Project that no window has open any more.
    pub fn remove(&mut self, project_id: &ProjectId) -> Option<ProjectSession> {
        self.sessions.remove(project_id)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forget_under_removes_a_directory_but_not_a_sibling_sharing_its_prefix() {
        let mut ledger = HashLedger::default();
        for path in [
            "documents/a/document.json",
            "documents/a",
            "documents/ab/document.json",
        ] {
            ledger.record(path, b"x");
        }
        ledger.forget_under("documents/a");
        assert!(ledger.hash_of("documents/a").is_none());
        assert!(ledger.hash_of("documents/a/document.json").is_none());
        assert!(ledger.hash_of("documents/ab/document.json").is_some());
    }
}
