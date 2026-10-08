//! Git features of a Project (docs/git-development.md §11): turns the Git CLI's answers into
//! Design Dawn's own types. The Frontend never sees a path of the machine, a raw status
//! string or git's stderr.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::session::ProjectSessions;
use crate::infrastructure::git::constants::{
    ARG_NO_OPTIONAL_LOCKS, ARG_NUL_SEPARATED, ARG_STATUS, ARG_STATUS_PORCELAIN_V2,
    ARG_UNTRACKED_ALL, GIT_COMMAND_TIMEOUT,
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
    let Some(runner) = runner else {
        return Ok(GitStatusResult::without_files(
            GitRepositoryState::GitUnavailable,
        ));
    };
    // A git older than the minimum (or one that does not answer `--version`) lacks options
    // the Stage / Commit operations rely on, so it counts as not installed.
    match is_supported_git(runner) {
        Ok(true) => {}
        Ok(false) | Err(GitRunError::Unavailable) => {
            return Ok(GitStatusResult::without_files(
                GitRepositoryState::GitUnavailable,
            ))
        }
        Err(error) => return Err(run_error("git version check", error)),
    }
    let state = match detect_repository(runner, project_root) {
        Ok(state) => state,
        Err(GitRunError::Unavailable) => {
            return Ok(GitStatusResult::without_files(
                GitRepositoryState::GitUnavailable,
            ))
        }
        Err(error) => return Err(run_error("repository detection", error)),
    };
    match state {
        RepositoryState::Ready => {}
        RepositoryState::NotRepository => {
            return Ok(GitStatusResult::without_files(
                GitRepositoryState::NotRepository,
            ))
        }
        RepositoryState::UnsupportedRepositoryLayout => {
            return Ok(GitStatusResult::without_files(
                GitRepositoryState::UnsupportedRepositoryLayout,
            ))
        }
        RepositoryState::Error => {
            return Ok(GitStatusResult::without_files(GitRepositoryState::Error))
        }
    }

    let files = read_file_statuses(runner, project_root)?;
    Ok(GitStatusResult {
        repository: GitRepositoryInfo {
            state: GitRepositoryState::Ready,
        },
        files,
    })
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
