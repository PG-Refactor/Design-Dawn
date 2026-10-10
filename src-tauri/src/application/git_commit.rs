//! Commit of the staged changes (docs/git-development.md §11.11). Only the index is
//! committed: nothing is added, no path or `-a` is given, and the message travels on stdin.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize, Serializer};

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::git_operations::{
    head_is_pushed, is_unstageable, not_ready_error, project_root_of, read_file_statuses,
    read_git_status, repository_state, run_error, GitFileChange, GitFileStatus, GitRepositoryState,
    GitStatusResult,
};
use crate::application::session::ProjectSessions;
use crate::infrastructure::git::constants::{
    ARG_ADD, ARG_ADD_ALL, ARG_AMEND, ARG_CLEANUP_WHITESPACE, ARG_COMMIT, ARG_CONFIG, ARG_GIT_PATH,
    ARG_LOG, ARG_MAX_COUNT, ARG_MESSAGE_FILE, ARG_NO_EDIT, ARG_NO_SHOW_SIGNATURE, ARG_QUIET,
    ARG_RESET, ARG_REV_PARSE, ARG_SOFT, ARG_STDIN_FILE, ARG_VAR, ARG_VERIFY,
    COMMIT_MESSAGE_LIMIT_BYTES, CONFIG_COMMIT_ENCODING_UTF8, FORMAT_PARENTS, FORMAT_RAW_BODY,
    GIT_COMMAND_TIMEOUT, GIT_COMMIT_TIMEOUT, GIT_FATAL_EXIT_CODE, IN_PROGRESS_GIT_PATHS,
    OBJECT_ID_LENGTHS, REVISION_HEAD, SINGLE_COMMIT_COUNT, VAR_AUTHOR_IDENT, VAR_COMMITTER_IDENT,
};
use crate::infrastructure::git::redaction::redact_credentials;
use crate::infrastructure::git::runner::GitRunner;

/// Whether the status read after a successful commit could be obtained. A failure here
/// does not undo the commit, so it is a state of the result, not an error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitCommitStatus {
    Updated {
        status: GitStatusResult,
    },
    Unavailable {
        #[serde(serialize_with = "serialize_error_kind")]
        error_kind: ErrorKind,
    },
}

fn serialize_error_kind<S: Serializer>(kind: &ErrorKind, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(kind.as_str())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    /// Object ID of the new HEAD (40 or 64 lowercase hexadecimal characters). `null` only
    /// when the commit succeeded but HEAD could not be read afterwards: a successful commit
    /// is never reported as a failure.
    pub commit_id: Option<String>,
    pub status: GitCommitStatus,
}

/// What the UI asks of a commit besides its message (docs/git-development.md §11.16).
/// Both default to `false`: a plain commit of the index.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCommitOptions {
    /// Rewrite the last commit instead of making a new one.
    pub amend: bool,
    /// Stage every change (`git add -A`) before committing.
    pub stage_all: bool,
}

/// Outcome of Undo Last Commit: the message of the commit that was taken back (`null`
/// when it is not valid UTF-8) and the status read afterwards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUndoCommitResult {
    pub message: Option<String>,
    pub status: GitCommitStatus,
}

/// Commits the staged changes of the Project's Repository with the `git` found on PATH.
pub fn git_commit(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    message: &str,
    options: GitCommitOptions,
) -> ApplicationResult<GitCommitResult> {
    let project_root = project_root_of(sessions, project_id)?;
    commit_with_options(
        GitRunner::discover().ok().as_ref(),
        &project_root,
        message,
        options,
    )
}

/// Takes the last commit back with the `git` found on PATH.
pub fn git_undo_last_commit(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
) -> ApplicationResult<GitUndoCommitResult> {
    let project_root = project_root_of(sessions, project_id)?;
    undo_last_commit(GitRunner::discover().ok().as_ref(), &project_root)
}

/// Why a message is refused; the detail never contains the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitMessageError {
    Empty,
    ControlCharacter,
    TooLong,
}

/// Line endings become LF; refuses a message that is blank, holds NUL or control characters
/// other than tab and newline, or is larger than `COMMIT_MESSAGE_LIMIT_BYTES` (checked
/// after normalization, which can only shrink it). Whitespace trimming is left to git's
/// `--cleanup=whitespace`, so the stored text is exactly what git makes of it.
pub fn normalize_commit_message(message: &str) -> Result<String, CommitMessageError> {
    let normalized = message.replace("\r\n", "\n").replace('\r', "\n");
    if normalized.trim().is_empty() {
        return Err(CommitMessageError::Empty);
    }
    if normalized
        .chars()
        .any(|character| character.is_control() && character != '\t' && character != '\n')
    {
        return Err(CommitMessageError::ControlCharacter);
    }
    if normalized.len() > COMMIT_MESSAGE_LIMIT_BYTES {
        return Err(CommitMessageError::TooLong);
    }
    Ok(normalized)
}

/// `git commit` of what is staged with no options (docs/git-development.md §11.11).
pub fn commit_staged(
    runner: Option<&GitRunner>,
    project_root: &Path,
    message: &str,
) -> ApplicationResult<GitCommitResult> {
    commit_with_options(runner, project_root, message, GitCommitOptions::default())
}

/// `git commit` (docs/git-development.md §11.11, §11.16). Checks run in a fixed order and
/// nothing is executed after the first failing one: repository ready, message, (amend:
/// HEAD exists, not pushed), conflicts, (stage all: unfinished operation, `git add -A`),
/// staged changes, unfinished operation, identity. Never saves anything.
///
/// A failure of the commit itself (`gitCommitRejected` / `gitTimeout` /
/// `gitCommandFailed`) may have been caused after hooks changed the index or working
/// tree, so the caller reads the status again. If the commit succeeded but HEAD cannot be
/// read afterwards, the result is still `Ok` with `commit_id: None`.
pub fn commit_with_options(
    runner: Option<&GitRunner>,
    project_root: &Path,
    message: &str,
    options: GitCommitOptions,
) -> ApplicationResult<GitCommitResult> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(not_ready_error(state));
    };

    // An amend without a message keeps the old one (`--no-edit`); for a new commit a
    // blank message is an error.
    let message = if options.amend && message.trim().is_empty() {
        None
    } else {
        Some(normalize_commit_message(message).map_err(|reason| {
            ApplicationError::new(
                ErrorKind::InvalidCommitMessage,
                format!("the commit message was rejected: {reason:?}"),
            )
        })?)
    };

    if options.amend {
        if read_head_object_id_if_any(runner, project_root)?.is_none() {
            return Err(ApplicationError::new(
                ErrorKind::GitNoCommitToAmend,
                "the repository has no commit",
            ));
        }
        require_head_not_pushed(runner, project_root)?;
    }

    let mut files = read_file_statuses(runner, project_root)?;
    require_no_unmerged(&files)?;
    if options.stage_all {
        // Checked before adding: `git add -A` during a merge would mark conflicted files
        // as resolved.
        require_no_operation_in_progress(runner, project_root)?;
        let output = runner
            .run(
                &[ARG_ADD, ARG_ADD_ALL],
                project_root,
                None,
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
        files = read_file_statuses(runner, project_root)?;
        require_no_unmerged(&files)?;
    }
    // A message-only amend has nothing staged.
    if !options.amend && !files.iter().any(|file| is_unstageable(file.index_status)) {
        return Err(ApplicationError::new(
            ErrorKind::NothingToCommit,
            "nothing is staged",
        ));
    }

    require_no_operation_in_progress(runner, project_root)?;
    for variable in [VAR_AUTHOR_IDENT, VAR_COMMITTER_IDENT] {
        require_identity(runner, project_root, variable)?;
    }

    // No `-a` / `--only` / `--include` / `--allow-empty` / `--no-verify` / paths: exactly
    // the index, with the user's hooks and signing settings.
    let mut arguments = vec![ARG_CONFIG, CONFIG_COMMIT_ENCODING_UTF8, ARG_COMMIT];
    if options.amend {
        arguments.push(ARG_AMEND);
    }
    match message {
        Some(_) => arguments.extend([ARG_MESSAGE_FILE, ARG_STDIN_FILE, ARG_CLEANUP_WHITESPACE]),
        None => arguments.push(ARG_NO_EDIT),
    }
    let output = runner
        .run(
            &arguments,
            project_root,
            message.as_deref().map(str::as_bytes),
            GIT_COMMIT_TIMEOUT,
        )
        .map_err(|error| run_error("commit", error))?;
    if !output.success() {
        // The message is never logged; hook output is, with credentials removed.
        eprintln!(
            "git commit was rejected (exit {:?}): {}",
            output.exit_code(),
            redact_credentials(output.stderr_text().trim_end())
        );
        return Err(ApplicationError::new(
            ErrorKind::GitCommitRejected,
            format!("git commit exited with {:?}", output.exit_code()),
        ));
    }

    let commit_id = match read_head_object_id(runner, project_root) {
        Ok(commit_id) => Some(commit_id),
        Err(error) => {
            eprintln!("git commit succeeded but {error}");
            None
        }
    };
    Ok(GitCommitResult {
        commit_id,
        status: status_after_change(runner, project_root, "a commit"),
    })
}

/// Undo Last Commit: `git reset --soft <parent>` (docs/git-development.md §11.16). The
/// index and the working tree are not touched, so everything the commit contained is
/// staged again. The target is the parent's object ID read here, never text from the
/// caller. The message is returned to the caller and never logged.
pub fn undo_last_commit(
    runner: Option<&GitRunner>,
    project_root: &Path,
) -> ApplicationResult<GitUndoCommitResult> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(not_ready_error(state));
    };

    let cannot_undo = |detail: &str| ApplicationError::new(ErrorKind::GitCannotUndoCommit, detail);
    if read_head_object_id_if_any(runner, project_root)?.is_none() {
        return Err(cannot_undo("the repository has no commit"));
    }
    let parents = read_head_log(runner, project_root, FORMAT_PARENTS)?;
    let parents = String::from_utf8_lossy(&parents);
    let mut parent_ids = parents.split_whitespace();
    let parent_id = match (parent_ids.next(), parent_ids.next()) {
        (Some(parent_id), None) if is_object_id(parent_id) => parent_id.to_owned(),
        _ => {
            return Err(cannot_undo(
                "HEAD is a root commit, a merge commit or has an unreadable parent",
            ))
        }
    };
    require_head_not_pushed(runner, project_root)?;
    require_no_operation_in_progress(runner, project_root)?;

    let mut body = read_head_log(runner, project_root, FORMAT_RAW_BODY)?;
    // `--format` terminates the record with one newline that is not part of the message.
    if body.last() == Some(&b'\n') {
        body.pop();
    }
    let message = String::from_utf8(body).ok();

    let output = runner
        .run(
            &[ARG_RESET, ARG_SOFT, &parent_id],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("reset", error))?;
    if !output.success() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git reset exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    Ok(GitUndoCommitResult {
        message,
        status: status_after_change(runner, project_root, "an undo"),
    })
}

/// A failure to read the status after a change that succeeded does not undo the change,
/// so it is a state of the result, not an error.
pub(crate) fn status_after_change(
    runner: &GitRunner,
    project_root: &Path,
    what: &str,
) -> GitCommitStatus {
    match read_git_status(Some(runner), project_root) {
        Ok(status) => GitCommitStatus::Updated { status },
        Err(error) => {
            eprintln!("git status after {what} failed: {error}");
            GitCommitStatus::Unavailable {
                error_kind: error.kind,
            }
        }
    }
}

pub(crate) fn require_no_unmerged(files: &[GitFileStatus]) -> ApplicationResult<()> {
    if files
        .iter()
        .any(|file| file.index_status == GitFileChange::Unmerged)
    {
        return Err(ApplicationError::new(
            ErrorKind::GitUnmergedChanges,
            "the repository has unmerged files",
        ));
    }
    Ok(())
}

pub(crate) fn require_no_operation_in_progress(
    runner: &GitRunner,
    project_root: &Path,
) -> ApplicationResult<()> {
    if operation_in_progress(runner, project_root)? {
        return Err(ApplicationError::new(
            ErrorKind::GitOperationInProgress,
            "a merge, cherry-pick, revert or rebase is unfinished",
        ));
    }
    Ok(())
}

/// A commit contained in a remote-tracking branch is refused; so is one whose containment
/// cannot be determined, because rewriting a pushed commit needs a force push.
fn require_head_not_pushed(runner: &GitRunner, project_root: &Path) -> ApplicationResult<()> {
    match head_is_pushed(runner, project_root) {
        Ok(false) => Ok(()),
        Ok(true) => Err(ApplicationError::new(
            ErrorKind::GitCommitAlreadyPushed,
            "HEAD is contained in a remote-tracking branch",
        )),
        Err(error) => {
            eprintln!("git head containment lookup failed: {error}");
            Err(ApplicationError::new(
                ErrorKind::GitCommitAlreadyPushed,
                "whether HEAD was pushed could not be determined",
            ))
        }
    }
}

/// Raw output of `git log -1 <format> HEAD`.
fn read_head_log(
    runner: &GitRunner,
    project_root: &Path,
    format: &str,
) -> ApplicationResult<Vec<u8>> {
    let output = runner
        .run(
            &[
                ARG_LOG,
                ARG_NO_SHOW_SIGNATURE,
                ARG_MAX_COUNT,
                SINGLE_COMMIT_COUNT,
                format,
                REVISION_HEAD,
            ],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("log", error))?;
    if !output.success() || output.stdout_truncated {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!("git log exited with {:?}", output.exit_code()),
        ));
    }
    Ok(output.stdout)
}

/// `None` when the repository has no commit yet (`--quiet` makes that a silent exit 1).
fn read_head_object_id_if_any(
    runner: &GitRunner,
    project_root: &Path,
) -> ApplicationResult<Option<String>> {
    let output = runner
        .run(
            &[ARG_REV_PARSE, ARG_VERIFY, ARG_QUIET, REVISION_HEAD],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("HEAD lookup", error))?;
    if output.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        let object_id = text.trim_end_matches(['\n', '\r']);
        if is_object_id(object_id) {
            return Ok(Some(object_id.to_owned()));
        }
    } else if output.exit_code() == Some(1) {
        return Ok(None);
    }
    Err(ApplicationError::new(
        ErrorKind::GitCommandFailed,
        format!("git rev-parse HEAD exited with {:?}", output.exit_code()),
    ))
}

/// True when git's own locations for `MERGE_HEAD` and friends exist. Asking git keeps this
/// correct for worktrees and a relocated git directory.
fn operation_in_progress(runner: &GitRunner, project_root: &Path) -> ApplicationResult<bool> {
    let mut arguments: Vec<&str> = vec![ARG_REV_PARSE];
    for name in IN_PROGRESS_GIT_PATHS {
        arguments.push(ARG_GIT_PATH);
        arguments.push(name);
    }
    let output = runner
        .run(&arguments, project_root, None, GIT_COMMAND_TIMEOUT)
        .map_err(|error| run_error("git path lookup", error))?;
    if !output.success() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git rev-parse --git-path exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    let text = String::from_utf8(output.stdout).map_err(|_| {
        ApplicationError::new(
            ErrorKind::GitCommandFailed,
            "git rev-parse --git-path printed a path that is not UTF-8",
        )
    })?;
    let paths: Vec<&str> = text.lines().collect();
    if paths.len() != IN_PROGRESS_GIT_PATHS.len() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            "git rev-parse --git-path printed an unexpected number of paths",
        ));
    }
    // Paths are relative to the working directory (the repository root) unless absolute.
    Ok(paths.iter().any(|path| {
        let path = PathBuf::from(path);
        project_root.join(path).exists()
    }))
}

fn require_identity(
    runner: &GitRunner,
    project_root: &Path,
    variable: &str,
) -> ApplicationResult<()> {
    let output = runner
        .run(
            &[ARG_VAR, variable],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("identity lookup", error))?;
    match output.exit_code() {
        Some(0) => Ok(()),
        Some(GIT_FATAL_EXIT_CODE) => Err(ApplicationError::new(
            ErrorKind::GitIdentityMissing,
            format!("{variable} is not configured"),
        )),
        code => Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!("git var {variable} exited with {code:?}"),
        )),
    }
}

fn read_head_object_id(runner: &GitRunner, project_root: &Path) -> ApplicationResult<String> {
    let failed = |detail: String| {
        ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!("the commit was made but HEAD could not be read: {detail}"),
        )
    };
    let output = runner
        .run(
            &[ARG_REV_PARSE, ARG_VERIFY, REVISION_HEAD],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| failed(error.to_string()))?;
    if !output.success() {
        return Err(failed(format!("exit {:?}", output.exit_code())));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let object_id = text.trim_end_matches(['\n', '\r']);
    if !is_object_id(object_id) {
        return Err(failed("the output is not an object ID".to_owned()));
    }
    Ok(object_id.to_owned())
}

fn is_object_id(text: &str) -> bool {
    OBJECT_ID_LENGTHS.contains(&text.len())
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_endings_become_lf() {
        assert_eq!(
            normalize_commit_message("a\r\nb\rc\nd").unwrap(),
            "a\nb\nc\nd"
        );
    }

    #[test]
    fn tabs_newlines_and_non_ascii_text_are_accepted() {
        assert_eq!(
            normalize_commit_message("見出し\n\n\t本文 # not a comment").unwrap(),
            "見出し\n\n\t本文 # not a comment"
        );
    }

    #[test]
    fn blank_messages_are_refused() {
        for message in ["", "  \n ", "\t\r\n", "\u{3000}"] {
            assert_eq!(
                normalize_commit_message(message),
                Err(CommitMessageError::Empty),
                "{message:?}"
            );
        }
    }

    #[test]
    fn control_characters_other_than_tab_and_newline_are_refused() {
        for message in ["a\0b", "a\u{1b}[31mb", "a\u{7f}", "a\u{85}", "a\u{8}"] {
            assert_eq!(
                normalize_commit_message(message),
                Err(CommitMessageError::ControlCharacter),
                "{message:?}"
            );
        }
    }

    #[test]
    fn the_limit_applies_to_utf8_bytes_after_normalization() {
        let at_limit = "a".repeat(COMMIT_MESSAGE_LIMIT_BYTES);
        assert!(normalize_commit_message(&at_limit).is_ok());
        assert_eq!(
            normalize_commit_message(&format!("{at_limit}a")),
            Err(CommitMessageError::TooLong)
        );
        // 3 bytes per character: the character count is under the limit, the bytes are not.
        let multibyte = "あ".repeat(COMMIT_MESSAGE_LIMIT_BYTES / 3 + 1);
        assert_eq!(
            normalize_commit_message(&multibyte),
            Err(CommitMessageError::TooLong)
        );
        // CRLF shrinks to LF before the check.
        let crlf = "\r\n".repeat(COMMIT_MESSAGE_LIMIT_BYTES / 2);
        assert_eq!(
            normalize_commit_message(&format!("{crlf}x")),
            Ok(format!("{}x", "\n".repeat(COMMIT_MESSAGE_LIMIT_BYTES / 2)))
        );
    }

    #[test]
    fn object_ids_are_40_or_64_lowercase_hex_characters() {
        assert!(is_object_id(&"a0".repeat(20)));
        assert!(is_object_id(&"0f".repeat(32)));
        assert!(!is_object_id(&"A0".repeat(20)));
        assert!(!is_object_id(&"a0".repeat(19)));
        assert!(!is_object_id(&format!("{}g", "a".repeat(39))));
        assert!(!is_object_id(""));
    }

    #[test]
    fn the_wire_form_has_an_outcome_tag_and_camel_case_fields() {
        let updated = GitCommitResult {
            commit_id: Some("a".repeat(40)),
            status: GitCommitStatus::Unavailable {
                error_kind: ErrorKind::GitTimeout,
            },
        };
        assert_eq!(
            serde_json::to_value(updated).unwrap(),
            serde_json::json!({
                "commitId": "a".repeat(40),
                "status": { "outcome": "unavailable", "errorKind": "gitTimeout" }
            })
        );
    }
}
