//! Git features of a Project (docs/git-development.md §11): turns the Git CLI's answers into
//! Design Dawn's own types. The Frontend never sees a path of the machine, a raw status
//! string or git's stderr.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::git_discard::untracked_file_location;
use crate::application::session::ProjectSessions;
use crate::infrastructure::git::constants::{
    ARG_ADD, ARG_CACHED, ARG_CONTAINS, ARG_COUNT_ONE, ARG_DIFF, ARG_END_OF_OPTIONS,
    ARG_FIND_RENAMES, ARG_FOR_EACH_REF, ARG_NO_COLOR, ARG_NO_EXT_DIFF, ARG_NO_INDEX,
    ARG_NO_OPTIONAL_LOCKS, ARG_NO_TEXTCONV, ARG_NUL_SEPARATED, ARG_NUMSTAT, ARG_PATHSPEC_FILE_NUL,
    ARG_PATHSPEC_FROM_STDIN, ARG_QUIET, ARG_RESTORE, ARG_REV_PARSE, ARG_RM, ARG_STAGED, ARG_STATUS,
    ARG_STATUS_BRANCH, ARG_STATUS_PORCELAIN_V2, ARG_UNTRACKED_ALL, ARG_VERIFY,
    DIFF_COMMAND_TIMEOUT, DIFF_OUTPUT_LIMIT_BYTES, FORMAT_REF_NAME, GIT_COMMAND_TIMEOUT,
    GIT_STDOUT_LIMIT_BYTES, NO_INDEX_DIFFERENCES_EXIT_CODE, NO_INDEX_EMPTY_SIDE,
    NO_INDEX_NO_DIFFERENCE_EXIT_CODE, REMOTE_TRACKING_REFS, REVISION_HEAD,
};
use crate::infrastructure::git::numstat_parser::contains_binary_file;
use crate::infrastructure::git::paths::{
    pathspec_stdin, validate_project_relative_path, ValidatedGitPath,
};
use crate::infrastructure::git::redaction::redact_credentials;
use crate::infrastructure::git::repository::{detect_repository, RepositoryState};
use crate::infrastructure::git::runner::{GitOutput, GitRunError, GitRunner};
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
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    /// Branch name; `null` on a detached HEAD. Untrusted text, shown as text only.
    pub head: Option<String>,
    /// Commit id of HEAD; `null` on an unborn branch.
    pub oid: Option<String>,
    /// Upstream such as `origin/main`; `null` when none is configured. Untrusted text.
    pub upstream: Option<String>,
    /// Commits only on this branch / only on the upstream; `null` without an upstream or
    /// when git printed no counts (e.g. the upstream branch is gone).
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
    /// Whether HEAD is contained in a remote-tracking branch. Display only: Amend / Undo
    /// read it again before running.
    pub head_pushed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitStatusResult {
    pub repository: GitRepositoryInfo,
    /// Only for a `ready` repository; always present on the wire.
    pub branch: Option<GitBranchInfo>,
    /// Empty unless the repository is `ready`.
    pub files: Vec<GitFileStatus>,
}

impl GitStatusResult {
    fn without_files(state: GitRepositoryState) -> Self {
        Self {
            repository: GitRepositoryInfo { state },
            branch: None,
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
    let (files, mut branch) = read_status_snapshot(runner, project_root)?;
    if branch.oid.is_some() {
        // A failed lookup only hides the "already pushed" hint; the commands that depend on
        // it ask again and treat a failure as pushed.
        branch.head_pushed = head_is_pushed(runner, project_root).unwrap_or_else(|error| {
            eprintln!("git head containment lookup failed: {error}");
            false
        });
    }
    Ok(GitStatusResult {
        repository: GitRepositoryInfo {
            state: GitRepositoryState::Ready,
        },
        branch: Some(branch),
        files,
    })
}

/// Version check and repository detection shared by every Git operation. Only `Ready`
/// means the operation may go on (and then `runner` is `Some`).
pub(crate) fn repository_state(
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
        return Err(not_ready_error(state));
    };

    let validated = validate_requested_paths(paths, "stage")?;
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

pub(crate) fn validate_requested_paths(
    paths: &[String],
    operation: &str,
) -> ApplicationResult<Vec<ValidatedGitPath>> {
    let mut validated: Vec<ValidatedGitPath> = Vec::new();
    for path in paths {
        let valid = validate_project_relative_path(path).map_err(|reason| {
            ApplicationError::new(
                ErrorKind::InvalidGitPath,
                format!("a path to {operation} was rejected: {reason:?}"),
            )
        })?;
        if !validated.contains(&valid) {
            validated.push(valid);
        }
    }
    Ok(validated)
}

pub(crate) fn not_ready_error(state: GitRepositoryState) -> ApplicationError {
    ApplicationError::new(
        ErrorKind::GitNotReady,
        format!("the repository is not ready for git operations ({state:?})"),
    )
}

/// Unstages the given Project-relative paths with the `git` found on PATH.
pub fn git_unstage(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    paths: &[String],
) -> ApplicationResult<GitStatusResult> {
    let project_root = project_root_of(sessions, project_id)?;
    unstage_paths(GitRunner::discover().ok().as_ref(), &project_root, paths)
}

/// Takes staged entries back out of the index (docs/git-development.md §11.6): `git restore
/// --staged`, or `git rm --cached` while the repository has no commit. Only paths whose
/// index side the repository's own status lists as changed (and not unmerged) are accepted,
/// so nothing outside the request is touched. A staged rename is unstaged as a whole: its
/// original path joins the pathspec, otherwise the old name's deletion would stay staged.
/// Working tree files are never changed. Returns the status read afterwards.
pub fn unstage_paths(
    runner: Option<&GitRunner>,
    project_root: &Path,
    paths: &[String],
) -> ApplicationResult<GitStatusResult> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(not_ready_error(state));
    };

    let requested = validate_requested_paths(paths, "unstage")?;
    if requested.is_empty() {
        return read_git_status(Some(runner), project_root);
    }

    let current = read_file_statuses(runner, project_root)?;
    let mut targets: Vec<ValidatedGitPath> = Vec::new();
    for path in &requested {
        let entry = current
            .iter()
            .find(|file| file.path == path.as_str() && is_unstageable(file.index_status));
        let Some(entry) = entry else {
            return Err(ApplicationError::new(
                ErrorKind::InvalidGitPath,
                "a path to unstage has no staged change in the repository",
            ));
        };
        let mut affected = vec![path.clone()];
        if entry.index_status == GitFileChange::Renamed {
            // The path comes from git; it is checked like any other before it reaches stdin.
            let original = entry
                .original_path
                .as_deref()
                .and_then(|original| validate_project_relative_path(original).ok());
            let Some(original) = original else {
                return Err(ApplicationError::new(
                    ErrorKind::GitCommandFailed,
                    "a staged rename has no usable original path",
                ));
            };
            affected.push(original);
        }
        for affected_path in affected {
            if !targets.contains(&affected_path) {
                targets.push(affected_path);
            }
        }
    }
    let Ok(stdin) = pathspec_stdin(&targets) else {
        return read_git_status(Some(runner), project_root);
    };

    let arguments: Vec<&str> = if repository_has_head(runner, project_root)? {
        vec![
            ARG_RESTORE,
            ARG_STAGED,
            ARG_PATHSPEC_FROM_STDIN,
            ARG_PATHSPEC_FILE_NUL,
        ]
    } else {
        // Without a commit there is nothing to restore from; only the index entry goes.
        vec![
            ARG_RM,
            ARG_CACHED,
            ARG_QUIET,
            ARG_PATHSPEC_FROM_STDIN,
            ARG_PATHSPEC_FILE_NUL,
        ]
    };
    // On failure git may already have changed the index for some paths; the caller is
    // expected to read the status again.
    let output = runner
        .run(&arguments, project_root, Some(&stdin), GIT_COMMAND_TIMEOUT)
        .map_err(|error| run_error("unstage", error))?;
    if !output.success() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git {} exited with {:?}: {}",
                arguments[0],
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    read_git_status(Some(runner), project_root)
}

/// Which comparison a Diff shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffSide {
    /// Working tree against the index.
    Unstaged,
    /// Index against HEAD.
    Staged,
}

/// What a Diff request produced. Every variant is a result, not a failure
/// (docs/git-development.md §11.10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitDiffOutcome {
    Text {
        diff: String,
    },
    /// The status lists a change but git's diff is empty (a timestamp-only change).
    Empty,
    Binary,
    TooLarge {
        limit_bytes: usize,
    },
    NotUtf8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub path: String,
    pub side: DiffSide,
    #[serde(flatten)]
    pub outcome: GitDiffOutcome,
}

/// Diff of one file using the `git` found on PATH.
pub fn git_diff(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    path: &str,
    side: DiffSide,
) -> ApplicationResult<GitDiff> {
    let project_root = project_root_of(sessions, project_id)?;
    diff_path(
        GitRunner::discover().ok().as_ref(),
        &project_root,
        path,
        side,
    )
}

/// Diff of one changed file (docs/git-development.md §11.10). Only a path the repository's
/// own status lists with a change on the requested side is accepted, like Stage / Unstage.
/// Read-only: no index lock (`--no-optional-locks`), no external diff or textconv program,
/// nothing is written or saved.
pub fn diff_path(
    runner: Option<&GitRunner>,
    project_root: &Path,
    path: &str,
    side: DiffSide,
) -> ApplicationResult<GitDiff> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(not_ready_error(state));
    };

    let validated = validate_project_relative_path(path).map_err(|reason| {
        ApplicationError::new(
            ErrorKind::InvalidGitPath,
            format!("a path to diff was rejected: {reason:?}"),
        )
    })?;
    let current = read_file_statuses(runner, project_root)?;
    let entry = current.iter().find(|file| {
        file.path == validated.as_str()
            && match side {
                DiffSide::Unstaged => is_diffable_in_worktree(file.worktree_status),
                DiffSide::Staged => is_unstageable(file.index_status),
            }
    });
    let Some(entry) = entry else {
        return Err(ApplicationError::new(
            ErrorKind::InvalidGitPath,
            "a path to diff has no change on the requested side",
        ));
    };
    let result = |outcome| GitDiff {
        path: validated.as_str().to_owned(),
        side,
        outcome,
    };

    // An untracked file is compared against an empty side, so its content shows as
    // additions. Nothing outside the project may be read through a link on the way.
    let untracked = side == DiffSide::Unstaged && entry.worktree_status == GitFileChange::Untracked;
    if untracked {
        untracked_file_location(project_root, &validated).map_err(|error| {
            if error.kind == ErrorKind::GitDiscardRejected {
                ApplicationError::new(ErrorKind::InvalidGitPath, error.detail)
            } else {
                error
            }
        })?;
    }
    let target = if untracked {
        DiffTarget::UntrackedFile
    } else {
        DiffTarget::Side(side)
    };

    // A staged rename is shown as an old / new pair only when both names are in the
    // pathspec; with the new name alone it would look like a plain addition.
    let mut pathspecs = vec![validated.as_str().to_owned()];
    if side == DiffSide::Staged && entry.index_status == GitFileChange::Renamed {
        let original = entry
            .original_path
            .as_deref()
            .and_then(|original| validate_project_relative_path(original).ok());
        let Some(original) = original else {
            return Err(ApplicationError::new(
                ErrorKind::GitCommandFailed,
                "a staged rename has no usable original path",
            ));
        };
        pathspecs.push(original.into_string());
    }

    let numstat = run_diff(
        runner,
        project_root,
        target,
        &[ARG_NUMSTAT, ARG_NUL_SEPARATED],
        &pathspecs,
        GIT_STDOUT_LIMIT_BYTES,
    )?;
    if numstat.stdout_truncated {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            "git diff --numstat output exceeded the capture limit",
        ));
    }
    let binary = contains_binary_file(&numstat.stdout).map_err(|error| {
        ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git diff --numstat output could not be parsed: {}",
                error.detail
            ),
        )
    })?;
    if binary {
        return Ok(result(GitDiffOutcome::Binary));
    }

    // One byte more than the limit tells "exactly at the limit" from "over it".
    let text = run_diff(
        runner,
        project_root,
        target,
        &[ARG_NO_COLOR],
        &pathspecs,
        DIFF_OUTPUT_LIMIT_BYTES + 1,
    )?;
    if text.stdout.len() > DIFF_OUTPUT_LIMIT_BYTES {
        return Ok(result(GitDiffOutcome::TooLarge {
            limit_bytes: DIFF_OUTPUT_LIMIT_BYTES,
        }));
    }
    if text.stdout.is_empty() {
        return Ok(result(GitDiffOutcome::Empty));
    }
    Ok(result(match String::from_utf8(text.stdout) {
        Ok(diff) => GitDiffOutcome::Text { diff },
        Err(_) => GitDiffOutcome::NotUtf8,
    }))
}

/// What one `git diff` call compares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiffTarget {
    Side(DiffSide),
    /// An untracked file against an empty side (`--no-index`).
    UntrackedFile,
}

/// One `git diff` with the options every Diff call shares. `extra` holds the options that
/// differ (numstat or colour); `pathspecs` follow `--` so none can be read as an option.
fn run_diff(
    runner: &GitRunner,
    project_root: &Path,
    target: DiffTarget,
    extra: &[&str],
    pathspecs: &[String],
    stdout_limit: usize,
) -> ApplicationResult<GitOutput> {
    let mut arguments: Vec<&str> = vec![ARG_NO_OPTIONAL_LOCKS, ARG_DIFF];
    match target {
        DiffTarget::Side(DiffSide::Staged) => arguments.push(ARG_CACHED),
        DiffTarget::Side(DiffSide::Unstaged) => {}
        DiffTarget::UntrackedFile => arguments.push(ARG_NO_INDEX),
    }
    arguments.extend_from_slice(extra);
    arguments.extend_from_slice(&[ARG_NO_EXT_DIFF, ARG_NO_TEXTCONV, ARG_FIND_RENAMES]);
    arguments.push(ARG_END_OF_OPTIONS);
    if target == DiffTarget::UntrackedFile {
        arguments.push(NO_INDEX_EMPTY_SIDE);
    }
    arguments.extend(pathspecs.iter().map(String::as_str));

    let output = runner
        .run_with_stdout_limit(
            &arguments,
            project_root,
            None,
            DIFF_COMMAND_TIMEOUT,
            stdout_limit,
        )
        .map_err(|error| run_error("diff", error))?;
    // `--no-index` follows `diff(1)`: 1 means "differences found", which is the normal
    // result for a non-empty new file. Every other code (and a signal) is a failure.
    let succeeded = match target {
        DiffTarget::UntrackedFile => matches!(
            output.exit_code(),
            Some(NO_INDEX_NO_DIFFERENCE_EXIT_CODE | NO_INDEX_DIFFERENCES_EXIT_CODE)
        ),
        DiffTarget::Side(_) => output.success(),
    };
    if !succeeded {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git diff exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    Ok(output)
}

/// Working tree changes that have something to show: a diff against the index, or the
/// untracked marker. Unmerged files are excluded (combined diffs are not part of Phase 6).
fn is_diffable_in_worktree(change: GitFileChange) -> bool {
    matches!(
        change,
        GitFileChange::Modified
            | GitFileChange::Deleted
            | GitFileChange::TypeChanged
            | GitFileChange::Untracked
    )
}

/// False in a repository without any commit. Any other failure of the probe is an error:
/// guessing wrong would pick the wrong command.
fn repository_has_head(runner: &GitRunner, project_root: &Path) -> ApplicationResult<bool> {
    let output = runner
        .run(
            &[ARG_REV_PARSE, ARG_VERIFY, ARG_QUIET, REVISION_HEAD],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("HEAD lookup", error))?;
    match output.exit_code() {
        Some(0) => Ok(true),
        // `--verify --quiet` exits 1 without a message when the revision does not exist.
        Some(1) => Ok(false),
        code => Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git rev-parse exited with {code:?}: {}",
                redact_credentials(output.stderr_text().trim_end())
            ),
        )),
    }
}

/// Index side changes that can be taken back out. Unmerged entries are excluded: resolving
/// a conflict is not part of Phase 6.
pub(crate) fn is_unstageable(change: GitFileChange) -> bool {
    matches!(
        change,
        GitFileChange::Modified
            | GitFileChange::Added
            | GitFileChange::Deleted
            | GitFileChange::Renamed
            | GitFileChange::Copied
            | GitFileChange::TypeChanged
    )
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

pub(crate) fn read_file_statuses(
    runner: &GitRunner,
    project_root: &Path,
) -> ApplicationResult<Vec<GitFileStatus>> {
    Ok(read_status_snapshot(runner, project_root)?.0)
}

fn read_status_snapshot(
    runner: &GitRunner,
    project_root: &Path,
) -> ApplicationResult<(Vec<GitFileStatus>, GitBranchInfo)> {
    // `--untracked-files=all` lists files, not just their directories, because Stage works
    // per file. Ignored files are not requested.
    let output = runner
        .run(
            &[
                ARG_NO_OPTIONAL_LOCKS,
                ARG_STATUS,
                ARG_STATUS_PORCELAIN_V2,
                ARG_STATUS_BRANCH,
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
    let branch = GitBranchInfo {
        head: parsed.branch.head,
        oid: parsed.branch.oid,
        upstream: parsed.branch.upstream,
        ahead: parsed.branch.ahead,
        behind: parsed.branch.behind,
        head_pushed: false,
    };
    Ok((
        parsed.entries.into_iter().map(file_status).collect(),
        branch,
    ))
}

/// Whether HEAD is reachable from any remote-tracking branch (docs/git-development.md
/// §11.16). Read-only, one process. The caller must know that HEAD exists.
pub(crate) fn head_is_pushed(runner: &GitRunner, project_root: &Path) -> ApplicationResult<bool> {
    let output = runner
        .run(
            &[
                ARG_NO_OPTIONAL_LOCKS,
                ARG_FOR_EACH_REF,
                ARG_CONTAINS,
                REVISION_HEAD,
                ARG_COUNT_ONE,
                FORMAT_REF_NAME,
                REMOTE_TRACKING_REFS,
            ],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("for-each-ref", error))?;
    if !output.success() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git for-each-ref exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    Ok(output.stdout.iter().any(|byte| !byte.is_ascii_whitespace()))
}

pub(crate) fn run_error(operation: &str, error: GitRunError) -> ApplicationError {
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
            branch: None,
        };

        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "repository": { "state": "unsupportedRepositoryLayout" },
                "branch": null,
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
