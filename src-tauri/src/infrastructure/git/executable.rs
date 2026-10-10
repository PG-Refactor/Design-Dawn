//! Finds the `git` executable (docs/git-development.md §11.6): only through the PATH
//! entries, as an absolute path. The working directory and the Project directory are never
//! searched, so a `git` file inside a Project that someone else created cannot be run.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use super::constants::{
    GIT_EXECUTABLE_NAME, GIT_WINDOWS_EXECUTABLE_NAME, PATH_ENVIRONMENT_VARIABLE,
};

/// Which executable naming rule applies. Injectable so the Windows rule is tested on Linux.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Unix,
    Windows,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else {
            Self::Unix
        }
    }

    fn executable_name(self) -> &'static str {
        match self {
            Self::Unix => GIT_EXECUTABLE_NAME,
            Self::Windows => GIT_WINDOWS_EXECUTABLE_NAME,
        }
    }
}

/// `git` found through the process's own PATH. Not cached: scanning a few directories is
/// cheap, and an installation made while the app runs is found by the next Refresh.
pub fn find_git_executable() -> Option<PathBuf> {
    find_git_executable_in(
        std::env::var_os(PATH_ENVIRONMENT_VARIABLE).as_deref(),
        Platform::current(),
    )
}

/// The first absolute PATH entry that holds a runnable `git`. Empty entries mean "the
/// current directory" to a shell and relative entries resolve against it, so both are
/// skipped.
pub fn find_git_executable_in(path_value: Option<&OsStr>, platform: Platform) -> Option<PathBuf> {
    let path_value = path_value?;
    std::env::split_paths(path_value)
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(platform.executable_name()))
        .find(|candidate| is_runnable_file(candidate))
}

/// A regular file (symlinks are followed: distributions link `git`) that may be executed.
fn is_runnable_file(candidate: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(candidate) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    has_execute_permission(&metadata)
}

#[cfg(unix)]
fn has_execute_permission(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    const ANY_EXECUTE_BIT: u32 = 0o111;
    metadata.permissions().mode() & ANY_EXECUTE_BIT != 0
}

/// Windows decides by the extension, which the naming rule already fixed.
#[cfg(not(unix))]
fn has_execute_permission(_metadata: &std::fs::Metadata) -> bool {
    true
}

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "design-dawn-git-exe-{name}-{}",
                uuid::Uuid::now_v7()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn directory(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(&path).unwrap();
            path
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_file(path: &Path, mode: u32) {
        fs::write(path, b"#!/bin/sh\n").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    fn join(entries: &[&Path]) -> std::ffi::OsString {
        std::env::join_paths(entries).unwrap()
    }

    #[test]
    fn finds_git_in_the_first_absolute_entry_that_has_it() {
        let scratch = Scratch::new("first");
        let empty = scratch.directory("empty");
        let first = scratch.directory("first");
        let second = scratch.directory("second");
        write_file(&first.join("git"), 0o755);
        write_file(&second.join("git"), 0o755);

        let found = find_git_executable_in(Some(&join(&[&empty, &first, &second])), Platform::Unix);

        assert_eq!(found, Some(first.join("git")));
    }

    #[test]
    fn relative_and_empty_entries_are_ignored_even_when_they_hold_git() {
        let scratch = Scratch::new("relative");
        let directory = scratch.directory("bin");
        write_file(&directory.join("git"), 0o755);
        // Relative entries and empty entries (".", "", "bin") resolve against the cwd of
        // the process, so none may be used.
        let path_value = std::ffi::OsString::from(".::bin:relative/dir:");

        assert_eq!(
            find_git_executable_in(Some(&path_value), Platform::Unix),
            None
        );
    }

    #[test]
    fn a_missing_or_empty_path_finds_nothing() {
        assert_eq!(find_git_executable_in(None, Platform::Unix), None);
        assert_eq!(
            find_git_executable_in(Some(OsStr::new("")), Platform::Unix),
            None
        );
    }

    #[test]
    fn a_file_without_execute_permission_or_a_directory_is_skipped() {
        let scratch = Scratch::new("permission");
        let not_executable = scratch.directory("plain");
        let directory_named_git = scratch.directory("dir");
        write_file(&not_executable.join("git"), 0o644);
        fs::create_dir_all(directory_named_git.join("git")).unwrap();

        let found = find_git_executable_in(
            Some(&join(&[&not_executable, &directory_named_git])),
            Platform::Unix,
        );

        assert_eq!(found, None);
    }

    #[test]
    fn the_windows_rule_accepts_git_exe_only() {
        let scratch = Scratch::new("windows");
        let batch_only = scratch.directory("batch");
        let plain_only = scratch.directory("plain");
        let with_exe = scratch.directory("exe");
        write_file(&batch_only.join("git.cmd"), 0o755);
        write_file(&batch_only.join("git.bat"), 0o755);
        write_file(&plain_only.join("git"), 0o755);
        write_file(&with_exe.join("git.exe"), 0o755);

        let found = find_git_executable_in(
            Some(&join(&[&batch_only, &plain_only, &with_exe])),
            Platform::Windows,
        );

        assert_eq!(found, Some(with_exe.join("git.exe")));
        assert_eq!(
            find_git_executable_in(Some(&join(&[&with_exe])), Platform::Unix),
            None
        );
    }
}
