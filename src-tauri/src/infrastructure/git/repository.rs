//! Repository detection (docs/git-development.md §11.3): the Git features exist only when
//! the Repository root is the Project root. The root comes from `git rev-parse
//! --show-toplevel`, not from the presence of `.git`, and both sides are compared as real
//! paths (canonicalize resolves case and the `\\?\` form on Windows).

use std::path::Path;

use super::constants::{
    ARG_NO_OPTIONAL_LOCKS, ARG_REV_PARSE, ARG_SHOW_TOPLEVEL, ENV_MESSAGE_LOCALE,
    GIT_COMMAND_TIMEOUT, GIT_FATAL_EXIT_CODE, NOT_A_REPOSITORY_MESSAGE,
};
use super::redaction::redact_credentials;
use super::runner::{GitRunError, GitRunner};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepositoryState {
    Ready,
    NotRepository,
    /// The Project is inside a larger Repository (or the Repository's work tree is not
    /// the Project directory).
    UnsupportedRepositoryLayout,
    /// Dubious ownership (`safe.directory`), a broken Repository, an unreadable answer.
    Error,
}

/// `Err` only for failures of the runner itself (git missing, time limit, spawn); every
/// answer git gave is a [`RepositoryState`].
pub fn detect_repository(
    runner: &GitRunner,
    project_root: &Path,
) -> Result<RepositoryState, GitRunError> {
    // The message locale is forced for this call only: "not a git repository" is told
    // apart from other fatal errors by git's own (untranslated) text, and stdout is not
    // locale dependent.
    let runner = runner
        .clone()
        .with_environment(ENV_MESSAGE_LOCALE.0, ENV_MESSAGE_LOCALE.1);
    let output = runner.run(
        &[ARG_NO_OPTIONAL_LOCKS, ARG_REV_PARSE, ARG_SHOW_TOPLEVEL],
        project_root,
        None,
        GIT_COMMAND_TIMEOUT,
    )?;

    if output.success() {
        return Ok(compare_roots(&output.stdout, project_root));
    }
    let stderr = output.stderr_text();
    if output.exit_code() == Some(GIT_FATAL_EXIT_CODE) && stderr.contains(NOT_A_REPOSITORY_MESSAGE)
    {
        return Ok(RepositoryState::NotRepository);
    }
    eprintln!(
        "git rev-parse failed ({:?}): {}",
        output.exit_code(),
        redact_credentials(stderr.trim_end())
    );
    Ok(RepositoryState::Error)
}

fn compare_roots(stdout: &[u8], project_root: &Path) -> RepositoryState {
    let Ok(text) = std::str::from_utf8(stdout) else {
        eprintln!("git rev-parse printed a path that is not UTF-8");
        return RepositoryState::Error;
    };
    // One line; git prints `/` separators even on Windows, which `Path` accepts there.
    let toplevel = text.trim_end_matches(['\n', '\r']);
    if toplevel.is_empty() {
        return RepositoryState::Error;
    }
    match (
        std::fs::canonicalize(toplevel),
        std::fs::canonicalize(project_root),
    ) {
        (Ok(repository_root), Ok(project_root)) if repository_root == project_root => {
            RepositoryState::Ready
        }
        (Ok(_), Ok(_)) => RepositoryState::UnsupportedRepositoryLayout,
        (Err(error), _) | (_, Err(error)) => {
            eprintln!("could not resolve the repository root or the Project root: {error}");
            RepositoryState::Error
        }
    }
}
