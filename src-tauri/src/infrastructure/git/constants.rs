//! Every fixed value of the Git integration (CLAUDE.md §46): executable names, environment
//! variable names, git arguments, limits and timeouts.

use std::time::Duration;

/// Default time limit of one git process (docs/git-development.md §11.6). Diff may get its
/// own value later.
pub const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// Time limit of `git commit`: hooks (pre-commit, commit-msg) and signing run inside it
/// (docs/git-development.md §11.11).
pub const GIT_COMMIT_TIMEOUT: Duration = Duration::from_secs(120);

/// Largest commit message accepted, in UTF-8 bytes after line ending normalization.
pub const COMMIT_MESSAGE_LIMIT_BYTES: usize = 64 * 1024;

/// `status` output of a very large working tree stays well below this; reaching it means
/// something is wrong, and a truncated record list must never be parsed.
pub const GIT_STDOUT_LIMIT_BYTES: usize = 16 * 1024 * 1024;

/// A Diff larger than this is not shown (docs/git-development.md §11.6, §11.10): a partial
/// diff would read as a complete one. The runner reads one byte more so "exactly at the
/// limit" and "over it" can be told apart.
pub const DIFF_OUTPUT_LIMIT_BYTES: usize = 1024 * 1024;

/// Time limit of the two `diff` processes; a huge diff is drained, not stored, so it can
/// take longer than a `status` but not unboundedly.
pub const DIFF_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

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
pub const ARG_RESTORE: &str = "restore";
pub const ARG_STAGED: &str = "--staged";
pub const ARG_RM: &str = "rm";
pub const ARG_CACHED: &str = "--cached";
pub const ARG_QUIET: &str = "--quiet";
pub const ARG_VERIFY: &str = "--verify";
pub const REVISION_HEAD: &str = "HEAD";
pub const ARG_STATUS: &str = "status";
pub const ARG_STATUS_PORCELAIN_V2: &str = "--porcelain=v2";
pub const ARG_NUL_SEPARATED: &str = "-z";
pub const ARG_UNTRACKED_ALL: &str = "--untracked-files=all";

pub const ARG_DIFF: &str = "diff";
pub const ARG_NUMSTAT: &str = "--numstat";
/// An external diff program or a textconv filter is a program named by repository
/// configuration; neither may run (docs/git-development.md §11.6).
pub const ARG_NO_EXT_DIFF: &str = "--no-ext-diff";
pub const ARG_NO_TEXTCONV: &str = "--no-textconv";
pub const ARG_NO_COLOR: &str = "--no-color";
/// Shows a rename as one old / new pair instead of a deletion and an addition.
pub const ARG_FIND_RENAMES: &str = "-M";
/// Ends the options: what follows is a pathspec even when it starts with `-`.
pub const ARG_END_OF_OPTIONS: &str = "--";
/// `--numstat` prints `-` instead of a line count for a file git treats as binary.
pub const NUMSTAT_BINARY_MARKER: &[u8] = b"-";

/// `git` exits with 128 for "fatal" errors, including "not a git repository".
pub const GIT_FATAL_EXIT_CODE: i32 = 128;
/// Untranslated text (see `ENV_MESSAGE_LOCALE`) of the error outside any repository.
pub const NOT_A_REPOSITORY_MESSAGE: &str = "not a git repository";

/// Replacement for the user information of a URL in logged text.
pub const REDACTED_USER_INFORMATION: &str = "***";

pub const ARG_COMMIT: &str = "commit";
/// Top-level option pair: git configuration for this one process.
pub const ARG_CONFIG: &str = "-c";
/// The message is recorded as the UTF-8 it was given in, whatever the user configured.
pub const CONFIG_COMMIT_ENCODING_UTF8: &str = "i18n.commitEncoding=UTF-8";
/// `-F -`: the message is read from stdin, never put on the command line.
pub const ARG_MESSAGE_FILE: &str = "-F";
pub const ARG_STDIN_FILE: &str = "-";
/// Trims the message the way `git commit -F` does by default, independent of the user's
/// `commit.cleanup` setting; `#` lines are kept.
pub const ARG_CLEANUP_WHITESPACE: &str = "--cleanup=whitespace";

pub const ARG_VAR: &str = "var";
pub const VAR_AUTHOR_IDENT: &str = "GIT_AUTHOR_IDENT";
pub const VAR_COMMITTER_IDENT: &str = "GIT_COMMITTER_IDENT";

pub const ARG_GIT_PATH: &str = "--git-path";
/// Files / directories inside the git directory that exist while a merge, cherry-pick,
/// revert or rebase is unfinished. Their locations are asked from git (`--git-path`),
/// never derived from a `.git` directory layout.
pub const IN_PROGRESS_GIT_PATHS: [&str; 5] = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
];

/// Object IDs are SHA-1 (40) or SHA-256 (64) lowercase hexadecimal.
pub const OBJECT_ID_LENGTHS: [usize; 2] = [40, 64];

/// History (docs/git-development.md §11.12): page size bounds, the deepest `--skip` a cursor
/// may carry (a cursor is client supplied, so it is bounded), and the stdout bound of one
/// page (the page size limit keeps real output far below it).
pub const HISTORY_LIMIT_MIN: usize = 1;
pub const HISTORY_LIMIT_MAX: usize = 100;
pub const HISTORY_OFFSET_MAX: usize = 100_000;
pub const HISTORY_OUTPUT_LIMIT_BYTES: usize = 1024 * 1024;
/// Separates the start commit and the offset in a cursor (`<commitId>:<offset>`).
pub const HISTORY_CURSOR_SEPARATOR: char = ':';
/// Hash, parents, author name, author email, author date (strict ISO 8601), subject; the
/// fields are NUL separated (`%x00`) because commit data can never contain NUL.
pub const HISTORY_FORMAT: &str = "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s";
pub const HISTORY_FIELDS_PER_RECORD: usize = 6;
pub const ARG_LOG: &str = "log";
/// Signature verification would start gpg / ssh-keygen (an external program).
pub const ARG_NO_SHOW_SIGNATURE: &str = "--no-show-signature";
pub const ARG_MAX_COUNT: &str = "-n";
pub const ARG_SKIP_PREFIX: &str = "--skip=";
/// Peels a revision to a commit: it names nothing unless the object is a commit.
pub const REVISION_COMMIT_SUFFIX: &str = "^{commit}";
