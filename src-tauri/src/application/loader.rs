//! Load-time reconciliation of the filesystem with the order arrays (docs/data-model.md §7).
//! Nothing in this module writes to disk: inconsistencies are reported as Load Issues and
//! normalized only in the returned values, to be persisted by a later explicit save.

use std::collections::{HashMap, HashSet};
use std::fmt::Display;
use std::hash::Hash;

use serde_json::Value;

use super::error::{ApplicationError, ApplicationResult};
use super::load_issue::{LoadIssue, LoadIssueKind};
use super::session::ProjectSession;
use crate::domain::constants::{
    ASSETS_DIRECTORY_NAME, BLOCKS_DIRECTORY_NAME, PATH_SEPARATOR, SHEETS_DIRECTORY_NAME,
};
use crate::domain::display_name::DisplayName;
use crate::domain::document::Document;
use crate::domain::entity_id::{BlockId, DocumentId, SheetId};
use crate::domain::error::DomainError;
use crate::domain::sheet::Sheet;
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::file_format::constants::{DOCUMENT_FILE_NAME, SHEET_FILE_NAME};
use crate::infrastructure::file_format::dto::{parse_dto, DocumentDto, SheetDto};
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
/// validates values that already passed this normalization (data-model.md §11.7).
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
            issues.push(LoadIssue::new(
                LoadIssueKind::EntityLoadFailed,
                Some(&path),
                scan.id.map(|id| id.to_string()),
                format!("{entity_label} failed to load: {error}"),
            ));
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

/// Lists the subdirectories of `container_path` in byte order. Non-directories are ignored;
/// directories with names that are not valid UTF-8 cannot be addressed and are reported.
fn child_directories(
    session: &ProjectSession,
    container_path: &str,
    issues: &mut Vec<LoadIssue>,
) -> Vec<String> {
    let mut names = Vec::new();
    for entry in list_optional_directory(session, container_path, issues) {
        if entry.kind != EntryKind::Directory {
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
}

pub(super) fn load_document_file(
    session: &mut ProjectSession,
    relative_file: &str,
    issues: &mut Vec<LoadIssue>,
) -> MetadataLoad<Document, DocumentId> {
    let value = match session.read_json("", relative_file) {
        Ok(value) => value,
        Err(error) => {
            return MetadataLoad {
                entity: Err(error.into()),
                recovered_id: None,
                recovered_name: None,
            }
        }
    };
    let (recovered_id, recovered_name) = recover_identity(&value, "documentId", DocumentId::parse);
    let entity = parse_dto::<DocumentDto>(value)
        .map_err(ApplicationError::from)
        .and_then(|mut dto| {
            dto.sheet_order =
                normalize_order(&dto.sheet_order, SheetId::parse, relative_file, issues);
            dto.to_domain().map_err(ApplicationError::from)
        });
    MetadataLoad {
        entity,
        recovered_id,
        recovered_name,
    }
}

pub(super) fn load_sheet_file(
    session: &mut ProjectSession,
    relative_file: &str,
) -> MetadataLoad<Sheet, SheetId> {
    let value = match session.read_json("", relative_file) {
        Ok(value) => value,
        Err(error) => {
            return MetadataLoad {
                entity: Err(error.into()),
                recovered_id: None,
                recovered_name: None,
            }
        }
    };
    let (recovered_id, recovered_name) = recover_identity(&value, "sheetId", SheetId::parse);
    let entity = parse_dto::<SheetDto>(value)
        .map_err(ApplicationError::from)
        .and_then(|dto| dto.to_domain().map_err(ApplicationError::from));
    MetadataLoad {
        entity,
        recovered_id,
        recovered_name,
    }
}

/// Scans `documents/` for Document directories. Order issues inside each `document.json`
/// are not reported here; `load_document` reports them when that Document is opened.
pub(super) fn scan_document_directories(
    session: &mut ProjectSession,
    container_path: &str,
    issues: &mut Vec<LoadIssue>,
) -> Vec<ScannedChild<DocumentId, Document>> {
    let mut scans = Vec::new();
    for name in child_directories(session, container_path, issues) {
        let directory_path = child_path(container_path, &name);
        let file_path = child_path(&directory_path, DOCUMENT_FILE_NAME);
        match classify_metadata_file(session, &file_path) {
            MetadataPresence::Absent => {
                issues.push(unrecognized_directory(&directory_path, DOCUMENT_FILE_NAME))
            }
            MetadataPresence::Unusable(error) => scans.push(ScannedChild {
                directory_name: name,
                id: None,
                name: None,
                payload: Err(error),
            }),
            MetadataPresence::Present => {
                let mut discarded = Vec::new();
                let loaded = load_document_file(session, &file_path, &mut discarded);
                let (id, display_name) = match &loaded.entity {
                    Ok(document) => (
                        Some(*document.document_id()),
                        Some(document.name().as_str().to_owned()),
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

pub(super) fn scan_sheet_directories(
    session: &mut ProjectSession,
    container_path: &str,
    issues: &mut Vec<LoadIssue>,
) -> Vec<ScannedChild<SheetId, Sheet>> {
    let mut scans = Vec::new();
    for name in child_directories(session, container_path, issues) {
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
