//! Load-time reconciliation of the filesystem with the order arrays.
//! Nothing in this module writes to disk: inconsistencies are reported as Load Issues and
//! normalized only in the returned values, to be persisted by a later explicit save.

use std::collections::{HashMap, HashSet};
use std::fmt::Display;
use std::hash::Hash;
use uuid::Uuid;

use serde_json::Value;

use super::error::{ApplicationError, ApplicationResult};
use super::load_issue::{LoadIssue, LoadIssueKind};
use super::session::ProjectSession;
use crate::domain::constants::{
    ASSETS_DIRECTORY_NAME, BLOCKS_DIRECTORY_NAME, PATH_SEPARATOR, SHEETS_DIRECTORY_NAME,
};
use crate::domain::display_name::DisplayName;
use crate::domain::document::Document;
use crate::domain::entity_id::{BlockId, DocumentId, EntryId, FolderId, SheetId};
use crate::domain::error::DomainError;
use crate::domain::folder::Folder;
use crate::domain::sheet::Sheet;
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::{
    DOCUMENTS_DIRECTORY_NAME, DOCUMENT_FILE_NAME, FOLDER_FILE_NAME, PROJECT_FILE_NAME,
    SHEET_FILE_NAME,
};
use crate::infrastructure::file_format::dto::{parse_dto, DocumentDto, FolderDto, SheetDto};
use crate::infrastructure::file_format::migration::{
    migrate_to_current, MigrationError, MigrationTarget,
};
use crate::infrastructure::filesystem::atomic_write::is_temp_file_name;
use crate::infrastructure::filesystem::directory::{list_directory, DirectoryEntry, EntryKind};
use crate::infrastructure::filesystem::path_resolution::resolve_existing;

fn child_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}{PATH_SEPARATOR}{name}")
    }
}

/// One child directory as found on disk, before duplicate and order handling.
pub(super) struct ScannedChild<Id, Payload> {
    pub directory_name: String,
    /// The entity's ID: from the parsed file, or recovered from an unreadable one.
    pub id: Option<Id>,
    pub name: Option<String>,
    pub payload: Result<Payload, ApplicationError>,
}

pub(super) struct AcceptedChild<Id, Payload> {
    pub directory_name: String,
    pub id: Id,
    pub name: Option<String>,
    /// `None` when the entity failed to load; it is listed but never written.
    pub payload: Option<Payload>,
}

pub(super) fn recover_identity<Id>(
    value: &Value,
    id_key: &str,
    parse: fn(&str) -> Result<Id, DomainError>,
) -> (Option<Id>, Option<String>) {
    let id = value
        .get(id_key)
        .and_then(Value::as_str)
        .and_then(|text| parse(text).ok());
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|text| DisplayName::new(text).is_ok())
        .map(str::to_owned);
    (id, name)
}

/// Drops order entries that are not valid IDs or repeat an earlier entry. The domain only
/// validates values that already passed this normalization.
pub(super) fn normalize_order<Id>(
    raw: &[String],
    parse: fn(&str) -> Result<Id, DomainError>,
    owner_path: &str,
    issues: &mut Vec<LoadIssue>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut valid = Vec::new();
    for entry in raw {
        if parse(entry).is_err() {
            issues.push(LoadIssue::new(
                LoadIssueKind::InvalidOrderEntry,
                Some(owner_path),
                None,
                format!("not a valid id: {entry:?}"),
            ));
        } else if !seen.insert(entry.clone()) {
            issues.push(LoadIssue::new(
                LoadIssueKind::InvalidOrderEntry,
                Some(owner_path),
                Some(entry.clone()),
                "duplicate entry",
            ));
        } else {
            valid.push(entry.clone());
        }
    }
    valid
}

/// Applies duplicate-ID exclusion and the effective order to scanned children, which must
/// already be in byte-wise directory name order. `listed_order` must be normalized.
pub(super) fn reconcile_children<Id, Payload>(
    scans: Vec<ScannedChild<Id, Payload>>,
    listed_order: &[Id],
    container_path: &str,
    order_owner_path: &str,
    entity_label: &str,
    issues: &mut Vec<LoadIssue>,
) -> Vec<AcceptedChild<Id, Payload>>
where
    Id: Copy + Eq + Hash + Display,
{
    let mut accepted: Vec<AcceptedChild<Id, Payload>> = Vec::new();
    let mut index_by_id: HashMap<Id, usize> = HashMap::new();
    for scan in scans {
        let path = child_path(container_path, &scan.directory_name);
        if let Err(error) = &scan.payload {
            issues.push(
                LoadIssue::new(
                    LoadIssueKind::EntityLoadFailed,
                    Some(&path),
                    scan.id.map(|id| id.to_string()),
                    format!("{entity_label} failed to load: {error}"),
                )
                .with_reason(error),
            );
        }
        let Some(id) = scan.id else { continue };
        if let Some(first) = index_by_id.get(&id).map(|index| &accepted[*index]) {
            issues.push(LoadIssue::new(
                LoadIssueKind::DuplicateEntityId,
                Some(&path),
                Some(id.to_string()),
                format!(
                    "{entity_label} id is already used by directory {:?}; this one is ignored",
                    first.directory_name
                ),
            ));
            continue;
        }
        index_by_id.insert(id, accepted.len());
        accepted.push(AcceptedChild {
            directory_name: scan.directory_name,
            id,
            name: scan.name,
            payload: scan.payload.ok(),
        });
    }

    let mut slots: Vec<Option<AcceptedChild<Id, Payload>>> =
        accepted.into_iter().map(Some).collect();
    let mut ordered = Vec::with_capacity(slots.len());
    for id in listed_order {
        match index_by_id.get(id).and_then(|index| slots[*index].take()) {
            Some(child) => ordered.push(child),
            None => issues.push(LoadIssue::new(
                LoadIssueKind::MissingEntity,
                Some(order_owner_path),
                Some(id.to_string()),
                format!("listed {entity_label} does not exist on disk; ignored"),
            )),
        }
    }
    for child in slots.into_iter().flatten() {
        issues.push(LoadIssue::new(
            LoadIssueKind::UnlistedEntity,
            Some(&child_path(container_path, &child.directory_name)),
            Some(child.id.to_string()),
            format!("{entity_label} is not in the order list; appended"),
        ));
        ordered.push(child);
    }
    ordered
}

/// Lists a directory that may legitimately be absent. Other failures become issues
/// instead of aborting the whole load.
pub(super) fn list_optional_directory(
    session: &ProjectSession,
    path: &str,
    issues: &mut Vec<LoadIssue>,
) -> Vec<DirectoryEntry> {
    let listing = session
        .resolve_existing_path("", path)
        .and_then(|resolved| list_directory(&resolved));
    match listing {
        Ok(entries) => entries,
        Err(error) if error.kind == PersistenceErrorKind::FileNotFound => Vec::new(),
        Err(error) => {
            issues.push(LoadIssue::new(
                LoadIssueKind::EntityLoadFailed,
                Some(path),
                None,
                format!("cannot list directory: {error}"),
            ));
            Vec::new()
        }
    }
}

pub(super) fn report_leftover_temp_files(
    session: &ProjectSession,
    directory_path: &str,
    issues: &mut Vec<LoadIssue>,
) {
    for entry in list_optional_directory(session, directory_path, issues) {
        if entry.kind == EntryKind::File && is_temp_file_name(&entry.name) {
            issues.push(LoadIssue::new(
                LoadIssueKind::LeftoverTempFile,
                Some(&child_path(directory_path, &entry.name)),
                None,
                "an interrupted save left this temporary file behind",
            ));
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SymlinkPolicy {
    /// Sheets: a link to a directory inside the Project is read like a directory.
    Follow,
    /// The Folder / Document tree: links are reported and never entered, so a link cannot
    /// make a directory appear twice or lead a recursive scan into a cycle.
    Skip,
}

/// Lists the subdirectories of `container_path` in byte order. Non-directories are ignored;
/// directories with names that are not valid UTF-8 cannot be addressed and are reported.
fn child_directories(
    session: &ProjectSession,
    container_path: &str,
    symlinks: SymlinkPolicy,
    issues: &mut Vec<LoadIssue>,
) -> Vec<String> {
    let mut names = Vec::new();
    for entry in list_optional_directory(session, container_path, issues) {
        if entry.kind != EntryKind::Directory {
            continue;
        }
        if entry.is_symlink && symlinks == SymlinkPolicy::Skip {
            issues.push(LoadIssue::new(
                LoadIssueKind::UnrecognizedDirectory,
                Some(&child_path(container_path, &entry.name)),
                None,
                "symbolic links are not followed",
            ));
            continue;
        }
        if entry.is_utf8_name {
            names.push(entry.name);
        } else {
            issues.push(LoadIssue::new(
                LoadIssueKind::UnrecognizedDirectory,
                Some(container_path),
                None,
                format!("directory name is not valid UTF-8: {:?}", entry.name),
            ));
        }
    }
    names
}

pub(super) struct MetadataLoad<Entity, Id> {
    pub entity: Result<Entity, ApplicationError>,
    pub recovered_id: Option<Id>,
    pub recovered_name: Option<String>,
    /// The `schemaVersion` the file is written in when it is older than the current one:
    /// the entity was migrated in memory only and the file still holds the old format.
    pub migrated_from: Option<u32>,
}

impl From<MigrationError> for ApplicationError {
    fn from(error: MigrationError) -> Self {
        match error {
            MigrationError::Domain(error) => error.into(),
            MigrationError::Persistence(error) => error.into(),
        }
    }
}

/// The migrated JSON and the version the file was written in, when that was older.
pub(super) type MigratedMetadata = Result<(Value, Option<u32>), ApplicationError>;

/// Runs the migration registry over a metadata file's JSON. The identity is recovered from
/// the value as read, so an entity of an unsupported (newer) version is still listed by ID.
pub(super) fn migrate_metadata(target: MigrationTarget, value: Value) -> (Value, MigratedMetadata) {
    let original = value.clone();
    let migrated = migrate_to_current(target, value)
        .map(|migrated| (migrated.value, migrated.migrated_from))
        .map_err(ApplicationError::from);
    (original, migrated)
}

/// Reports a file that was read in an older format.
pub(super) fn report_outdated_format(
    path: &str,
    migrated_from: Option<u32>,
    issues: &mut Vec<LoadIssue>,
) {
    if let Some(version) = migrated_from {
        issues.push(LoadIssue::new(
            LoadIssueKind::OutdatedFormat,
            Some(path),
            None,
            format!("written as schemaVersion {version}"),
        ));
    }
}

fn unreadable<Entity, Id>(error: PersistenceError) -> MetadataLoad<Entity, Id> {
    MetadataLoad {
        entity: Err(error.into()),
        recovered_id: None,
        recovered_name: None,
        migrated_from: None,
    }
}

pub(super) fn load_document_file(
    session: &mut ProjectSession,
    relative_file: &str,
    issues: &mut Vec<LoadIssue>,
) -> MetadataLoad<Document, DocumentId> {
    let value = match session.read_json("", relative_file) {
        Ok(value) => value,
        Err(error) => return unreadable(error),
    };
    let (original, migrated) = migrate_metadata(MigrationTarget::Document, value);
    let (recovered_id, recovered_name) =
        recover_identity(&original, "documentId", DocumentId::parse);
    let migrated_from = migrated.as_ref().ok().and_then(|(_, from)| *from);
    let entity = migrated.and_then(|(value, _)| {
        let mut dto = parse_dto::<DocumentDto>(value)?;
        dto.sheet_order = normalize_order(&dto.sheet_order, SheetId::parse, relative_file, issues);
        dto.to_domain().map_err(ApplicationError::from)
    });
    MetadataLoad {
        entity,
        recovered_id,
        recovered_name,
        migrated_from,
    }
}

pub(super) fn load_sheet_file(
    session: &mut ProjectSession,
    relative_file: &str,
) -> MetadataLoad<Sheet, SheetId> {
    let value = match session.read_json("", relative_file) {
        Ok(value) => value,
        Err(error) => return unreadable(error),
    };
    let (original, migrated) = migrate_metadata(MigrationTarget::Sheet, value);
    let (recovered_id, recovered_name) = recover_identity(&original, "sheetId", SheetId::parse);
    let migrated_from = migrated.as_ref().ok().and_then(|(_, from)| *from);
    let entity = migrated.and_then(|(value, _)| {
        parse_dto::<SheetDto>(value)?
            .to_domain()
            .map_err(ApplicationError::from)
    });
    MetadataLoad {
        entity,
        recovered_id,
        recovered_name,
        migrated_from,
    }
}

pub(super) fn load_folder_file(
    session: &mut ProjectSession,
    relative_file: &str,
    issues: &mut Vec<LoadIssue>,
) -> MetadataLoad<Folder, FolderId> {
    let value = match session.read_json("", relative_file) {
        Ok(value) => value,
        Err(error) => return unreadable(error),
    };
    let (original, migrated) = migrate_metadata(MigrationTarget::Folder, value);
    let (recovered_id, recovered_name) = recover_identity(&original, "folderId", FolderId::parse);
    let migrated_from = migrated.as_ref().ok().and_then(|(_, from)| *from);
    let entity = migrated.and_then(|(value, _)| {
        let mut dto = parse_dto::<FolderDto>(value)?;
        dto.child_order = normalize_order(&dto.child_order, EntryId::parse, relative_file, issues);
        dto.to_domain().map_err(ApplicationError::from)
    });
    MetadataLoad {
        entity,
        recovered_id,
        recovered_name,
        migrated_from,
    }
}

/// A Folder or Document found on disk, with the data the session and snapshot need.
pub(super) struct ScannedFolder {
    pub folder_id: FolderId,
    /// Relative to `documents/`.
    pub relative_path: String,
    pub name: Option<String>,
    pub parent: Option<FolderId>,
    /// Effective (normalized) order; empty for a Folder that failed to load.
    pub child_order: Vec<String>,
    pub loaded: bool,
}

pub(super) struct ScannedDocument {
    pub document_id: DocumentId,
    /// Relative to `documents/`.
    pub relative_path: String,
    pub name: Option<String>,
    pub parent: Option<FolderId>,
    pub loaded: bool,
}

/// The reconciled content of one container (the Project's `documents/` or a Folder).
/// `folders` / `documents` hold the whole subtree, in effective display order depth-first.
#[derive(Default)]
pub(super) struct EntryTree {
    pub child_order: Vec<String>,
    pub folders: Vec<ScannedFolder>,
    pub documents: Vec<ScannedDocument>,
}

enum FoundKind {
    Folder(Box<(ScannedFolder, EntryTree)>),
    Document(ScannedDocument),
}

struct FoundEntry {
    directory_path: String,
    entry_id: EntryId,
    kind: FoundKind,
}

impl FoundEntry {
    fn label(&self) -> &'static str {
        match self.kind {
            FoundKind::Folder(_) => "folder",
            FoundKind::Document(_) => "document",
        }
    }
}

struct TreeScan<'a> {
    session: &'a mut ProjectSession,
    issues: &'a mut Vec<LoadIssue>,
    /// IDs are unique across Folders and Documents. The first directory in depth-first byte
    /// order keeps an ID, like among sibling Documents; the value is its path for the report.
    seen: HashMap<Uuid, String>,
}

/// Scans `documents/` recursively for Folders and Documents and applies each parent's order.
/// A directory with both `folder.json` and `document.json`, or neither,
/// is reported and not entered. A Folder that fails to load is listed but not entered: its
/// children cannot be ordered or attributed to it. Order issues inside each
/// `document.json` are reported by `load_document` when that Document is opened.
pub(super) fn scan_entry_tree(
    session: &mut ProjectSession,
    project_order: &[EntryId],
    issues: &mut Vec<LoadIssue>,
) -> EntryTree {
    let mut scan = TreeScan {
        session,
        issues,
        seen: HashMap::new(),
    };
    scan.container("", None, project_order, PROJECT_FILE_NAME)
}

impl TreeScan<'_> {
    fn container(
        &mut self,
        relative_path: &str,
        parent: Option<FolderId>,
        listed_order: &[EntryId],
        order_owner_path: &str,
    ) -> EntryTree {
        let container_path = join_documents_path(relative_path);
        let mut found = Vec::new();
        for name in child_directories(
            self.session,
            &container_path,
            SymlinkPolicy::Skip,
            self.issues,
        ) {
            if let Some(entry) = self.directory(relative_path, &name, parent) {
                found.push(entry);
            }
        }
        self.reconcile(found, listed_order, order_owner_path)
    }

    fn directory(
        &mut self,
        container_relative: &str,
        name: &str,
        parent: Option<FolderId>,
    ) -> Option<FoundEntry> {
        let relative_path = child_path(container_relative, name);
        let directory_path = join_documents_path(&relative_path);
        let folder_file = child_path(&directory_path, FOLDER_FILE_NAME);
        let document_file = child_path(&directory_path, DOCUMENT_FILE_NAME);
        let folder_presence = classify_metadata_file(self.session, &folder_file);
        let document_presence = classify_metadata_file(self.session, &document_file);
        let is_folder = !matches!(folder_presence, MetadataPresence::Absent);
        let is_document = !matches!(document_presence, MetadataPresence::Absent);
        match (is_folder, is_document) {
            (true, true) => {
                self.issues.push(LoadIssue::new(
                    LoadIssueKind::UnrecognizedDirectory,
                    Some(&directory_path),
                    None,
                    format!(
                        "both {FOLDER_FILE_NAME} and {DOCUMENT_FILE_NAME} exist in this directory"
                    ),
                ));
                None
            }
            (false, false) => {
                self.issues.push(LoadIssue::new(
                    LoadIssueKind::UnrecognizedDirectory,
                    Some(&directory_path),
                    None,
                    format!(
                        "neither {FOLDER_FILE_NAME} nor {DOCUMENT_FILE_NAME} in this directory"
                    ),
                ));
                None
            }
            (true, false) => self.folder(
                relative_path,
                directory_path,
                &folder_file,
                folder_presence,
                parent,
            ),
            (false, true) => self.document(
                relative_path,
                directory_path,
                &document_file,
                document_presence,
                parent,
            ),
        }
    }

    /// Reports a failed load and returns the identity, or `None` when the entity cannot be
    /// listed (no readable ID). Matches how failed Documents were always handled.
    fn report_failure(
        &mut self,
        label: &str,
        directory_path: &str,
        id: Option<Uuid>,
        error: Option<&ApplicationError>,
    ) {
        if let Some(error) = error {
            self.issues.push(
                LoadIssue::new(
                    LoadIssueKind::EntityLoadFailed,
                    Some(directory_path),
                    id.map(|id| id.to_string()),
                    format!("{label} failed to load: {error}"),
                )
                .with_reason(error),
            );
        }
    }

    /// True when the ID is new. A repeated ID is reported and the entity is excluded.
    fn claim_id(&mut self, label: &str, directory_path: &str, id: Uuid) -> bool {
        match self.seen.get(&id) {
            Some(first) => {
                self.issues.push(LoadIssue::new(
                    LoadIssueKind::DuplicateEntityId,
                    Some(directory_path),
                    Some(id.to_string()),
                    format!("{label} id is already used by {first:?}; this one is ignored"),
                ));
                false
            }
            None => {
                self.seen.insert(id, directory_path.to_owned());
                true
            }
        }
    }

    fn document(
        &mut self,
        relative_path: String,
        directory_path: String,
        file_path: &str,
        presence: MetadataPresence,
        parent: Option<FolderId>,
    ) -> Option<FoundEntry> {
        let (loaded, id, name) = match presence {
            MetadataPresence::Unusable(error) => (Err(error), None, None),
            _ => {
                let mut discarded = Vec::new();
                let result = load_document_file(self.session, file_path, &mut discarded);
                if result.entity.is_ok() {
                    report_outdated_format(file_path, result.migrated_from, self.issues);
                }
                match &result.entity {
                    Ok(document) => (
                        Ok(()),
                        Some(*document.document_id()),
                        Some(document.name().as_str().to_owned()),
                    ),
                    Err(error) => (
                        Err(error.clone()),
                        result.recovered_id,
                        result.recovered_name,
                    ),
                }
            }
        };
        self.report_failure(
            "document",
            &directory_path,
            id.as_ref().map(|id| *id.as_uuid()),
            loaded.as_ref().err(),
        );
        let id = id?;
        if !self.claim_id("document", &directory_path, *id.as_uuid()) {
            return None;
        }
        Some(FoundEntry {
            directory_path,
            entry_id: id.into(),
            kind: FoundKind::Document(ScannedDocument {
                document_id: id,
                relative_path,
                name,
                parent,
                loaded: loaded.is_ok(),
            }),
        })
    }

    fn folder(
        &mut self,
        relative_path: String,
        directory_path: String,
        file_path: &str,
        presence: MetadataPresence,
        parent: Option<FolderId>,
    ) -> Option<FoundEntry> {
        let mut order_issues = Vec::new();
        let (folder, id, name) = match presence {
            MetadataPresence::Unusable(error) => (Err(error), None, None),
            _ => {
                let result = load_folder_file(self.session, file_path, &mut order_issues);
                match result.entity {
                    Ok(folder) => {
                        report_outdated_format(file_path, result.migrated_from, &mut order_issues);
                        let identity = (
                            Some(*folder.folder_id()),
                            Some(folder.name().as_str().to_owned()),
                        );
                        (Ok(folder), identity.0, identity.1)
                    }
                    Err(error) => (Err(error), result.recovered_id, result.recovered_name),
                }
            }
        };
        self.report_failure(
            "folder",
            &directory_path,
            id.as_ref().map(|id| *id.as_uuid()),
            folder.as_ref().err(),
        );
        let id = id?;
        if !self.claim_id("folder", &directory_path, *id.as_uuid()) {
            return None;
        }
        let (loaded, subtree) = match folder {
            Ok(folder) => {
                self.issues.append(&mut order_issues);
                let subtree =
                    self.container(&relative_path, Some(id), folder.child_order(), file_path);
                (true, subtree)
            }
            Err(_) => (false, EntryTree::default()),
        };
        Some(FoundEntry {
            directory_path,
            entry_id: id.into(),
            kind: FoundKind::Folder(Box::new((
                ScannedFolder {
                    folder_id: id,
                    relative_path,
                    name,
                    parent,
                    child_order: subtree.child_order.clone(),
                    loaded,
                },
                subtree,
            ))),
        })
    }

    /// Puts the entries in the listed order, reports listed entries that do not exist, and
    /// appends unlisted ones in directory order (they arrive in byte order).
    fn reconcile(
        &mut self,
        found: Vec<FoundEntry>,
        listed_order: &[EntryId],
        order_owner_path: &str,
    ) -> EntryTree {
        let index_by_id: HashMap<EntryId, usize> = found
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.entry_id, index))
            .collect();
        let mut slots: Vec<Option<FoundEntry>> = found.into_iter().map(Some).collect();
        let mut ordered = Vec::with_capacity(slots.len());
        for id in listed_order {
            match index_by_id.get(id).and_then(|index| slots[*index].take()) {
                Some(entry) => ordered.push(entry),
                None => self.issues.push(LoadIssue::new(
                    LoadIssueKind::MissingEntity,
                    Some(order_owner_path),
                    Some(id.to_string()),
                    "listed entry does not exist on disk; ignored",
                )),
            }
        }
        for entry in slots.into_iter().flatten() {
            self.issues.push(LoadIssue::new(
                LoadIssueKind::UnlistedEntity,
                Some(&entry.directory_path),
                Some(entry.entry_id.to_string()),
                format!("{} is not in the order list; appended", entry.label()),
            ));
            ordered.push(entry);
        }

        let mut tree = EntryTree::default();
        for entry in ordered {
            tree.child_order.push(entry.entry_id.to_string());
            match entry.kind {
                FoundKind::Folder(boxed) => {
                    let (folder, subtree) = *boxed;
                    tree.folders.push(folder);
                    tree.folders.extend(subtree.folders);
                    tree.documents.extend(subtree.documents);
                }
                FoundKind::Document(document) => tree.documents.push(document),
            }
        }
        tree
    }
}

/// `documents/<relative_path>` as a Project-root-relative path (`documents` for the root).
fn join_documents_path(relative_path: &str) -> String {
    if relative_path.is_empty() {
        DOCUMENTS_DIRECTORY_NAME.to_owned()
    } else {
        child_path(DOCUMENTS_DIRECTORY_NAME, relative_path)
    }
}

pub(super) fn scan_sheet_directories(
    session: &mut ProjectSession,
    container_path: &str,
    issues: &mut Vec<LoadIssue>,
) -> Vec<ScannedChild<SheetId, Sheet>> {
    let mut scans = Vec::new();
    for name in child_directories(session, container_path, SymlinkPolicy::Follow, issues) {
        let directory_path = child_path(container_path, &name);
        let file_path = child_path(&directory_path, SHEET_FILE_NAME);
        match classify_metadata_file(session, &file_path) {
            MetadataPresence::Absent => {
                issues.push(unrecognized_directory(&directory_path, SHEET_FILE_NAME))
            }
            MetadataPresence::Unusable(error) => scans.push(ScannedChild {
                directory_name: name,
                id: None,
                name: None,
                payload: Err(error),
            }),
            MetadataPresence::Present => {
                let loaded = load_sheet_file(session, &file_path);
                if loaded.entity.is_ok() {
                    report_outdated_format(&file_path, loaded.migrated_from, issues);
                }
                let (id, display_name) = match &loaded.entity {
                    Ok(sheet) => (
                        Some(*sheet.sheet_id()),
                        Some(sheet.name().as_str().to_owned()),
                    ),
                    Err(_) => (loaded.recovered_id, loaded.recovered_name),
                };
                scans.push(ScannedChild {
                    directory_name: name,
                    id,
                    name: display_name,
                    payload: loaded.entity,
                });
            }
        }
    }
    scans
}

fn unrecognized_directory(directory_path: &str, expected_file: &str) -> LoadIssue {
    LoadIssue::new(
        LoadIssueKind::UnrecognizedDirectory,
        Some(directory_path),
        None,
        format!("no {expected_file} in this directory"),
    )
}

enum MetadataPresence {
    Present,
    Absent,
    /// The path exists but cannot be used (for example a symlink leaving the root).
    Unusable(ApplicationError),
}

fn classify_metadata_file(session: &ProjectSession, file_path: &str) -> MetadataPresence {
    match session.resolve_existing_path("", file_path) {
        Ok(resolved) if resolved.is_file() => MetadataPresence::Present,
        Ok(_) => MetadataPresence::Absent,
        Err(error) if error.kind == PersistenceErrorKind::FileNotFound => MetadataPresence::Absent,
        Err(error) => MetadataPresence::Unusable(error.into()),
    }
}

/// Block-level checks for one loaded Sheet: missing content, orphan files in `blocks/`.
pub(super) fn check_sheet_content(
    session: &ProjectSession,
    document_base: &str,
    sheet_directory_name: &str,
    sheet: &Sheet,
    issues: &mut Vec<LoadIssue>,
) -> ApplicationResult<()> {
    let document_root = session.resolve_existing_path("", document_base)?;
    let mut referenced = HashSet::new();
    for block in sheet.blocks() {
        let content_path = block.content_path().as_str();
        referenced.insert(content_path.to_owned());
        let present =
            resolve_existing(&document_root, content_path).map(|resolved| resolved.is_file());
        let problem = match present {
            Ok(true) => None,
            Ok(false) => Some("content path is not a file".to_owned()),
            // An escaping link is reported like a missing file: the content is unreachable,
            // and any read or write of it is refused with `pathOutsideRoot`.
            Err(error) => Some(error.to_string()),
        };
        if let Some(problem) = problem {
            issues.push(LoadIssue::new(
                LoadIssueKind::MissingContent,
                Some(&child_path(document_base, content_path)),
                Some(block.block_id().to_string()),
                problem,
            ));
        }
    }

    let blocks_relative = format!(
        "{SHEETS_DIRECTORY_NAME}{PATH_SEPARATOR}{sheet_directory_name}{PATH_SEPARATOR}{BLOCKS_DIRECTORY_NAME}"
    );
    let blocks_path = child_path(document_base, &blocks_relative);
    for entry in list_optional_directory(session, &blocks_path, issues) {
        let is_candidate = entry.kind == EntryKind::File && !is_temp_file_name(&entry.name);
        if is_candidate && !referenced.contains(&child_path(&blocks_relative, &entry.name)) {
            issues.push(LoadIssue::new(
                LoadIssueKind::OrphanContent,
                Some(&child_path(&blocks_path, &entry.name)),
                None,
                "no block references this file",
            ));
        }
    }
    Ok(())
}

/// Reports a Block ID that appears in more than one Sheet. Reported only, nothing is excluded.
pub(super) fn check_duplicate_block_ids(
    sheets: &[(&str, &str, &Sheet)],
    issues: &mut Vec<LoadIssue>,
) {
    let mut first_sheet: HashMap<BlockId, &str> = HashMap::new();
    for (sheet_file_path, sheet_id_text, sheet) in sheets {
        for block in sheet.blocks() {
            match first_sheet.get(block.block_id()) {
                Some(first) if first != sheet_id_text => issues.push(LoadIssue::new(
                    LoadIssueKind::DuplicateEntityId,
                    Some(sheet_file_path),
                    Some(block.block_id().to_string()),
                    format!("block id also used in sheet {first}"),
                )),
                Some(_) => {}
                None => {
                    first_sheet.insert(*block.block_id(), sheet_id_text);
                }
            }
        }
    }
}

pub(super) fn assets_path(document_base: &str) -> String {
    child_path(document_base, ASSETS_DIRECTORY_NAME)
}

pub(super) fn join_path(parent: &str, name: &str) -> String {
    child_path(parent, name)
}
