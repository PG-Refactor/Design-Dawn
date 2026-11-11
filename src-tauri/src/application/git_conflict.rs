//! Resolving a merge conflict in the app: the three versions Git keeps for a conflicted
//! file (common ancestor, ours, theirs), a structural merge for `sheet.json`, and writing
//! the chosen text and staging it. The merge commit is made with the ordinary Commit.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::export_markdown::write_file_atomically;
use super::git_operations::{
    not_ready_error, project_root_of, read_file_statuses, repository_state, stage_paths,
    validate_requested_paths, GitFileChange, GitRepositoryState, GitStatusResult,
};
use super::session::ProjectSessions;
use super::sheet_merge::merge_sheet;
use crate::infrastructure::file_format::constants::SHEET_FILE_NAME;
use crate::infrastructure::git::constants::GIT_COMMAND_TIMEOUT;
use crate::infrastructure::git::runner::GitRunner;

const ARG_SHOW: &str = "show";
/// Index stages of a conflicted file: 1 the common ancestor, 2 ours, 3 theirs.
const STAGE_BASE: u8 = 1;
const STAGE_OURS: u8 = 2;
const STAGE_THEIRS: u8 = 3;
/// A version larger than this is not shown; the file is resolved outside the app.
const VERSION_MAX_BYTES: usize = 2 * 1024 * 1024;
const PATH_SEPARATOR: char = '/';

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub path: String,
    /// Absent when the side has no such file (added on one side, deleted on the other) or it
    /// is not text the app can show.
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// The working tree file, with Git's conflict markers.
    pub current: Option<String>,
    /// For `sheet.json`: the Block-by-Block merge, when it succeeds.
    pub merged: Option<String>,
    /// For `sheet.json`: the Block ids (and fields) that both sides changed differently.
    pub conflicting_blocks: Vec<String>,
}

fn show_stage(runner: &GitRunner, root: &Path, stage: u8, path: &str) -> Option<String> {
    let object = format!(":{stage}:{path}");
    let output = runner
        .run_with_stdout_limit(
            &[ARG_SHOW, object.as_str()],
            root,
            None,
            GIT_COMMAND_TIMEOUT,
            VERSION_MAX_BYTES,
        )
        .ok()?;
    if !output.success() || output.stdout_truncated {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

/// The path must be one the repository's own status lists as conflicted.
fn require_conflicted(runner: &GitRunner, root: &Path, path: &str) -> ApplicationResult<String> {
    let validated = validate_requested_paths(&[path.to_owned()], "resolve")?;
    let valid = validated
        .first()
        .ok_or_else(|| ApplicationError::new(ErrorKind::InvalidGitPath, "no path"))?;
    let conflicted = read_file_statuses(runner, root)?.iter().any(|file| {
        file.path == valid.as_str()
            && (file.worktree_status == GitFileChange::Unmerged
                || file.index_status == GitFileChange::Unmerged)
    });
    if conflicted {
        Ok(valid.as_str().to_owned())
    } else {
        Err(ApplicationError::new(
            ErrorKind::InvalidGitPath,
            "the path is not a conflicted file of the repository",
        ))
    }
}

fn ready_runner(runner: Option<&GitRunner>, root: &Path) -> ApplicationResult<GitRunner> {
    let state = repository_state(runner, root)?;
    match (state, runner) {
        (GitRepositoryState::Ready, Some(runner)) => Ok(runner.clone()),
        _ => Err(not_ready_error(state)),
    }
}

pub fn read_conflict_versions(
    runner: Option<&GitRunner>,
    root: &Path,
    path: &str,
) -> ApplicationResult<ConflictVersions> {
    let runner = ready_runner(runner, root)?;
    let path = require_conflicted(&runner, root, path)?;
    let base = show_stage(&runner, root, STAGE_BASE, &path);
    let ours = show_stage(&runner, root, STAGE_OURS, &path);
    let theirs = show_stage(&runner, root, STAGE_THEIRS, &path);
    let current = std::fs::read_to_string(root.join(&path)).ok();
    let is_sheet = path.rsplit(PATH_SEPARATOR).next() == Some(SHEET_FILE_NAME);
    let (merged, conflicting_blocks) = match (is_sheet, &ours, &theirs) {
        (true, Some(ours_text), Some(theirs_text)) => {
            match merge_sheet(base.as_deref(), ours_text, theirs_text) {
                Ok(Ok(text)) => (Some(text), Vec::new()),
                Ok(Err(conflicts)) => (None, [conflicts.fields, conflicts.blocks].concat()),
                Err(_) => (None, Vec::new()),
            }
        }
        _ => (None, Vec::new()),
    };
    Ok(ConflictVersions {
        path,
        base,
        ours,
        theirs,
        current,
        merged,
        conflicting_blocks,
    })
}

/// Writes `content` over the conflicted file (through a temporary file) and stages it.
pub fn resolve_conflict(
    runner: Option<&GitRunner>,
    root: &Path,
    path: &str,
    content: &str,
) -> ApplicationResult<GitStatusResult> {
    let ready = ready_runner(runner, root)?;
    let path = require_conflicted(&ready, root, path)?;
    write_file_atomically(&root.join(&path), content.as_bytes())?;
    stage_paths(Some(&ready), root, &[path])
}

pub fn git_conflict_versions(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    path: &str,
) -> ApplicationResult<ConflictVersions> {
    let root = project_root_of(sessions, project_id)?;
    read_conflict_versions(GitRunner::discover().ok().as_ref(), &root, path)
}

pub fn git_resolve_conflict(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    path: &str,
    content: &str,
) -> ApplicationResult<GitStatusResult> {
    let root = project_root_of(sessions, project_id)?;
    resolve_conflict(GitRunner::discover().ok().as_ref(), &root, path, content)
}
