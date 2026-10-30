//! Minimum git version. The version is probed once per
//! executable path and remembered for the process: an upgrade needs an app restart, which
//! is cheaper than running `git --version` before every status refresh.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, PoisonError};

use super::constants::{
    ARG_VERSION, GIT_COMMAND_TIMEOUT, GIT_VERSION_OUTPUT_PREFIX, MINIMUM_GIT_VERSION,
};
use super::runner::{GitRunError, GitRunner};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
}

impl GitVersion {
    pub fn is_supported(self) -> bool {
        (self.major, self.minor) >= MINIMUM_GIT_VERSION
    }
}

/// Parses `git version 2.43.0`, `git version 2.45.2.windows.1` and
/// `git version 2.39.3 (Apple Git-146)`. Only major and minor matter; anything that does
/// not start with two numbers is unparsable.
pub fn parse_git_version(output: &str) -> Option<GitVersion> {
    let version = output
        .trim()
        .strip_prefix(GIT_VERSION_OUTPUT_PREFIX)?
        .split_whitespace()
        .next()?;
    let mut parts = version.split('.');
    let major = leading_number(parts.next()?)?;
    let minor = leading_number(parts.next()?)?;
    Some(GitVersion { major, minor })
}

/// `0-rc1` -> 0. A component without leading digits is not a version.
fn leading_number(part: &str) -> Option<u32> {
    let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// `None` when the answer was not a parsable version (including a failing `--version`).
/// Only a runner failure (time limit, spawn) is an `Err`, and it is not cached.
pub fn git_version(runner: &GitRunner) -> Result<Option<GitVersion>, GitRunError> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<GitVersion>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Mutex::default);
    if let Some(known) = cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(runner.executable())
    {
        return Ok(*known);
    }
    // The lock is not held while git runs; two concurrent first calls both probe, which is
    // harmless.
    let output = runner.run(
        &[ARG_VERSION],
        &std::env::temp_dir(),
        None,
        GIT_COMMAND_TIMEOUT,
    )?;
    let version = output
        .success()
        .then(|| parse_git_version(&String::from_utf8_lossy(&output.stdout)))
        .flatten();
    cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(runner.executable().to_path_buf(), version);
    Ok(version)
}

/// True when the executable reports a version of at least [`MINIMUM_GIT_VERSION`].
pub fn is_supported_git(runner: &GitRunner) -> Result<bool, GitRunError> {
    Ok(git_version(runner)?.is_some_and(GitVersion::is_supported))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(major: u32, minor: u32) -> Option<GitVersion> {
        Some(GitVersion { major, minor })
    }

    #[test]
    fn parses_the_usual_forms() {
        assert_eq!(parse_git_version("git version 2.43.0\n"), version(2, 43));
        assert_eq!(
            parse_git_version("git version 2.45.2.windows.1\r\n"),
            version(2, 45)
        );
        assert_eq!(
            parse_git_version("git version 2.39.3 (Apple Git-146)"),
            version(2, 39)
        );
        assert_eq!(parse_git_version("git version 2.46.0-rc1"), version(2, 46));
        assert_eq!(parse_git_version("git version 2.25"), version(2, 25));
    }

    #[test]
    fn rejects_garbage() {
        for text in [
            "",
            "git",
            "git version",
            "git version abc",
            "git version 2",
            "git version .2.3",
            "version 2.43.0",
            "hello world",
        ] {
            assert_eq!(parse_git_version(text), None, "{text:?}");
        }
    }

    #[test]
    fn the_minimum_is_2_25() {
        let supported = |major, minor| GitVersion { major, minor }.is_supported();
        assert!(supported(2, 25));
        assert!(supported(2, 43));
        assert!(supported(3, 0));
        assert!(!supported(2, 24));
        assert!(!supported(1, 99));
    }
}
