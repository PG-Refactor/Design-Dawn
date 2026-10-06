//! Folder commands (docs/architecture.md §6.2.4): create, save, move and delete. Folders are
//! plain directories under `documents/`; none of these operations touch the parents'
//! order arrays: the caller saves them afterwards, and loading normalizes whatever is stale.

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::session::{split_entry_path, FolderRecord, ProjectSession, ProjectSessions};
use super::snapshot::{EntityState, FolderSnapshot, SaveResult};
use crate::domain::constants::{CURRENT_FOLDER_SCHEMA_VERSION, PATH_SEPARATOR};
use crate::domain::display_name::DisplayName;
use crate::domain::entity_id::{DocumentId, FolderId};
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::domain::folder::{Folder, FolderInput};
use crate::infrastructure::file_format::constants::{
    DOCUMENTS_DIRECTORY_NAME, FOLDER_FILE_NAME, FOLDER_NAME_BASE,
};
use crate::infrastructure::file_format::dto::{to_json_bytes, FolderDto};
use crate::infrastructure::file_format::naming::unique_directory_name;
use crate::infrastructure::filesystem::atomic_write::WriteOutcome;

/// The directory a new Folder or Document is created in.
pub(super) struct ParentDirectory {
    /// Project-root-relative directory (`documents` or `documents/<folder path>`).
    pub base: String,
    /// Path relative to `documents/`; empty for the Project root.
    relative: String,
}

impl ParentDirectory {
    /// The new child's path relative to `documents/`.
    pub fn child_relative_path(&self, directory_name: &str) -> String {
        if self.relative.is_empty() {
            directory_name.to_owned()
        } else {
            format!("{}{PATH_SEPARATOR}{directory_name}", self.relative)
        }
    }
}

/// Resolves `None` (the Project root) or a Folder that loaded successfully. A Folder that
/// failed to load is never written to, so nothing can be created inside it.
pub(super) fn resolve_parent_directory(
    session: &mut ProjectSession,
    parent_folder_id: Option<&str>,
) -> ApplicationResult<ParentDirectory> {
    let Some(parent_folder_id) = parent_folder_id else {
        session.ensure_directory("", DOCUMENTS_DIRECTORY_NAME)?;
        return Ok(ParentDirectory {
            base: DOCUMENTS_DIRECTORY_NAME.to_owned(),
            relative: String::new(),
        });
    };
    let folder_id = FolderId::parse(parent_folder_id)?;
    let record = session.folder(&folder_id)?;
    if !record.writable {
        return Err(ApplicationError::not_writable(format!(
            "folder {folder_id} did not load and cannot be written"
        )));
    }
    Ok(ParentDirectory {
        base: session.folder_base(&folder_id)?,
        relative: record.relative_path.clone(),
    })
}

pub fn create_folder(
    sessions: &mut ProjectSessions,
    project_id: &str,
    parent_folder_id: Option<&str>,
    folder_id: &str,
    name: &str,
) -> ApplicationResult<FolderSnapshot> {
    let session = sessions.session_mut(project_id)?;
    let folder = Folder::new(&FolderInput {
        schema_version: i64::from(CURRENT_FOLDER_SCHEMA_VERSION),
        folder_id: folder_id.to_owned(),
        name: DisplayName::new(name)?.as_str().to_owned(),
        child_order: Vec::new(),
    })?;
    if session.entry_id_in_use(folder.folder_id().as_uuid()) {
        return Err(DomainError::new(
            DomainErrorKind::DuplicateId,
            format!("folderId already exists: {}", folder.folder_id()),
        )
        .into());
    }
    let parent = resolve_parent_directory(session, parent_folder_id)?;
    let existing = session.entry_names("", &parent.base)?;
    let directory_name = unique_directory_name(name, FOLDER_NAME_BASE, &existing);
    let relative_path = parent.child_relative_path(&directory_name);
    let base = super::session::document_base_path(&relative_path);

    // `create_directory` fails with `alreadyExists` if the name was taken in the meantime,
    // and `create_file` never replaces a file, so nothing existing is overwritten.
    let dto = FolderDto::from_domain(&folder);
    session.create_directory(&parent.base, &directory_name)?;
    session.create_file(&base, FOLDER_FILE_NAME, &to_json_bytes(&dto)?)?;
    session.insert_folder(
        *folder.folder_id(),
        FolderRecord {
            relative_path,
            writable: true,
        },
    );
    Ok(FolderSnapshot {
        folder_id: folder.folder_id().to_string(),
        name: Some(folder.name().as_str().to_owned()),
        parent_folder_id: parent_folder_id.map(str::to_owned),
        child_order: Vec::new(),
        state: EntityState::Loaded,
    })
}

pub fn save_folder(
    sessions: &mut ProjectSessions,
    project_id: &str,
    folder: &FolderDto,
) -> ApplicationResult<SaveResult> {
    let session = sessions.session_mut(project_id)?;
    let folder = folder.to_domain()?;
    let record = session.folder(folder.folder_id())?;
    if !record.writable {
        return Err(ApplicationError::not_writable(format!(
            "folder {} did not load and cannot be written",
            folder.folder_id()
        )));
    }
    let base = session.folder_base(folder.folder_id())?;
    let bytes = to_json_bytes(&FolderDto::from_domain(&folder))?;
    let outcome = session.write_file(&base, FOLDER_FILE_NAME, &bytes)?;
    Ok(SaveResult {
        written: outcome == WriteOutcome::Written,
    })
}

fn invalid_move(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::InvalidMove, detail)
}

/// Whether `path` is `ancestor` itself or lies below it (both relative to `documents/`).
fn is_at_or_below(path: &str, ancestor: &str) -> bool {
    path == ancestor
        || path
            .strip_prefix(ancestor)
            .is_some_and(|rest| rest.starts_with(PATH_SEPARATOR))
}

/// Moves a Folder or Document directory into another Folder (or the Project root with
/// `None`). Only closed entries move: a Document that is open, or a Folder containing one,
/// is `invalidMove`, because the Frontend holds loaded data for it and its `dawn-asset`
/// URLs would otherwise break mid-session. A move into the current parent succeeds without
/// touching anything. Neither parent's order array is changed here.
pub fn move_entry(
    sessions: &mut ProjectSessions,
    project_id: &str,
    entry_id: &str,
    target_parent_folder_id: Option<&str>,
) -> ApplicationResult<()> {
    let session = sessions.session_mut(project_id)?;
    let (source_path, is_folder) = locate_entry(session, entry_id)?;

    let target_path = match target_parent_folder_id {
        None => String::new(),
        Some(target_id) => {
            let target_id = FolderId::parse(target_id)?;
            let record = session.folder(&target_id)?;
            if !record.writable {
                return Err(ApplicationError::not_writable(format!(
                    "folder {target_id} did not load and cannot receive entries"
                )));
            }
            record.relative_path.clone()
        }
    };
    if is_folder && is_at_or_below(&target_path, &source_path) {
        return Err(invalid_move(format!(
            "folder {entry_id} cannot move into itself or its descendant"
        )));
    }
    let (source_parent_base, source_name) = split_entry_path(&source_path);
    let current_parent_path = source_path
        .rsplit_once(PATH_SEPARATOR)
        .map_or("", |(parent, _)| parent);
    if current_parent_path == target_path {
        return Ok(());
    }
    let opened = if is_folder {
        session.has_opened_document_under(&source_path)
    } else {
        let document_id = DocumentId::parse(entry_id)?;
        session.document(&document_id)?.opened
    };
    if opened {
        return Err(invalid_move(format!(
            "{entry_id} is open (or holds an open document) and cannot move"
        )));
    }

    let target_base = super::session::document_base_path(&target_path);
    let new_name = session.move_directory(&source_parent_base, source_name, &target_base)?;
    let new_path = if target_path.is_empty() {
        new_name
    } else {
        format!("{target_path}{PATH_SEPARATOR}{new_name}")
    };
    session.rename_tree(&source_path, &new_path);
    Ok(())
}

/// The entry's path relative to `documents/` and whether it is a Folder (otherwise a Document).
fn locate_entry(session: &ProjectSession, entry_id: &str) -> ApplicationResult<(String, bool)> {
    if let Ok(folder_id) = FolderId::parse(entry_id) {
        if let Ok(record) = session.folder(&folder_id) {
            return Ok((record.relative_path.clone(), true));
        }
    }
    let document_id = DocumentId::parse(entry_id)?;
    Ok((session.document(&document_id)?.relative_path.clone(), false))
}

/// Deletes an empty Folder. Not undoable; `project.json` / the parent's `folder.json` are
/// left alone (the caller saves the parent's order without the Folder first). A Folder that
/// failed to load can be deleted too.
pub fn delete_folder(
    sessions: &mut ProjectSessions,
    project_id: &str,
    folder_id: &str,
) -> ApplicationResult<()> {
    let session = sessions.session_mut(project_id)?;
    let folder_id = FolderId::parse(folder_id)?;
    session.remove_empty_folder(&folder_id)
}
