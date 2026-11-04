//! Explicit, confirmed repairs of Load Issues.
//!
//! Loading only reports problems and normalises them in memory. A repair is the user's
//! choice to make the files agree with that normalised view, one issue at a time:
//!
//! 1. The issue the caller names must still be reported by a fresh read of the Project
//!    (`FreshScan`); otherwise nothing is done (`issueGone`). The caller cannot make the
//!    app change anything the loader does not itself consider broken.
//! 2. The change is planned from that fresh read. A repair that cannot be made safely is
//!    reported as unavailable with a reason instead of being attempted.
//! 3. `dry_run` stops here and returns the files the repair would touch (for the dialog).
//! 4. Otherwise the changes are written through the open session, so a file that changed
//!    outside the app since the session read it is refused (`externallyModified`) and the
//!    Atomic Save, the hash ledger and the path checks all apply.
//!
//! Repairs are not part of Undo / Redo (like deleting a Sheet): the Frontend asks for
//! confirmation first and reads the affected Document or Project again afterwards.

use std::collections::HashSet;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::block_content_operations::is_text_block_type;
use super::entity_id_generator::{
    generate_block_id, generate_document_id, generate_folder_id, generate_sheet_id,
};
use super::error::{ApplicationError, ApplicationResult};
use super::fresh_scan::FreshScan;
use super::load_issue::{LoadIssue, LoadIssueKind};
use super::loader::normalize_order;
use super::session::{ProjectSession, ProjectSessions};
use super::snapshot::DocumentSnapshot;
use crate::domain::block_type::{BlockType, BLOCK_TYPE_DEFINITIONS};
use crate::domain::constants::{
    BLOCKS_DIRECTORY_NAME, DEFAULT_NEW_BLOCK_GAP, DEFAULT_NEW_BLOCK_HEIGHT,
    DEFAULT_NEW_BLOCK_WIDTH, DEFAULT_NEW_BLOCK_X, DEFAULT_NEW_BLOCK_Y, EXTENSION_SEPARATOR,
    PATH_SEPARATOR, SHEETS_DIRECTORY_NAME,
};
use crate::domain::content_path::ContentPath;
use crate::domain::entity_id::{DocumentId, EntryId, SheetId};
use crate::domain::error::DomainError;
use crate::infrastructure::file_format::constants::{
    DOCUMENTS_DIRECTORY_NAME, DOCUMENT_FILE_NAME, ENTRY_POINT_EXTENSION, ENTRY_POINT_MAX_BYTES,
    FOLDER_FILE_NAME, PROJECT_FILE_NAME, SHEET_FILE_NAME,
};
use crate::infrastructure::file_format::dto::{
    parse_dto, to_json_bytes, BlockDto, DocumentDto, EntryPointDto, FolderDto, PositionDto,
    ProjectDto, SheetDto, SizeDto,
};
use crate::infrastructure::file_format::migration::{migrate_to_current, MigrationTarget};
use crate::infrastructure::filesystem::atomic_write::is_temp_file_name;
use crate::infrastructure::filesystem::directory::{list_directory, EntryKind};
use crate::infrastructure::filesystem::text_content::encode_text;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RepairAction {
    /// `unlistedEntity`: append the item to its parent's order list.
    AddToList,
    /// `missingEntity` / `invalidOrderEntry`: drop the entry from the order list.
    RemoveFromList,
    /// `duplicateEntityId`: give the copy the loader ignored a new ID.
    GiveNewId,
    /// `missingContent`: remove the Block that refers to the missing file.
    RemoveBlock,
    /// `missingContent`: create the missing text file, empty.
    CreateEmptyContent,
    /// `orphanContent`: delete the file no Block uses.
    DeleteFile,
    /// `orphanContent`: add a Block that uses the text file.
    AddAsBlock,
    /// `leftoverTempFile`: delete the temporary file.
    DeleteTempFile,
}

impl RepairAction {
    fn applies_to(self, kind: LoadIssueKind) -> bool {
        match self {
            Self::AddToList => kind == LoadIssueKind::UnlistedEntity,
            Self::RemoveFromList => matches!(
                kind,
                LoadIssueKind::MissingEntity | LoadIssueKind::InvalidOrderEntry
            ),
            Self::GiveNewId => kind == LoadIssueKind::DuplicateEntityId,
            Self::RemoveBlock | Self::CreateEmptyContent => kind == LoadIssueKind::MissingContent,
            Self::DeleteFile | Self::AddAsBlock => kind == LoadIssueKind::OrphanContent,
            Self::DeleteTempFile => kind == LoadIssueKind::LeftoverTempFile,
        }
    }
}

/// Identifies an issue as the Frontend received it. Matched against a fresh read; nothing in
/// it is used as a path before that match.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairIssueRef {
    pub kind: LoadIssueKind,
    pub path: Option<String>,
    pub entity_id: Option<String>,
}

impl RepairIssueRef {
    fn matches(&self, issue: &LoadIssue) -> bool {
        issue.kind == self.kind && issue.path == self.path && issue.entity_id == self.entity_id
    }
}

/// Why a repair is not offered or not done. The Frontend shows a sentence for each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RepairUnavailable {
    /// The issue is no longer reported: the files changed since it was shown.
    IssueGone,
    /// This action does not apply to this kind of issue.
    NotApplicable,
    /// A file the repair has to change cannot be read as a valid file of its kind.
    EntityUnreadable,
    /// The Sheet or Document that holds the change did not load, so it is never written.
    NotWritable,
    /// A Sheet that loaded uses the file, so deleting or adopting it would be wrong.
    ReferencedElsewhere,
    /// A Sheet of the Document failed to load, so it cannot be proven that none uses the file.
    SheetsNotLoaded,
    /// Only a text file (Markdown / Mermaid) can be created or adopted.
    UnsupportedContentType,
    /// Something already exists where the file would be created.
    PathOccupied,
    /// An entry point (`.dawn`) names this ID but not a location that can be told from the
    /// other copy, so it cannot be updated safely.
    AmbiguousReference,
    /// The Block, Sheet or entry the issue is about was not found in the files.
    TargetNotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairOutcome {
    /// False for a dry run and for an unavailable repair.
    pub applied: bool,
    /// Project-root-relative paths the repair changes (or would change).
    pub files: Vec<String>,
    pub unavailable: Option<RepairUnavailable>,
    /// The issues of the same scope (the Project, or the Document) as they are now.
    pub issues: Vec<LoadIssue>,
}

enum Change {
    Write {
        path: String,
        bytes: Vec<u8>,
    },
    Create {
        path: String,
        bytes: Vec<u8>,
    },
    /// Creates one directory (a Sheet's `blocks/`) when it is missing.
    EnsureDirectory {
        base: String,
        relative: String,
    },
    Delete {
        path: String,
    },
}

impl Change {
    fn reported_path(&self) -> Option<&str> {
        match self {
            Self::Write { path, .. } | Self::Create { path, .. } | Self::Delete { path } => {
                Some(path)
            }
            Self::EnsureDirectory { .. } => None,
        }
    }
}

enum Plan {
    Changes(Vec<Change>),
    Unavailable(RepairUnavailable),
}

enum Scope {
    Project,
    Document {
        id: DocumentId,
        base: String,
        snapshot: Box<DocumentSnapshot>,
    },
}

struct Context<'a> {
    scan: &'a mut FreshScan,
    real: &'a ProjectSession,
    scope: Scope,
    issue: &'a RepairIssueRef,
}

fn last_segment(path: &str) -> &str {
    path.rsplit(PATH_SEPARATOR).next().unwrap_or(path)
}

fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}{PATH_SEPARATOR}{name}")
    }
}

/// Reads and migrates one metadata file of the fresh scan, or `None` when it cannot be read
/// as a valid file of its kind.
fn read_dto<T: DeserializeOwned>(scan: &mut FreshScan, path: &str) -> Option<T> {
    let target = MigrationTarget::for_file_name(last_segment(path))?;
    let value = scan.session().read_json("", path).ok()?;
    let migrated = migrate_to_current(target, value).ok()?;
    parse_dto::<T>(migrated.value).ok()
}

#[derive(Debug, Clone)]
enum OrderEdit {
    Add(String),
    Remove(String),
    /// Drop entries that are not valid IDs and repeated entries.
    Normalize,
}

fn apply_order_edit<Id>(
    order: &mut Vec<String>,
    edit: &OrderEdit,
    parse: fn(&str) -> Result<Id, DomainError>,
    owner_path: &str,
) -> bool {
    match edit {
        OrderEdit::Add(id) => {
            if parse(id).is_err() {
                return false;
            }
            if !order.contains(id) {
                order.push(id.clone());
            }
        }
        OrderEdit::Remove(id) => order.retain(|entry| entry != id),
        OrderEdit::Normalize => *order = normalize_order(order, parse, owner_path, &mut Vec::new()),
    }
    true
}

/// The owner file's bytes with its order list edited, or `None` if it is unreadable.
fn edited_order_bytes(scan: &mut FreshScan, owner_path: &str, edit: &OrderEdit) -> Option<Vec<u8>> {
    let bytes = match MigrationTarget::for_file_name(last_segment(owner_path))? {
        MigrationTarget::Project => {
            let mut dto = read_dto::<ProjectDto>(scan, owner_path)?;
            apply_order_edit(&mut dto.child_order, edit, EntryId::parse, owner_path)
                .then(|| to_json_bytes(&dto))
        }
        MigrationTarget::Folder => {
            let mut dto = read_dto::<FolderDto>(scan, owner_path)?;
            apply_order_edit(&mut dto.child_order, edit, EntryId::parse, owner_path)
                .then(|| to_json_bytes(&dto))
        }
        MigrationTarget::Document => {
            let mut dto = read_dto::<DocumentDto>(scan, owner_path)?;
            apply_order_edit(&mut dto.sheet_order, edit, SheetId::parse, owner_path)
                .then(|| to_json_bytes(&dto))
        }
        MigrationTarget::Sheet | MigrationTarget::EntryPoint => None,
    };
    bytes?.ok()
}

impl Context<'_> {
    fn document(&self) -> Option<(&DocumentId, &str, &DocumentSnapshot)> {
        match &self.scope {
            Scope::Document { id, base, snapshot } => Some((id, base, snapshot.as_ref())),
            Scope::Project => None,
        }
    }

    /// The Project-relative `sheet.json` of a Sheet of the scoped Document.
    fn sheet_file(&mut self, sheet_id: &str) -> Option<String> {
        let (document_id, base) = {
            let (id, base, _) = self.document()?;
            (*id, base.to_owned())
        };
        let sheet_id = SheetId::parse(sheet_id).ok()?;
        let directory = self
            .scan
            .session()
            .document(&document_id)
            .ok()?
            .sheets
            .get(&sheet_id)?
            .directory_name
            .clone();
        Some(join(
            &join(&join(&base, SHEETS_DIRECTORY_NAME), &directory),
            SHEET_FILE_NAME,
        ))
    }

    /// Whether the open session may write this Sheet (it loaded there).
    fn sheet_is_writable(&self, sheet_id: &str) -> bool {
        let Some((document_id, _, _)) = self.document() else {
            return false;
        };
        let Ok(sheet_id) = SheetId::parse(sheet_id) else {
            return false;
        };
        self.real.document(document_id).ok().is_some_and(|record| {
            record.writable
                && record
                    .sheets
                    .get(&sheet_id)
                    .is_some_and(|sheet| sheet.writable)
        })
    }

    fn document_is_writable(&self) -> bool {
        self.document().is_some_and(|(id, _, _)| {
            self.real
                .document(id)
                .ok()
                .is_some_and(|record| record.writable)
        })
    }
}

fn plan_add_or_remove(ctx: &mut Context<'_>, action: RepairAction) -> Plan {
    let issue = ctx.issue;
    let Some(path) = issue.path.as_deref() else {
        return Plan::Unavailable(RepairUnavailable::TargetNotFound);
    };
    let owner = match issue.kind {
        LoadIssueKind::UnlistedEntity => {
            let Some((parent, _)) = path.rsplit_once(PATH_SEPARATOR) else {
                return Plan::Unavailable(RepairUnavailable::TargetNotFound);
            };
            match &ctx.scope {
                Scope::Document { base, .. } => (parent == join(base, SHEETS_DIRECTORY_NAME))
                    .then(|| join(base, DOCUMENT_FILE_NAME)),
                Scope::Project if parent == DOCUMENTS_DIRECTORY_NAME => {
                    Some(PROJECT_FILE_NAME.to_owned())
                }
                Scope::Project => Some(join(parent, FOLDER_FILE_NAME)),
            }
        }
        _ => match &ctx.scope {
            Scope::Document { base, .. } => {
                (path == join(base, DOCUMENT_FILE_NAME)).then(|| path.to_owned())
            }
            Scope::Project => matches!(last_segment(path), PROJECT_FILE_NAME | FOLDER_FILE_NAME)
                .then(|| path.to_owned()),
        },
    };
    let Some(owner) = owner else {
        return Plan::Unavailable(RepairUnavailable::TargetNotFound);
    };
    if matches!(ctx.scope, Scope::Document { .. }) && !ctx.document_is_writable() {
        return Plan::Unavailable(RepairUnavailable::NotWritable);
    }
    let edit = match (action, issue.kind) {
        (RepairAction::AddToList, _) => match &issue.entity_id {
            Some(id) => OrderEdit::Add(id.clone()),
            None => return Plan::Unavailable(RepairUnavailable::TargetNotFound),
        },
        (_, LoadIssueKind::MissingEntity) => match &issue.entity_id {
            Some(id) => OrderEdit::Remove(id.clone()),
            None => return Plan::Unavailable(RepairUnavailable::TargetNotFound),
        },
        _ => OrderEdit::Normalize,
    };
    match edited_order_bytes(ctx.scan, &owner, &edit) {
        Some(bytes) => Plan::Changes(vec![Change::Write { path: owner, bytes }]),
        None => Plan::Unavailable(RepairUnavailable::EntityUnreadable),
    }
}

/// An ID that no Folder, Document, Sheet or Block of the scan uses.
fn fresh_id<Id: ToString>(generate: fn() -> Id, taken: &HashSet<String>) -> String {
    loop {
        let candidate = generate().to_string();
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
}

fn used_ids(ctx: &mut Context<'_>) -> HashSet<String> {
    let mut taken = HashSet::new();
    let session = ctx.scan.session();
    taken.extend(session.documents().keys().map(ToString::to_string));
    taken.extend(session.folders().keys().map(ToString::to_string));
    if let Some((_, _, snapshot)) = ctx.document() {
        for entry in &snapshot.sheets {
            taken.insert(entry.sheet_id.clone());
            if let Some(sheet) = &entry.sheet {
                taken.extend(sheet.blocks.iter().map(|block| block.block_id.clone()));
            }
        }
    }
    taken
}

/// `.dawn` files directly in the Project root that name `old_id`, as
/// `(path, entry)`. Larger or unreadable files are not entry points the app could open.
fn entry_points_naming(scan: &mut FreshScan, old_id: &str) -> Vec<(String, EntryPointDto)> {
    let Ok(root) = scan.session().resolve_existing_path("", "") else {
        return Vec::new();
    };
    let Ok(entries) = list_directory(&root) else {
        return Vec::new();
    };
    let suffix = format!("{EXTENSION_SEPARATOR}{ENTRY_POINT_EXTENSION}");
    let mut found = Vec::new();
    for entry in entries {
        if entry.kind != EntryKind::File || !entry.is_utf8_name || !entry.name.ends_with(&suffix) {
            continue;
        }
        let too_large = std::fs::metadata(root.join(&entry.name))
            .map_or(true, |metadata| metadata.len() > ENTRY_POINT_MAX_BYTES);
        if too_large {
            continue;
        }
        let Ok(value) = scan.session().read_json("", &entry.name) else {
            continue;
        };
        if let Ok(dto) = parse_dto::<EntryPointDto>(value) {
            if dto.document_id == old_id {
                found.push((entry.name, dto));
            }
        }
    }
    found
}

fn trim_separators(path: &str) -> &str {
    path.trim_end_matches(PATH_SEPARATOR)
}

fn plan_new_id(ctx: &mut Context<'_>) -> ApplicationResult<Plan> {
    let (Some(path), Some(old_id)) = (ctx.issue.path.clone(), ctx.issue.entity_id.clone()) else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    let taken = used_ids(ctx);
    if matches!(ctx.scope, Scope::Document { .. }) {
        if !ctx.document_is_writable() {
            return Ok(Plan::Unavailable(RepairUnavailable::NotWritable));
        }
        // A Block ID used in two Sheets is reported at the later Sheet's `sheet.json`; a Sheet
        // ID used twice is reported at the later Sheet's directory.
        if last_segment(&path) == SHEET_FILE_NAME {
            let Some(mut sheet) = read_dto::<SheetDto>(ctx.scan, &path) else {
                return Ok(Plan::Unavailable(RepairUnavailable::EntityUnreadable));
            };
            let Some(block) = sheet.blocks.iter_mut().find(|b| b.block_id == old_id) else {
                return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
            };
            block.block_id = fresh_id(generate_block_id, &taken);
            return Ok(Plan::Changes(vec![Change::Write {
                bytes: to_json_bytes(&sheet)?,
                path,
            }]));
        }
        let file = join(&path, SHEET_FILE_NAME);
        let Some(mut sheet) = read_dto::<SheetDto>(ctx.scan, &file) else {
            return Ok(Plan::Unavailable(RepairUnavailable::EntityUnreadable));
        };
        if sheet.sheet_id != old_id {
            return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
        }
        sheet.sheet_id = fresh_id(generate_sheet_id, &taken);
        return Ok(Plan::Changes(vec![Change::Write {
            bytes: to_json_bytes(&sheet)?,
            path: file,
        }]));
    }

    // A Folder or Document directory.
    let folder_file = join(&path, FOLDER_FILE_NAME);
    let document_file = join(&path, DOCUMENT_FILE_NAME);
    let is_file = |scan: &mut FreshScan, file: &str| {
        scan.session()
            .resolve_existing_path("", file)
            .is_ok_and(|resolved| resolved.is_file())
    };
    if is_file(ctx.scan, &folder_file) {
        let Some(mut folder) = read_dto::<FolderDto>(ctx.scan, &folder_file) else {
            return Ok(Plan::Unavailable(RepairUnavailable::EntityUnreadable));
        };
        if folder.folder_id != old_id {
            return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
        }
        folder.folder_id = fresh_id(generate_folder_id, &taken);
        return Ok(Plan::Changes(vec![Change::Write {
            bytes: to_json_bytes(&folder)?,
            path: folder_file,
        }]));
    }
    if !is_file(ctx.scan, &document_file) {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    }
    let Some(mut document) = read_dto::<DocumentDto>(ctx.scan, &document_file) else {
        return Ok(Plan::Unavailable(RepairUnavailable::EntityUnreadable));
    };
    if document.document_id != old_id {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    }
    let new_id = fresh_id(generate_document_id, &taken);
    document.document_id = new_id.clone();
    let mut changes = vec![Change::Write {
        bytes: to_json_bytes(&document)?,
        path: document_file,
    }];

    // The Document's ID is also what an entry point opens it by. The ones that point at this
    // copy follow the new ID; the ones that point at the other copy stay as they are; one that
    // cannot be told apart makes the repair unavailable rather than guessed.
    let kept_directory = DocumentId::parse(&old_id)
        .ok()
        .and_then(|id| ctx.scan.session().documents().get(&id).cloned())
        .map(|record| join(DOCUMENTS_DIRECTORY_NAME, &record.relative_path));
    for (name, mut entry) in entry_points_naming(ctx.scan, &old_id) {
        let entry_path = trim_separators(&entry.path);
        if entry_path == trim_separators(&path) {
            entry.document_id = new_id.clone();
            changes.push(Change::Write {
                bytes: to_json_bytes(&entry)?,
                path: name,
            });
        } else if kept_directory.as_deref() != Some(entry_path) {
            return Ok(Plan::Unavailable(RepairUnavailable::AmbiguousReference));
        }
    }
    Ok(Plan::Changes(changes))
}

/// The Sheet (its ID, `sheet.json` path and DTO) that holds the Block of a content issue.
struct BlockLocation {
    sheet_id: String,
    sheet_file: String,
    sheet: SheetDto,
}

fn locate_block(ctx: &mut Context<'_>) -> Option<BlockLocation> {
    let block_id = ctx.issue.entity_id.clone()?;
    let path = ctx.issue.path.clone()?;
    let (_, base, snapshot) = ctx.document()?;
    let base = base.to_owned();
    let sheet = snapshot.sheets.iter().find_map(|entry| {
        let dto = entry.sheet.as_ref()?;
        dto.blocks
            .iter()
            .any(|block| block.block_id == block_id && join(&base, &block.content_path) == path)
            .then(|| (entry.sheet_id.clone(), dto.clone()))
    })?;
    let sheet_file = ctx.sheet_file(&sheet.0)?;
    Some(BlockLocation {
        sheet_id: sheet.0,
        sheet_file,
        sheet: sheet.1,
    })
}

fn plan_remove_block(ctx: &mut Context<'_>) -> ApplicationResult<Plan> {
    let Some(mut location) = locate_block(ctx) else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    if !ctx.sheet_is_writable(&location.sheet_id) {
        return Ok(Plan::Unavailable(RepairUnavailable::NotWritable));
    }
    let block_id = ctx.issue.entity_id.clone().unwrap_or_default();
    location
        .sheet
        .blocks
        .retain(|block| block.block_id != block_id);
    Ok(Plan::Changes(vec![Change::Write {
        bytes: to_json_bytes(&location.sheet)?,
        path: location.sheet_file,
    }]))
}

fn plan_create_empty_content(ctx: &mut Context<'_>) -> ApplicationResult<Plan> {
    let Some(location) = locate_block(ctx) else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    if !ctx.sheet_is_writable(&location.sheet_id) {
        return Ok(Plan::Unavailable(RepairUnavailable::NotWritable));
    }
    let block_id = ctx.issue.entity_id.clone().unwrap_or_default();
    let Some(block) = location
        .sheet
        .blocks
        .iter()
        .find(|b| b.block_id == block_id)
    else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    let Ok(block_type) = BlockType::parse(&block.block_type) else {
        return Ok(Plan::Unavailable(RepairUnavailable::UnsupportedContentType));
    };
    if !is_text_block_type(block_type) {
        return Ok(Plan::Unavailable(RepairUnavailable::UnsupportedContentType));
    }
    let path = ctx.issue.path.clone().unwrap_or_default();
    if ctx.scan.session().resolve_existing_path("", &path).is_ok() {
        return Ok(Plan::Unavailable(RepairUnavailable::PathOccupied));
    }
    let (_, base, _) = ctx
        .document()
        .ok_or_else(|| ApplicationError::entity_not_found("no document in scope"))?;
    let base = base.to_owned();
    let blocks_directory = block
        .content_path
        .rsplit_once(PATH_SEPARATOR)
        .map(|(directory, _)| directory.to_owned())
        .unwrap_or_default();
    let mut changes = Vec::new();
    if blocks_directory.ends_with(BLOCKS_DIRECTORY_NAME) {
        changes.push(Change::EnsureDirectory {
            base,
            relative: blocks_directory,
        });
    }
    changes.push(Change::Create {
        path,
        bytes: encode_text(""),
    });
    Ok(Plan::Changes(changes))
}

/// Content files below `sheets/<directory>/blocks/` that an orphan issue can be about: the
/// file's Document-relative path, the Sheet directory and the file name.
struct OrphanFile {
    relative_path: String,
    sheet_directory: String,
    file_name: String,
}

fn locate_orphan(ctx: &Context<'_>) -> Option<OrphanFile> {
    let path = ctx.issue.path.as_deref()?;
    let (_, base, _) = ctx.document()?;
    let relative = path.strip_prefix(base)?.strip_prefix(PATH_SEPARATOR)?;
    let mut segments = relative.split(PATH_SEPARATOR);
    let (sheets, directory, blocks, file_name) = (
        segments.next()?,
        segments.next()?,
        segments.next()?,
        segments.next()?,
    );
    if sheets != SHEETS_DIRECTORY_NAME
        || blocks != BLOCKS_DIRECTORY_NAME
        || segments.next().is_some()
    {
        return None;
    }
    Some(OrphanFile {
        relative_path: relative.to_owned(),
        sheet_directory: directory.to_owned(),
        file_name: file_name.to_owned(),
    })
}

/// Every Sheet of the scoped Document, with whether it loaded, and the content paths the
/// loaded ones use.
fn content_paths_in_use(snapshot: &DocumentSnapshot) -> (HashSet<&str>, bool) {
    let mut used = HashSet::new();
    let mut every_sheet_loaded = true;
    for entry in &snapshot.sheets {
        match &entry.sheet {
            Some(sheet) => used.extend(sheet.blocks.iter().map(|b| b.content_path.as_str())),
            None => every_sheet_loaded = false,
        }
    }
    (used, every_sheet_loaded)
}

fn plan_delete_orphan(ctx: &mut Context<'_>) -> Plan {
    let Some(orphan) = locate_orphan(ctx) else {
        return Plan::Unavailable(RepairUnavailable::TargetNotFound);
    };
    let Some((_, _, snapshot)) = ctx.document() else {
        return Plan::Unavailable(RepairUnavailable::TargetNotFound);
    };
    let (used, every_sheet_loaded) = content_paths_in_use(snapshot);
    if used.contains(orphan.relative_path.as_str()) {
        return Plan::Unavailable(RepairUnavailable::ReferencedElsewhere);
    }
    if !every_sheet_loaded {
        return Plan::Unavailable(RepairUnavailable::SheetsNotLoaded);
    }
    let path = ctx.issue.path.clone().unwrap_or_default();
    Plan::Changes(vec![Change::Delete { path }])
}

fn block_type_for_extension(file_name: &str) -> Option<BlockType> {
    let (_, extension) = file_name.rsplit_once(EXTENSION_SEPARATOR)?;
    BLOCK_TYPE_DEFINITIONS
        .iter()
        .filter(|definition| is_text_block_type(definition.block_type))
        .find(|definition| {
            definition
                .extensions
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
        })
        .map(|definition| definition.block_type)
}

/// Below the lowest Block, so the adopted Block does not cover an existing one.
fn adopted_block_geometry(sheet: &SheetDto) -> (i64, i64) {
    let lowest_bottom = sheet
        .blocks
        .iter()
        .filter_map(|block| {
            let top = block.position.y.as_i64()?;
            let height = block.size.height.as_i64()?;
            Some(top.saturating_add(height))
        })
        .max();
    let y = lowest_bottom.map_or(DEFAULT_NEW_BLOCK_Y, |bottom| {
        bottom.saturating_add(DEFAULT_NEW_BLOCK_GAP)
    });
    (DEFAULT_NEW_BLOCK_X, y)
}

fn plan_add_as_block(ctx: &mut Context<'_>) -> ApplicationResult<Plan> {
    let Some(orphan) = locate_orphan(ctx) else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    let Some(block_type) = block_type_for_extension(&orphan.file_name) else {
        return Ok(Plan::Unavailable(RepairUnavailable::UnsupportedContentType));
    };
    if ContentPath::parse(block_type, &orphan.relative_path).is_err() {
        return Ok(Plan::Unavailable(RepairUnavailable::UnsupportedContentType));
    }
    let Some((document_id, _, snapshot)) = ctx.document() else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    let document_id = *document_id;
    let (used, _) = content_paths_in_use(snapshot);
    if used.contains(orphan.relative_path.as_str()) {
        return Ok(Plan::Unavailable(RepairUnavailable::ReferencedElsewhere));
    }
    // The Sheet that owns the directory the file is in.
    let owner = ctx
        .scan
        .session()
        .document(&document_id)?
        .sheets
        .iter()
        .find(|(_, record)| record.directory_name == orphan.sheet_directory)
        .map(|(id, _)| id.to_string());
    let Some(sheet_id) = owner else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    let sheet_dto = ctx.document().and_then(|(_, _, snapshot)| {
        snapshot
            .sheets
            .iter()
            .find(|entry| entry.sheet_id == sheet_id)
            .and_then(|entry| entry.sheet.clone())
    });
    let Some(mut sheet) = sheet_dto else {
        return Ok(Plan::Unavailable(RepairUnavailable::NotWritable));
    };
    if !ctx.sheet_is_writable(&sheet_id) {
        return Ok(Plan::Unavailable(RepairUnavailable::NotWritable));
    }
    let Some(sheet_file) = ctx.sheet_file(&sheet_id) else {
        return Ok(Plan::Unavailable(RepairUnavailable::TargetNotFound));
    };
    let taken = used_ids(ctx);
    let (x, y) = adopted_block_geometry(&sheet);
    sheet.blocks.push(BlockDto {
        block_id: fresh_id(generate_block_id, &taken),
        block_type: block_type.as_str().to_owned(),
        position: PositionDto {
            x: x.into(),
            y: y.into(),
        },
        size: SizeDto {
            width: DEFAULT_NEW_BLOCK_WIDTH.into(),
            height: DEFAULT_NEW_BLOCK_HEIGHT.into(),
        },
        content_path: orphan.relative_path,
        caption: None,
    });
    // The domain refuses what it would refuse on the next save (for example too many Blocks).
    sheet.to_domain()?;
    Ok(Plan::Changes(vec![Change::Write {
        bytes: to_json_bytes(&sheet)?,
        path: sheet_file,
    }]))
}

fn plan_delete_temp_file(ctx: &mut Context<'_>) -> Plan {
    let Some(path) = ctx.issue.path.clone() else {
        return Plan::Unavailable(RepairUnavailable::TargetNotFound);
    };
    // Project scope reports the Project root only; Document scope reports below its base.
    let in_scope = match &ctx.scope {
        Scope::Project => !path.contains(PATH_SEPARATOR),
        Scope::Document { base, .. } => path
            .strip_prefix(base.as_str())
            .is_some_and(|rest| rest.starts_with(PATH_SEPARATOR)),
    };
    if !in_scope || !is_temp_file_name(last_segment(&path)) {
        return Plan::Unavailable(RepairUnavailable::TargetNotFound);
    }
    let is_file = ctx
        .scan
        .session()
        .resolve_existing_path("", &path)
        .is_ok_and(|resolved| resolved.is_file());
    if !is_file {
        return Plan::Unavailable(RepairUnavailable::TargetNotFound);
    }
    Plan::Changes(vec![Change::Delete { path }])
}

fn plan(ctx: &mut Context<'_>, action: RepairAction) -> ApplicationResult<Plan> {
    match action {
        RepairAction::AddToList | RepairAction::RemoveFromList => {
            Ok(plan_add_or_remove(ctx, action))
        }
        RepairAction::GiveNewId => plan_new_id(ctx),
        RepairAction::RemoveBlock => plan_remove_block(ctx),
        RepairAction::CreateEmptyContent => plan_create_empty_content(ctx),
        RepairAction::DeleteFile => Ok(plan_delete_orphan(ctx)),
        RepairAction::AddAsBlock => plan_add_as_block(ctx),
        RepairAction::DeleteTempFile => Ok(plan_delete_temp_file(ctx)),
    }
}

fn apply(session: &mut ProjectSession, changes: Vec<Change>) -> ApplicationResult<()> {
    for change in changes {
        match change {
            Change::Write { path, bytes } => {
                session.write_file("", &path, &bytes)?;
            }
            Change::Create { path, bytes } => session.create_file("", &path, &bytes)?,
            Change::EnsureDirectory { base, relative } => {
                session.ensure_directory(&base, &relative)?;
            }
            Change::Delete { path } => session.remove_file("", &path)?,
        }
    }
    Ok(())
}

fn current_issues(
    session: &ProjectSession,
    document_id: Option<&DocumentId>,
) -> ApplicationResult<Vec<LoadIssue>> {
    let mut scan = FreshScan::open(session.root(), session.project_id())?;
    match document_id {
        None => Ok(scan.project.issues.clone()),
        Some(id) => Ok(scan.load_document(id).map(|d| d.issues).unwrap_or_default()),
    }
}

/// Plans (and, unless `dry_run`, applies) one repair. `document_id` is the Document whose
/// load reported the issue, or `None` for an issue of the Project's own load.
pub fn repair_load_issue(
    sessions: &mut ProjectSessions,
    project_id: &str,
    document_id: Option<&str>,
    issue: &RepairIssueRef,
    action: RepairAction,
    dry_run: bool,
) -> ApplicationResult<RepairOutcome> {
    let session = sessions.session_mut(project_id)?;
    let document_id = document_id.map(DocumentId::parse).transpose()?;
    let mut scan = FreshScan::open(session.root(), session.project_id())?;
    let scope = match &document_id {
        None => Scope::Project,
        Some(id) => {
            session.document(id)?;
            let base = scan.session().document_base(id)?;
            let snapshot = scan.load_document(id)?;
            Scope::Document {
                id: *id,
                base,
                snapshot: Box::new(snapshot),
            }
        }
    };
    let issues_now = match &scope {
        Scope::Project => scan.project.issues.clone(),
        Scope::Document { snapshot, .. } => snapshot.issues.clone(),
    };
    let unavailable = |reason: RepairUnavailable| RepairOutcome {
        applied: false,
        files: Vec::new(),
        unavailable: Some(reason),
        issues: issues_now.clone(),
    };
    if !action.applies_to(issue.kind) {
        return Ok(unavailable(RepairUnavailable::NotApplicable));
    }
    if !issues_now.iter().any(|candidate| issue.matches(candidate)) {
        return Ok(unavailable(RepairUnavailable::IssueGone));
    }

    let planned = {
        let mut context = Context {
            scan: &mut scan,
            real: session,
            scope,
            issue,
        };
        plan(&mut context, action)?
    };
    let changes = match planned {
        Plan::Unavailable(reason) => return Ok(unavailable(reason)),
        Plan::Changes(changes) => changes,
    };
    let files: Vec<String> = changes
        .iter()
        .filter_map(Change::reported_path)
        .map(str::to_owned)
        .collect();
    if dry_run {
        return Ok(RepairOutcome {
            applied: false,
            files,
            unavailable: None,
            issues: issues_now,
        });
    }
    apply(session, changes)?;
    let issues = current_issues(session, document_id.as_ref())?;
    Ok(RepairOutcome {
        applied: true,
        files,
        unavailable: None,
        issues,
    })
}
