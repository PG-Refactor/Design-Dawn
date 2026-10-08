use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Number, Value};

use super::entity_id_generator::generate_project_id;
use super::error::{ApplicationError, ApplicationResult};
use super::loader::{normalize_order, report_leftover_temp_files, scan_entry_tree};
use super::session::{
    document_base_path, read_json_value, DocumentRecord, FolderRecord, HashLedger, ProjectSession,
    ProjectSessions,
};
use super::snapshot::{
    DocumentEntry, EntityState, EntryPointSnapshot, FolderEntry, ProjectSnapshot, SaveResult,
};
use crate::domain::constants::{
    CURRENT_PROJECT_SCHEMA_VERSION, LEGACY_PROJECT_SCHEMA_VERSION, PATH_SEPARATOR,
};
use crate::domain::content_path::validate_relative_path;
use crate::domain::display_name::DisplayName;
use crate::domain::entity_id::{DocumentId, EntryId, ProjectId};
use crate::domain::project::{Project, ProjectInput};
use crate::domain::schema_version::{SchemaEntityKind, SchemaVersion};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::{
    DOCUMENTS_DIRECTORY_NAME, GITATTRIBUTES_CONTENT, GITATTRIBUTES_FILE_NAME, PROJECT_FILE_NAME,
};
use crate::infrastructure::file_format::dto::{
    parse_dto, parse_json_text, schema_version_value, to_json_bytes, EntryPointDto,
    LegacyProjectDto, ProjectDto,
};
use crate::infrastructure::filesystem::atomic_write::WriteOutcome;
use crate::infrastructure::filesystem::path_resolution::{
    canonicalize_root, join_relative, resolve_existing,
};
use crate::infrastructure::filesystem::text_content::decode_text;

/// How `open_entry_point` located the Document (docs/file-format.md §7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryPointResolution {
    /// `.dawn` `path` pointed at a directory holding the matching `document.json`.
    Path,
    /// The path missed, so the Project was scanned for the `documentId`.
    IdScan,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenedEntryPoint {
    pub snapshot: EntryPointSnapshot,
    pub resolution: EntryPointResolution,
}

// A Project is usually created inside an existing folder such as a freshly initialised
// Git repository, so other entries (.git, README, ...) are allowed. Only the entries this
// operation would create must be absent; nothing existing is ever overwritten or adopted.
fn ensure_no_project_entries(project_root: &Path) -> ApplicationResult<()> {
    match fs::read_dir(project_root) {
        Ok(_) => {
            for reserved in [PROJECT_FILE_NAME, DOCUMENTS_DIRECTORY_NAME] {
                if fs::symlink_metadata(project_root.join(reserved)).is_ok() {
                    return Err(ApplicationError::persistence(
                        PersistenceErrorKind::AlreadyExists,
                        format!("{reserved} already exists in {}", project_root.display()),
                    ));
                }
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(project_root).map_err(|error| {
                ApplicationError::from(PersistenceError::from_io(
                    format!("create {}", project_root.display()),
                    &error,
                ))
            })
        }
        Err(error) => Err(PersistenceError::from_io(
            format!("read {}", project_root.display()),
            &error,
        )
        .into()),
    }
}

pub fn create_project(
    sessions: &mut ProjectSessions,
    project_root: &Path,
    name: &str,
) -> ApplicationResult<ProjectSnapshot> {
    let name = DisplayName::new(name)?;
    let project = Project::new(&ProjectInput {
        schema_version: i64::from(CURRENT_PROJECT_SCHEMA_VERSION),
        project_id: generate_project_id().to_string(),
        name: name.as_str().to_owned(),
        child_order: Vec::new(),
    })?;
    ensure_no_project_entries(project_root)?;
    let root = canonicalize_root(project_root)?;
    let mut session = ProjectSession::new(root, *project.project_id(), HashLedger::default());
    let dto = ProjectDto::from_domain(&project);
    session.create_file("", PROJECT_FILE_NAME, &to_json_bytes(&dto)?)?;
    session.ensure_directory("", DOCUMENTS_DIRECTORY_NAME)?;
    // An existing .gitattributes is the user's; it is never modified.
    match session.create_file(
        "",
        GITATTRIBUTES_FILE_NAME,
        GITATTRIBUTES_CONTENT.as_bytes(),
    ) {
        Ok(()) => {}
        Err(error) if error.kind == PersistenceErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    sessions.insert(session);
    Ok(ProjectSnapshot {
        project: dto,
        folders: Vec::new(),
        documents: Vec::new(),
        issues: Vec::new(),
    })
}

/// Reads `project.json` of either supported schema. The version decides the shape, so a
/// version-1 file with `childOrder` or a version-2 file with `documentOrder` is an
/// `invalidFileStructure` rather than being guessed at. A newer version is reported as
/// such before its (unknown) structure is looked at.
fn parse_project_file(value: Value) -> ApplicationResult<ProjectDto> {
    let version = value
        .get("schemaVersion")
        .and_then(Value::as_number)
        .map(|number| {
            SchemaVersion::parse(SchemaEntityKind::Project, schema_version_value(number))
        });
    match version {
        Some(Err(error)) => Err(error.into()),
        Some(Ok(version)) if version.get() == LEGACY_PROJECT_SCHEMA_VERSION => {
            Ok(parse_dto::<LegacyProjectDto>(value)?.into_current())
        }
        _ => Ok(parse_dto::<ProjectDto>(value)?),
    }
}

/// A Project that was read but is not yet in `ProjectSessions`. Splitting "read" from
/// "register" lets a window check that no other window has the Project before anything is
/// replaced (docs/architecture.md §11.0.1).
#[derive(Debug)]
pub struct LoadedProject {
    pub session: ProjectSession,
    pub snapshot: ProjectSnapshot,
}

pub fn open_project(
    sessions: &mut ProjectSessions,
    project_root: &Path,
) -> ApplicationResult<ProjectSnapshot> {
    let loaded = load_project(project_root)?;
    sessions.insert(loaded.session);
    Ok(loaded.snapshot)
}

pub fn load_project(project_root: &Path) -> ApplicationResult<LoadedProject> {
    let root = canonicalize_root(project_root)?;
    let mut ledger = HashLedger::default();
    let value = read_json_value(&root, &mut ledger, "", PROJECT_FILE_NAME)?;
    let mut dto = parse_project_file(value)?;
    let mut issues = Vec::new();
    dto.child_order = normalize_order(
        &dto.child_order,
        EntryId::parse,
        PROJECT_FILE_NAME,
        &mut issues,
    );
    let project = dto.to_domain()?;

    let mut session = ProjectSession::new(root, *project.project_id(), ledger);
    report_leftover_temp_files(&session, "", &mut issues);
    let tree = scan_entry_tree(&mut session, project.child_order(), &mut issues);

    let state_of = |loaded: bool| {
        if loaded {
            EntityState::Loaded
        } else {
            EntityState::LoadFailed
        }
    };
    let mut document_records = BTreeMap::new();
    let mut documents = Vec::with_capacity(tree.documents.len());
    for document in tree.documents {
        document_records.insert(
            document.document_id,
            DocumentRecord {
                relative_path: document.relative_path,
                writable: document.loaded,
                opened: false,
                sheets: BTreeMap::new(),
            },
        );
        documents.push(DocumentEntry {
            document_id: document.document_id.to_string(),
            parent_folder_id: document.parent.map(|parent| parent.to_string()),
            name: document.name,
            state: state_of(document.loaded),
        });
    }
    let mut folder_records = BTreeMap::new();
    let mut folders = Vec::with_capacity(tree.folders.len());
    for folder in tree.folders {
        folder_records.insert(
            folder.folder_id,
            FolderRecord {
                relative_path: folder.relative_path,
                writable: folder.loaded,
            },
        );
        folders.push(FolderEntry {
            folder_id: folder.folder_id.to_string(),
            name: folder.name,
            parent_folder_id: folder.parent.map(|parent| parent.to_string()),
            child_order: folder.child_order,
            state: state_of(folder.loaded),
        });
    }
    let mut project_dto = ProjectDto::from_domain(&project);
    project_dto.child_order = tree.child_order;
    session.replace_tree(document_records, folder_records);
    Ok(LoadedProject {
        session,
        snapshot: ProjectSnapshot {
            project: project_dto,
            folders,
            documents,
            issues,
        },
    })
}

pub fn save_project(
    sessions: &mut ProjectSessions,
    project_id: &str,
    project: &ProjectDto,
) -> ApplicationResult<SaveResult> {
    let session = sessions.session_mut(project_id)?;
    let project = project.to_domain()?;
    if project.project_id() != session.project_id() {
        return Err(ApplicationError::entity_not_found(format!(
            "payload projectId {} is not the open project {}",
            project.project_id(),
            session.project_id()
        )));
    }
    // Always the current format, even for a Project that was read as schemaVersion 1.
    let mut dto = ProjectDto::from_domain(&project);
    dto.schema_version = Number::from(CURRENT_PROJECT_SCHEMA_VERSION);
    let bytes = to_json_bytes(&dto)?;
    let outcome = session.write_file("", PROJECT_FILE_NAME, &bytes)?;
    Ok(SaveResult {
        written: outcome == WriteOutcome::Written,
    })
}

/// Walks up from the `.dawn` directory to the nearest directory holding `project.json`.
fn find_project_root(start_directory: &Path) -> ApplicationResult<PathBuf> {
    start_directory
        .ancestors()
        .find(|directory| directory.join(PROJECT_FILE_NAME).is_file())
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            ApplicationError::persistence(
                PersistenceErrorKind::FileNotFound,
                format!(
                    "no {PROJECT_FILE_NAME} in or above {}",
                    start_directory.display()
                ),
            )
        })
}

fn relative_key(root: &Path, file: &Path) -> Option<String> {
    let relative = file.strip_prefix(root).ok()?;
    let segments: Option<Vec<&str>> = relative
        .components()
        .map(|c| c.as_os_str().to_str())
        .collect();
    Some(segments?.join(&PATH_SEPARATOR.to_string()))
}

/// An entry point whose Project was read but not yet registered, see `LoadedProject`.
#[derive(Debug)]
pub struct PreparedEntryPoint {
    pub loaded: LoadedProject,
    pub document_id: String,
    pub resolution: EntryPointResolution,
}

pub fn open_entry_point(
    sessions: &mut ProjectSessions,
    entry_point_path: &Path,
) -> ApplicationResult<OpenedEntryPoint> {
    let prepared = prepare_entry_point(entry_point_path)?;
    sessions.insert(prepared.loaded.session);
    Ok(OpenedEntryPoint {
        snapshot: EntryPointSnapshot {
            snapshot: prepared.loaded.snapshot,
            document_id: prepared.document_id,
        },
        resolution: prepared.resolution,
    })
}

/// Which Project (and, for a `.dawn`, which Document) an open request is about. Read without
/// building a session or scanning the Project: it only decides which window handles it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeekedTarget {
    pub project_id: ProjectId,
    pub document_id: Option<DocumentId>,
}

fn read_project_id(project_root: &Path) -> ApplicationResult<ProjectId> {
    let root = canonicalize_root(project_root)?;
    let file = root.join(PROJECT_FILE_NAME);
    let bytes = fs::read(&file)
        .map_err(|error| PersistenceError::from_io(format!("read {}", file.display()), &error))?;
    let dto = parse_project_file(parse_json_text(&decode_text(&bytes)?)?)?;
    Ok(ProjectId::parse(&dto.project_id)?)
}

/// The Project in `project_root` (a folder that holds `project.json`).
pub fn peek_project_folder(project_root: &Path) -> ApplicationResult<PeekedTarget> {
    Ok(PeekedTarget {
        project_id: read_project_id(project_root)?,
        document_id: None,
    })
}

/// The Project above a `.dawn` and the Document it names, with the same lookups and checks
/// as `prepare_entry_point` for those two facts.
pub fn peek_entry_point(entry_point_path: &Path) -> ApplicationResult<PeekedTarget> {
    let entry_file = fs::canonicalize(entry_point_path).map_err(|error| {
        PersistenceError::from_io(format!("resolve {}", entry_point_path.display()), &error)
    })?;
    let bytes = fs::read(&entry_file).map_err(|error| {
        PersistenceError::from_io(format!("read {}", entry_file.display()), &error)
    })?;
    let entry: EntryPointDto = parse_dto(parse_json_text(&decode_text(&bytes)?)?)?;
    let document_id = entry.validated_document_id()?;
    let entry_directory = entry_file
        .parent()
        .ok_or_else(|| ApplicationError::entity_not_found("entry point has no directory"))?;
    let root = find_project_root(entry_directory)?;
    Ok(PeekedTarget {
        project_id: read_project_id(&root)?,
        document_id: Some(document_id),
    })
}

/// Reads the `.dawn` and its Project and finds the Document, without registering anything.
pub fn prepare_entry_point(entry_point_path: &Path) -> ApplicationResult<PreparedEntryPoint> {
    let entry_file = fs::canonicalize(entry_point_path).map_err(|error| {
        PersistenceError::from_io(format!("resolve {}", entry_point_path.display()), &error)
    })?;
    let bytes = fs::read(&entry_file).map_err(|error| {
        PersistenceError::from_io(format!("read {}", entry_file.display()), &error)
    })?;
    let entry: EntryPointDto = parse_dto(parse_json_text(&decode_text(&bytes)?)?)?;
    let document_id = entry.validated_document_id()?;
    let entry_directory = entry_file
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| ApplicationError::entity_not_found("entry point has no directory"))?;

    let root = find_project_root(&entry_directory)?;
    let mut loaded = load_project(&root)?;
    if let Some(key) = relative_key(loaded.session.root(), &entry_file) {
        loaded.session.record_hash(&key, &bytes);
    }

    let record = loaded.session.document(&document_id)?;
    let path_hit = validate_relative_path(&entry.path).is_ok()
        && fs::canonicalize(join_relative(&entry_directory, &entry.path))
            .ok()
            .zip(
                resolve_existing(
                    loaded.session.root(),
                    &document_base_path(&record.relative_path),
                )
                .ok(),
            )
            .is_some_and(|(pointed_at, document_directory)| pointed_at == document_directory);
    Ok(PreparedEntryPoint {
        loaded,
        document_id: document_id.to_string(),
        resolution: if path_hit {
            EntryPointResolution::Path
        } else {
            EntryPointResolution::IdScan
        },
    })
}
