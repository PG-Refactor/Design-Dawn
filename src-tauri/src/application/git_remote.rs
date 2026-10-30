//! Fetch, pull, push, publish and the remote list.
//!
//! Authentication is left to the user's own git setup (credential manager, ssh agent): git
//! is never given a prompt, a credential helper or an ssh command by this module. Nothing
//! here can force anything: the only arguments are those named in `constants.rs`.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::git_commit::{
    require_no_operation_in_progress, require_no_unmerged, status_after_change, GitCommitStatus,
};
use crate::application::git_operations::{
    not_ready_error, project_root_of, read_file_statuses, read_git_status, repository_state,
    run_error, GitBranchInfo, GitFileChange, GitRepositoryState,
};
use crate::application::session::ProjectSessions;
use crate::infrastructure::git::constants::{
    ARG_FETCH, ARG_NO_EDIT, ARG_NO_REBASE, ARG_PULL, ARG_PUSH, ARG_REMOTE, ARG_SET_UPSTREAM,
    AUTHENTICATION_FAILURE_PATTERNS, ENV_MESSAGE_LOCALE, GIT_COMMAND_TIMEOUT, GIT_NETWORK_TIMEOUT,
    NETWORK_FAILURE_PATTERNS, OPTION_PREFIX, PULL_BLOCKED_PATTERNS, PUSH_REJECTED_PATTERNS,
    REVISION_HEAD,
};
use crate::infrastructure::git::redaction::redact_credentials;
use crate::infrastructure::git::runner::GitRunner;

/// The status read after a remote operation. A failure to read it does not undo the
/// operation, so it is a state of the result (same shape as a commit's).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteResult {
    pub status: GitCommitStatus,
}

pub fn git_fetch(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
) -> ApplicationResult<GitRemoteResult> {
    let project_root = project_root_of(sessions, project_id)?;
    fetch(GitRunner::discover().ok().as_ref(), &project_root)
}

pub fn git_pull(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
) -> ApplicationResult<GitRemoteResult> {
    let project_root = project_root_of(sessions, project_id)?;
    pull(GitRunner::discover().ok().as_ref(), &project_root)
}

pub fn git_push(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
) -> ApplicationResult<GitRemoteResult> {
    let project_root = project_root_of(sessions, project_id)?;
    push(GitRunner::discover().ok().as_ref(), &project_root)
}

pub fn git_publish(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    remote: &str,
) -> ApplicationResult<GitRemoteResult> {
    let project_root = project_root_of(sessions, project_id)?;
    publish(GitRunner::discover().ok().as_ref(), &project_root, remote)
}

pub fn git_remotes(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
) -> ApplicationResult<Vec<String>> {
    let project_root = project_root_of(sessions, project_id)?;
    remotes(GitRunner::discover().ok().as_ref(), &project_root)
}

/// The names `git remote` prints, one per line. A name that is not UTF-8 or holds a control
/// character is dropped; URLs are never read (`git remote -v` is not used).
pub fn remotes(runner: Option<&GitRunner>, project_root: &Path) -> ApplicationResult<Vec<String>> {
    let runner = ready_runner(runner, project_root)?;
    read_remote_names(runner, project_root)
}

/// `git fetch` with no arguments: git fetches what the branch's configuration says.
pub fn fetch(
    runner: Option<&GitRunner>,
    project_root: &Path,
) -> ApplicationResult<GitRemoteResult> {
    let runner = ready_runner(runner, project_root)?;
    if read_remote_names(runner, project_root)?.is_empty() {
        return Err(ApplicationError::new(
            ErrorKind::GitNoRemote,
            "the repository has no remote",
        ));
    }
    run_network(runner, project_root, &[ARG_FETCH], "fetch")?;
    Ok(result_after(runner, project_root, "a fetch"))
}

/// `git pull --no-rebase --no-edit`, no remote or branch given: the branch's upstream.
/// `--ff` is not passed so a `pull.ff=only` of the user is respected. If it fails, the
/// status is read again: unmerged files mean a conflict (`gitPullConflicts`), anything else
/// is classified from stderr.
pub fn pull(runner: Option<&GitRunner>, project_root: &Path) -> ApplicationResult<GitRemoteResult> {
    let runner = ready_runner(runner, project_root)?;
    let status = read_git_status(Some(runner), project_root)?;
    let branch = checked_out_branch(status.branch.as_ref())?;
    require_upstream(branch)?;
    require_no_unmerged(&status.files)?;
    require_no_operation_in_progress(runner, project_root)?;

    if let Err(error) = run_network(
        runner,
        project_root,
        &[ARG_PULL, ARG_NO_REBASE, ARG_NO_EDIT],
        "pull",
    ) {
        // A conflicted merge is also a non-zero exit, but not a failure to classify by text.
        let conflicted = read_file_statuses(runner, project_root).is_ok_and(|files| {
            files
                .iter()
                .any(|file| file.index_status == GitFileChange::Unmerged)
        });
        if conflicted && error.kind != ErrorKind::GitTimeout {
            return Err(ApplicationError::new(
                ErrorKind::GitPullConflicts,
                error.detail,
            ));
        }
        return Err(error);
    }
    Ok(result_after(runner, project_root, "a pull"))
}

/// `git push` with no arguments, for a branch that has an upstream.
pub fn push(runner: Option<&GitRunner>, project_root: &Path) -> ApplicationResult<GitRemoteResult> {
    let runner = ready_runner(runner, project_root)?;
    let status = read_git_status(Some(runner), project_root)?;
    let branch = checked_out_branch(status.branch.as_ref())?;
    require_upstream(branch)?;

    run_network(runner, project_root, &[ARG_PUSH], "push")?;
    Ok(result_after(runner, project_root, "a push"))
}

/// `git push -u <remote> HEAD` for a branch without an upstream. `remote` must be one of
/// the names `git remote` prints right now and must not look like an option, so caller text
/// never reaches git as anything but a remote name.
pub fn publish(
    runner: Option<&GitRunner>,
    project_root: &Path,
    remote: &str,
) -> ApplicationResult<GitRemoteResult> {
    let runner = ready_runner(runner, project_root)?;
    let status = read_git_status(Some(runner), project_root)?;
    let branch = checked_out_branch(status.branch.as_ref())?;
    if branch.upstream.is_some() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            "the branch already has an upstream; push it instead",
        ));
    }
    let known = read_remote_names(runner, project_root)?;
    if remote.starts_with(OPTION_PREFIX) || !known.iter().any(|name| name == remote) {
        return Err(ApplicationError::new(
            ErrorKind::GitRemoteNotFound,
            "the remote is not one of the repository's remotes",
        ));
    }

    run_network(
        runner,
        project_root,
        &[ARG_PUSH, ARG_SET_UPSTREAM, remote, REVISION_HEAD],
        "publish",
    )?;
    Ok(result_after(runner, project_root, "a publish"))
}

/// What git's stderr says about a failed fetch / pull / push. Authentication wins over the
/// network: an ssh authentication failure also prints "Could not read from remote
/// repository". `gitTimeout` is decided by the runner, not here.
pub fn classify_remote_failure(stderr: &str) -> ErrorKind {
    let contains_any = |patterns: &[&str]| patterns.iter().any(|pattern| stderr.contains(pattern));
    if contains_any(&AUTHENTICATION_FAILURE_PATTERNS) {
        ErrorKind::GitAuthenticationFailed
    } else if contains_any(&PUSH_REJECTED_PATTERNS) {
        ErrorKind::GitPushRejected
    } else if contains_any(&PULL_BLOCKED_PATTERNS) {
        ErrorKind::GitPullBlockedByLocalChanges
    } else if contains_any(&NETWORK_FAILURE_PATTERNS) {
        ErrorKind::GitNetworkUnavailable
    } else {
        ErrorKind::GitCommandFailed
    }
}

fn ready_runner<'a>(
    runner: Option<&'a GitRunner>,
    project_root: &Path,
) -> ApplicationResult<&'a GitRunner> {
    let state = repository_state(runner, project_root)?;
    match (state, runner) {
        (GitRepositoryState::Ready, Some(runner)) => Ok(runner),
        _ => Err(not_ready_error(state)),
    }
}

fn checked_out_branch(branch: Option<&GitBranchInfo>) -> ApplicationResult<&GitBranchInfo> {
    match branch {
        Some(branch) if branch.head.is_some() => Ok(branch),
        _ => Err(ApplicationError::new(
            ErrorKind::GitDetachedHead,
            "no branch is checked out",
        )),
    }
}

fn require_upstream(branch: &GitBranchInfo) -> ApplicationResult<()> {
    if branch.upstream.is_none() {
        return Err(ApplicationError::new(
            ErrorKind::GitNoUpstream,
            "the branch has no upstream",
        ));
    }
    Ok(())
}

fn read_remote_names(runner: &GitRunner, project_root: &Path) -> ApplicationResult<Vec<String>> {
    let output = runner
        .run(&[ARG_REMOTE], project_root, None, GIT_COMMAND_TIMEOUT)
        .map_err(|error| run_error("remote", error))?;
    if !output.success() || output.stdout_truncated {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git remote exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let name = std::str::from_utf8(line).ok()?;
            (!name.is_empty() && !name.chars().any(char::is_control)).then(|| name.to_owned())
        })
        .collect())
}

/// Runs a network command with the untranslated message locale (so stderr can be
/// classified) and the long network time limit. stdin stays null and prompts stay off.
/// A non-zero exit becomes the classified error; stderr (credentials removed) only goes
/// into the internal detail and the log.
fn run_network(
    runner: &GitRunner,
    project_root: &Path,
    arguments: &[&str],
    operation: &str,
) -> ApplicationResult<()> {
    let runner = runner
        .clone()
        .with_environment(ENV_MESSAGE_LOCALE.0, ENV_MESSAGE_LOCALE.1);
    let output = runner
        .run(arguments, project_root, None, GIT_NETWORK_TIMEOUT)
        .map_err(|error| run_error(operation, error))?;
    if output.success() {
        return Ok(());
    }
    let stderr = redact_credentials(output.stderr_text().trim_end());
    eprintln!(
        "git {operation} failed (exit {:?}): {stderr}",
        output.exit_code()
    );
    Err(ApplicationError::new(
        classify_remote_failure(&stderr),
        format!(
            "git {operation} exited with {:?}: {stderr}",
            output.exit_code()
        ),
    ))
}

fn result_after(runner: &GitRunner, project_root: &Path, what: &str) -> GitRemoteResult {
    GitRemoteResult {
        status: status_after_change(runner, project_root, what),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(stderr: &str) -> ErrorKind {
        classify_remote_failure(stderr)
    }

    #[test]
    fn authentication_failures_are_recognised() {
        for stderr in [
            "remote: Invalid username or password.\nfatal: Authentication failed for 'https://example.com/a/b.git/'",
            "fatal: could not read Username for 'https://example.com': terminal prompts disabled",
            "fatal: could not read Password for 'https://user@example.com': No such device or address",
            "git@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.",
            "remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://example.com/a.git/'",
            "fatal: unable to access 'https://example.com/a.git/': The requested URL returned error: 403",
        ] {
            assert_eq!(classify(stderr), ErrorKind::GitAuthenticationFailed, "{stderr}");
        }
    }

    #[test]
    fn network_failures_are_recognised() {
        for stderr in [
            "fatal: unable to access 'https://example.com/a.git/': Could not resolve host: example.com",
            "ssh: connect to host example.com port 22: Connection timed out\nfatal: Could not read from remote repository.",
            "ssh: connect to host example.com port 22: Connection refused\nfatal: Could not read from remote repository.",
            "fatal: unable to access 'https://example.com/a.git/': Failed to connect to example.com port 443: Network is unreachable",
            "fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.",
        ] {
            assert_eq!(classify(stderr), ErrorKind::GitNetworkUnavailable, "{stderr}");
        }
    }

    #[test]
    fn rejected_pushes_are_recognised() {
        for stderr in [
            "To /tmp/remote.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to '/tmp/remote.git'",
            " ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs\nhint: Updates were rejected because the tip of your current branch is behind",
        ] {
            assert_eq!(classify(stderr), ErrorKind::GitPushRejected, "{stderr}");
        }
    }

    #[test]
    fn pulls_blocked_by_local_changes_are_recognised() {
        for stderr in [
            "error: Your local changes to the following files would be overwritten by merge:\n\ta.md\nPlease commit your changes or stash them before you merge.\nAborting",
            "error: The following untracked working tree files would be overwritten by merge:\n\tb.md\nPlease move or remove them before you merge.",
        ] {
            assert_eq!(classify(stderr), ErrorKind::GitPullBlockedByLocalChanges, "{stderr}");
        }
    }

    #[test]
    fn everything_else_is_a_plain_command_failure() {
        for stderr in [
            "",
            "fatal: refusing to merge unrelated histories",
            "! [remote rejected] main -> main (pre-receive hook declined)",
            "fatal: Not possible to fast-forward, aborting.",
        ] {
            assert_eq!(classify(stderr), ErrorKind::GitCommandFailed, "{stderr}");
        }
    }
}
