//! "Update all now": writes every metadata file that was read in an older `schemaVersion` in
//! the current version. Loading never does this; an entity is
//! otherwise updated by its next save.

use serde::Serialize;

use super::error::{ApplicationError, ApplicationResult};
use super::fresh_scan::FreshScan;
use super::load_issue::{LoadIssue, LoadIssueKind};
use super::session::{ProjectSession, ProjectSessions};
use crate::domain::constants::PATH_SEPARATOR;
use crate::infrastructure::file_format::dto::{
    parse_dto, to_json_bytes, DocumentDto, FolderDto, ProjectDto, SheetDto,
};
use crate::infrastructure::file_format::migration::{migrate_to_current, MigrationTarget};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatUpdateResult {
    /// Project-root-relative paths of the files written in the current version.
    pub updated: Vec<String>,
}

fn outdated_paths(issues: &[LoadIssue]) -> impl Iterator<Item = String> + '_ {
    issues
        .iter()
        .filter(|issue| issue.kind == LoadIssueKind::OutdatedFormat)
        .filter_map(|issue| issue.path.clone())
}

/// Every file the loader reports as outdated: the Project and Folders, every Document, and
/// the Sheets of every Document that loads.
fn collect_outdated(scan: &mut FreshScan) -> Vec<String> {
    let mut paths: Vec<String> = outdated_paths(&scan.project.issues).collect();
    for document_id in scan.document_ids() {
        if let Ok(document) = scan.load_document(&document_id) {
            paths.extend(outdated_paths(&document.issues));
        }
    }
    paths
}

/// The file's bytes in the current version, from what is on disk now. Only the version is
/// changed: the order lists are copied as they are, so a damaged list is not "repaired" here.
fn current_bytes(session: &mut ProjectSession, path: &str) -> ApplicationResult<Vec<u8>> {
    let file_name = path.rsplit(PATH_SEPARATOR).next().unwrap_or(path);
    let target = MigrationTarget::for_file_name(file_name).ok_or_else(|| {
        ApplicationError::entity_not_found(format!("{path:?} is not a metadata file"))
    })?;
    let value = session.read_json("", path)?;
    let migrated = migrate_to_current(target, value)?;
    let bytes = match target {
        MigrationTarget::Project => to_json_bytes(&parse_dto::<ProjectDto>(migrated.value)?),
        MigrationTarget::Folder => to_json_bytes(&parse_dto::<FolderDto>(migrated.value)?),
        MigrationTarget::Document => to_json_bytes(&parse_dto::<DocumentDto>(migrated.value)?),
        MigrationTarget::Sheet => to_json_bytes(&parse_dto::<SheetDto>(migrated.value)?),
        MigrationTarget::EntryPoint => {
            return Err(ApplicationError::entity_not_found(
                "an entry point is not updated by this operation",
            ))
        }
    };
    Ok(bytes?)
}

/// Which files would be updated, without writing anything.
pub fn list_outdated_files(
    sessions: &mut ProjectSessions,
    project_id: &str,
) -> ApplicationResult<Vec<String>> {
    let session = sessions.session_mut(project_id)?;
    let mut scan = FreshScan::open(session.root(), session.project_id())?;
    Ok(collect_outdated(&mut scan))
}

/// Writes each outdated file through the open session, so a file that changed outside the app
/// since the session read it stops the whole operation (`externallyModified`) with nothing
/// overwritten. Files written before that point stay written; each write is atomic.
pub fn update_outdated_files(
    sessions: &mut ProjectSessions,
    project_id: &str,
) -> ApplicationResult<FormatUpdateResult> {
    let session = sessions.session_mut(project_id)?;
    let mut scan = FreshScan::open(session.root(), session.project_id())?;
    let paths = collect_outdated(&mut scan);
    let mut updated = Vec::with_capacity(paths.len());
    for path in paths {
        let bytes = match current_bytes(scan.session(), &path) {
            Ok(bytes) => bytes,
            // A file that cannot be brought up to date (damaged, or changed since the scan)
            // is left as it is; the loader keeps reporting it.
            Err(_) => continue,
        };
        session.write_file("", &path, &bytes)?;
        updated.push(path);
    }
    Ok(FormatUpdateResult { updated })
}
