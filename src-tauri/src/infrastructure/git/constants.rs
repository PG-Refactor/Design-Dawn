//! Every fixed value of the Git integration (CLAUDE.md §46): executable names, environment
//! variable names, git arguments, limits and timeouts.

use std::time::Duration;

/// Default time limit of one git process (docs/git-development.md §11.6). Diff may get its
/// own value later.
pub const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// `status` output of a very large working tree stays well below this; reaching it means
/// something is wrong, and a truncated record list must never be parsed.
pub const GIT_STDOUT_LIMIT_BYTES: usize = 16 * 1024 * 1024;

/// stderr is only classified and logged, never shown.
pub const GIT_STDERR_LIMIT_BYTES: usize = 64 * 1024;

/// How often a running process is checked against its deadline.
pub const GIT_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// How long the output readers get to finish after the process ended or was killed. A
/// grandchild that inherited the pipes (a daemon) must not hold the command forever.
pub const GIT_PIPE_DRAIN_GRACE: Duration = Duration::from_secs(2);

/// Windows process creation flag that stops git from opening a console window.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const PATH_ENVIRONMENT_VARIABLE: &str = "PATH";
pub const GIT_EXECUTABLE_NAME: &str = "git";
/// Only `.exe` on Windows: a `git.cmd` / `git.bat` would be run through `cmd.exe`, which
/// interprets metacharacters in the arguments. Git for Windows ships `git.exe` in `cmd\`.
pub const GIT_WINDOWS_EXECUTABLE_NAME: &str = "git.exe";

/// Never ask for credentials on a terminal that does not exist.
pub const ENV_TERMINAL_PROMPT: (&str, &str) = ("GIT_TERMINAL_PROMPT", "0");
/// `:` (a no-op) runs as a shell command on Unix and in Git for Windows' bundled `sh`, so
/// no editor ever opens; unlike `true` it needs no executable on PATH.
pub const GIT_NO_OP_EDITOR: &str = ":";
pub const ENV_EDITOR: &str = "GIT_EDITOR";
pub const ENV_SEQUENCE_EDITOR: &str = "GIT_SEQUENCE_EDITOR";
/// Git's messages are classified (not a repository) only for the detection call, which
/// forces the untranslated text for exactly that reason; stdout is never locale dependent.
pub const ENV_MESSAGE_LOCALE: (&str, &str) = ("LC_ALL", "C");

/// Variables that would point git at another repository than the working directory. They
/// are removed so the repository is always the one found from the Project root.
pub const REDIRECTING_ENVIRONMENT: [&str; 7] = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
];

/// Arguments placed before every command: no pager, literal pathspecs (a path that is
/// named `:(exclude)x`, `*` or `--help` is data, never pathspec magic), no colour, paths
/// printed as is.
pub const GLOBAL_ARGUMENTS: [&str; 6] = [
    "--no-pager",
    "--literal-pathspecs",
    "-c",
    "color.ui=false",
    "-c",
    "core.quotepath=false",
];

/// Top-level option: a read-only command must not take the optional index lock (it would
/// make a concurrent git operation of the user fail).
pub const ARG_NO_OPTIONAL_LOCKS: &str = "--no-optional-locks";

/// Paths are given on stdin (NUL separated), never on the command line: no length limit and
/// no argument that could be read as an option.
pub const ARG_PATHSPEC_FROM_STDIN: &str = "--pathspec-from-file=-";
pub const ARG_PATHSPEC_FILE_NUL: &str = "--pathspec-file-nul";
pub const PATHSPEC_SEPARATOR: u8 = 0;

pub const ARG_VERSION: &str = "--version";
/// First words of `git --version` (`git version 2.45.2.windows.1`).
pub const GIT_VERSION_OUTPUT_PREFIX: &str = "git version ";
/// `--pathspec-from-file` exists for add / restore / rm since git 2.25.
pub const MINIMUM_GIT_VERSION: (u32, u32) = (2, 25);

pub const ARG_REV_PARSE: &str = "rev-parse";
pub const ARG_SHOW_TOPLEVEL: &str = "--show-toplevel";
pub const ARG_ADD: &str = "add";
pub const ARG_STATUS: &str = "status";
pub const ARG_STATUS_PORCELAIN_V2: &str = "--porcelain=v2";
pub const ARG_NUL_SEPARATED: &str = "-z";
pub const ARG_UNTRACKED_ALL: &str = "--untracked-files=all";

/// `git` exits with 128 for "fatal" errors, including "not a git repository".
pub const GIT_FATAL_EXIT_CODE: i32 = 128;
/// Untranslated text (see `ENV_MESSAGE_LOCALE`) of the error outside any repository.
pub const NOT_A_REPOSITORY_MESSAGE: &str = "not a git repository";

/// Replacement for the user information of a URL in logged text.
pub const REDACTED_USER_INFORMATION: &str = "***";
