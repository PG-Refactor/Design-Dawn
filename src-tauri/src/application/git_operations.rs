//! Git features of a Project (docs/git-development.md §11): turns the Git CLI's answers into
//! Design Dawn's own types. The Frontend never sees a path of the machine, a raw status
//! string or git's stderr.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::session::ProjectSessions;
use crate::infrastructure::git::constants::{
    ARG_ADD, ARG_NO_OPTIONAL_LOCKS, ARG_NUL_SEPARATED, ARG_PATHSPEC_FILE_NUL,
    ARG_PATHSPEC_FROM_STDIN, ARG_STATUS, ARG_STATUS_PORCELAIN_V2, ARG_UNTRACKED_ALL,
    GIT_COMMAND_TIMEOUT,
};
use crate::infrastructure::git::paths::{
    pathspec_stdin, validate_project_relative_path, ValidatedGitPath,
};
use crate::infrastructure::git::redaction::redact_credentials;
use crate::infrastructure::git::repository::{detect_repository, RepositoryState};
use crate::infrastructure::git::runner::{GitRunError, GitRunner};
use crate::infrastructure::git::status_parser::{parse_status, FileChange, StatusEntry};
use crate::infrastructure::git::version::is_supported_git;

/// State of the Project's Repository. Anything but `ready` is a normal answer, not an
/// error: the app is fully usable without Git.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositoryState {
    Ready,
    NotRepository,
    UnsupportedRepositoryLayout,
    GitUnavailable,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitFileChange {
    Unmodified,
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Ignored,
    Unmerged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    /// Project root relative, `/` separated.
    pub path: String,
    pub index_status: GitFileChange,
    pub worktree_status: GitFileChange,
    /// Always present on the wire (`null` unless renamed / copied) so the Frontend decodes
    /// one fixed shape.
    pub original_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitRepositoryInfo {
    pub state: GitRepositoryState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitStatusResult {
    pub repository: GitRepositoryInfo,
    /// Empty unless the repository is `ready`.
    pub files: Vec<GitFileStatus>,
}

impl GitStatusResult {
    fn without_files(state: GitRepositoryState) -> Self {
        Self {
            repository: GitRepositoryInfo { state },
            files: Vec::new(),
        }
    }
}

/// The root is copied out so the sessions lock is not held while git runs.
pub fn project_root_of(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
) -> ApplicationResult<PathBuf> {
    let mut guard = sessions.lock().unwrap_or_else(PoisonError::into_inner);
    Ok(guard.session_mut(project_id)?.root().to_path_buf())
}

/// Status of the Project's Repository using the `git` found on PATH.
pub fn git_status(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
) -> ApplicationResult<GitStatusResult> {
    let project_root = project_root_of(sessions, project_id)?;
    read_git_status(GitRunner::discover().ok().as_ref(), &project_root)
}

/// `runner` is `None` when git was not found.
pub fn read_git_status(
    runner: Option<&GitRunner>,
    project_root: &Path,
) -> ApplicationResult<GitStatusResult> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Ok(GitStatusResult::without_files(state));
    };
    let files = read_file_statuses(runner, project_root)?;
    Ok(GitStatusResult {
        repository: GitRepositoryInfo {
            state: GitRepositoryState::Ready,
        },
        files,
    })
}

/// Version check and repository detection shared by every Git operation. Only `Ready`
/// means the operation may go on (and then `runner` is `Some`).
fn repository_state(
    runner: Option<&GitRunner>,
    project_root: &Path,
) -> ApplicationResult<GitRepositoryState> {
    let Some(runner) = runner else {
        return Ok(GitRepositoryState::GitUnavailable);
    };
    // A git older than the minimum (or one that does not answer `--version`) lacks options
    // the Stage / Commit operations rely on, so it counts as not installed.
    match is_supported_git(runner) {
        Ok(true) => {}
        Ok(false) | Err(GitRunError::Unavailable) => return Ok(GitRepositoryState::GitUnavailable),
        Err(error) => return Err(run_error("git version check", error)),
    }
    let state = match detect_repository(runner, project_root) {
        Ok(state) => state,
        Err(GitRunError::Unavailable) => return Ok(GitRepositoryState::GitUnavailable),
        Err(error) => return Err(run_error("repository detection", error)),
    };
    Ok(match state {
        RepositoryState::Ready => GitRepositoryState::Ready,
        RepositoryState::NotRepository => GitRepositoryState::NotRepository,
        RepositoryState::UnsupportedRepositoryLayout => {
            GitRepositoryState::UnsupportedRepositoryLayout
        }
        RepositoryState::Error => GitRepositoryState::Error,
    })
}

/// Stages the given Project-relative paths with the `git` found on PATH.
pub fn git_stage(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    paths: &[String],
) -> ApplicationResult<GitStatusResult> {
    let project_root = project_root_of(sessions, project_id)?;
    stage_paths(GitRunner::discover().ok().as_ref(), &project_root, paths)
}

/// `git add` for changed files that the repository's own status lists (docs/git-development.md
/// §11.6, §11.7). Nothing is run unless every path is valid and listed as changed in the
/// working tree, so a directory, an unknown name or an unchanged file cannot widen the
/// operation. Returns the status read after the operation. Never saves anything.
pub fn stage_paths(
    runner: Option<&GitRunner>,
    project_root: &Path,
    paths: &[String],
) -> ApplicationResult<GitStatusResult> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(ApplicationError::new(
            ErrorKind::GitNotReady,
            format!("the repository is not ready for git operations ({state:?})"),
        ));
    };

    let mut validated: Vec<ValidatedGitPath> = Vec::new();
    for path in paths {
        let valid = validate_project_relative_path(path).map_err(|reason| {
            ApplicationError::new(
                ErrorKind::InvalidGitPath,
                format!("a path to stage was rejected: {reason:?}"),
            )
        })?;
        if !validated.contains(&valid) {
            validated.push(valid);
        }
    }
    // An empty request is a no-op, not an error: the caller just gets the current status.
    let Ok(stdin) = pathspec_stdin(&validated) else {
        return read_git_status(Some(runner), project_root);
    };

    let current = read_file_statuses(runner, project_root)?;
    for path in &validated {
        let stageable = current
            .iter()
            .any(|file| file.path == path.as_str() && is_stageable(file.worktree_status));
        if !stageable {
            return Err(ApplicationError::new(
                ErrorKind::InvalidGitPath,
                "a path to stage is not a changed file of the repository",
            ));
        }
    }

    // On failure git may already have changed the index for some paths; the caller is
    // expected to read the status again.
    let output = runner
        .run(
            &[ARG_ADD, ARG_PATHSPEC_FROM_STDIN, ARG_PATHSPEC_FILE_NUL],
            project_root,
            Some(&stdin),
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("add", error))?;
    if !output.success() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git add exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    read_git_status(Some(runner), project_root)
}

/// Working tree changes `git add` can take: not directories, ignored or unchanged files.
fn is_stageable(change: GitFileChange) -> bool {
    matches!(
        change,
        GitFileChange::Modified
            | GitFileChange::Deleted
            | GitFileChange::TypeChanged
            | GitFileChange::Untracked
            | GitFileChange::Unmerged
    )
}

fn read_file_statuses(
    runner: &GitRunner,
    project_root: &Path,
) -> ApplicationResult<Vec<GitFileStatus>> {
    // `--untracked-files=all` lists files, not just their directories, because Stage works
    // per file. Ignored files are not requested.
    let output = runner
        .run(
            &[
                ARG_NO_OPTIONAL_LOCKS,
                ARG_STATUS,
                ARG_STATUS_PORCELAIN_V2,
                ARG_NUL_SEPARATED,
                ARG_UNTRACKED_ALL,
            ],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("status", error))?;
    if !output.success() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git status exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    if output.stdout_truncated {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            "git status output exceeded the capture limit",
        ));
    }
    let parsed = parse_status(&output.stdout).map_err(|error| {
        ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!("git status output could not be parsed: {}", error.detail),
        )
    })?;
    if parsed.skipped_records > 0 {
        eprintln!(
            "git status: {} entries with unusable paths were left out",
            parsed.skipped_records
        );
    }
    Ok(parsed.entries.into_iter().map(file_status).collect())
}

fn run_error(operation: &str, error: GitRunError) -> ApplicationError {
    let kind = match error {
        GitRunError::Timeout => ErrorKind::GitTimeout,
        GitRunError::Unavailable | GitRunError::Spawn(_) => ErrorKind::GitCommandFailed,
    };
    ApplicationError::new(kind, format!("git {operation}: {error}"))
}

fn file_status(entry: StatusEntry) -> GitFileStatus {
    GitFileStatus {
        path: entry.path,
        index_status: file_change(entry.index),
        worktree_status: file_change(entry.worktree),
        original_path: entry.original_path,
    }
}

fn file_change(change: FileChange) -> GitFileChange {
    match change {
        FileChange::Unmodified => GitFileChange::Unmodified,
        FileChange::Modified => GitFileChange::Modified,
        FileChange::Added => GitFileChange::Added,
        FileChange::Deleted => GitFileChange::Deleted,
        FileChange::Renamed => GitFileChange::Renamed,
        FileChange::Copied => GitFileChange::Copied,
        FileChange::TypeChanged => GitFileChange::TypeChanged,
        FileChange::Untracked => GitFileChange::Untracked,
        FileChange::Ignored => GitFileChange::Ignored,
        FileChange::Unmerged => GitFileChange::Unmerged,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_runner_is_the_git_unavailable_state_not_an_error() {
        let result = read_git_status(None, Path::new("/")).unwrap();

        assert_eq!(
            result,
            GitStatusResult::without_files(GitRepositoryState::GitUnavailable)
        );
    }

    #[test]
    fn the_wire_form_is_camel_case_with_a_null_original_path() {
        let result = GitStatusResult {
            repository: GitRepositoryInfo {
                state: GitRepositoryState::UnsupportedRepositoryLayout,
            },
            files: vec![GitFileStatus {
                path: "a.md".to_owned(),
                index_status: GitFileChange::TypeChanged,
                worktree_status: GitFileChange::Unmodified,
                original_path: None,
            }],
        };

        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "repository": { "state": "unsupportedRepositoryLayout" },
                "files": [{
                    "path": "a.md",
                    "indexStatus": "typeChanged",
                    "worktreeStatus": "unmodified",
                    "originalPath": null
                }]
            })
        );
    }

    #[test]
    fn run_errors_map_to_error_kinds() {
        assert_eq!(
            run_error("x", GitRunError::Timeout).kind,
            ErrorKind::GitTimeout
        );
        assert_eq!(
            run_error("x", GitRunError::Spawn(std::io::Error::other("boom"))).kind,
            ErrorKind::GitCommandFailed
        );
    }
}
