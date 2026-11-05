//! `commit_staged` against the system `git` in temporary repositories. Every git process runs with a hermetic configuration
//! (no user or system config, a throwaway HOME, identity only from the repository's own
//! config). Hooks live inside the temporary repository; no global hook path is touched.
//! Tests are skipped, with a message, when no `git` is installed.
// Some tests here need Unix (permissions, symlinks, shell scripts as a fake git) and are
// compiled only there; on other platforms their helpers are unused.
#![cfg_attr(
    not(unix),
    allow(dead_code, unused_imports, unused_variables, unused_mut)
)]

mod support;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::git_commit::{commit_staged, GitCommitResult, GitCommitStatus};
use design_dawn_lib::application::git_operations::{
    read_git_status, GitFileChange, GitStatusResult,
};
use design_dawn_lib::infrastructure::git::constants::COMMIT_MESSAGE_LIMIT_BYTES;
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use support::*;

const PROJECT_DIRECTORY: &str = "project";
const HOME_DIRECTORY: &str = "home";
const EMPTY_CONFIG_FILE: &str = "empty-gitconfig";
const AUTHOR_NAME: &str = "Design Dawn Test";
const AUTHOR_EMAIL: &str = "test@example.invalid";
const HOOKS_DIRECTORY: &str = ".git/hooks";
const SUBJECT: &str = "subject";

fn hermetic_environment(root: &Path) -> Vec<(OsString, OsString)> {
    let home = root.join(HOME_DIRECTORY);
    fs::create_dir_all(&home).unwrap();
    let empty_config = root.join(EMPTY_CONFIG_FILE);
    fs::write(&empty_config, "").unwrap();
    [
        ("HOME", home.clone().into_os_string()),
        ("XDG_CONFIG_HOME", home.into_os_string()),
        ("GIT_CONFIG_GLOBAL", empty_config.clone().into_os_string()),
        ("GIT_CONFIG_SYSTEM", empty_config.into_os_string()),
        ("GIT_CONFIG_NOSYSTEM", OsString::from("1")),
    ]
    .into_iter()
    .map(|(name, value)| (OsString::from(name), value))
    .collect()
}

struct Fixture {
    temp: TempDir,
    executable: PathBuf,
    environment: Vec<(OsString, OsString)>,
}

impl Fixture {
    fn new() -> Option<Self> {
        let Some(executable) = find_git_executable() else {
            eprintln!("SKIPPED: git was not found on PATH");
            return None;
        };
        let temp = TempDir::new();
        let environment = hermetic_environment(temp.path());
        Some(Self {
            temp,
            executable,
            environment,
        })
    }

    fn runner(&self) -> GitRunner {
        self.runner_for(self.executable.clone())
    }

    fn runner_for(&self, executable: PathBuf) -> GitRunner {
        self.environment
            .iter()
            .fold(GitRunner::new(executable), |runner, (name, value)| {
                runner.with_environment(name, value)
            })
    }

    fn directory(&self, name: &str) -> PathBuf {
        let path = self.temp.path().join(name);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn git_command(&self, directory: &Path, arguments: &[&str]) -> Command {
        let mut command = Command::new(&self.executable);
        command.args(arguments).current_dir(directory);
        for (name, value) in &self.environment {
            command.env(name, value);
        }
        for name in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] {
            command.env_remove(name);
        }
        command
    }

    fn git_in(&self, directory: &Path, arguments: &[&str]) -> bool {
        self.git_command(directory, arguments)
            .output()
            .expect("run git")
            .status
            .success()
    }

    fn git(&self, directory: &Path, arguments: &[&str]) {
        assert!(
            self.git_in(directory, arguments),
            "git {arguments:?} failed"
        );
    }

    fn git_output(&self, directory: &Path, arguments: &[&str]) -> String {
        let output = self
            .git_command(directory, arguments)
            .output()
            .expect("run git");
        assert!(output.status.success(), "git {arguments:?} failed");
        String::from_utf8(output.stdout).unwrap()
    }

    /// A repository with one commit; the identity comes from the repository's config.
    fn repository(&self) -> PathBuf {
        let project = self.directory(PROJECT_DIRECTORY);
        self.git(&project, &["init", "-q"]);
        self.git(&project, &["config", "user.name", AUTHOR_NAME]);
        self.git(&project, &["config", "user.email", AUTHOR_EMAIL]);
        write(&project, "tracked.md", "base\n");
        write(&project, "other.md", "other\n");
        self.git(&project, &["add", "-A"]);
        self.git(&project, &["commit", "-q", "-m", "initial"]);
        project
    }

    fn head(&self, project: &Path) -> String {
        self.git_output(project, &["rev-parse", "HEAD"])
            .trim()
            .to_owned()
    }

    fn head_files(&self, project: &Path) -> Vec<String> {
        self.git_output(project, &["ls-tree", "-r", "--name-only", "HEAD"])
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn head_content(&self, project: &Path, name: &str) -> String {
        self.git_output(project, &["show", &format!("HEAD:{name}")])
    }

    /// The message exactly as stored in the commit object.
    fn stored_message(&self, project: &Path) -> String {
        let commit = self.git_output(project, &["cat-file", "commit", "HEAD"]);
        commit
            .split_once("\n\n")
            .map(|(_, message)| message.to_owned())
            .expect("commit object has a message")
    }

    fn commit(&self, project: &Path, message: &str) -> ApplicationOutcome {
        commit_staged(Some(&self.runner()), project, message)
    }

    fn status(&self, project: &Path) -> GitStatusResult {
        read_git_status(Some(&self.runner()), project).expect("status")
    }
}

type ApplicationOutcome = design_dawn_lib::application::error::ApplicationResult<GitCommitResult>;

fn write(directory: &Path, name: &str, content: &str) {
    let path = directory.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

macro_rules! fixture_or_skip {
    () => {
        match Fixture::new() {
            Some(fixture) => fixture,
            None => return,
        }
    };
}

fn updated_status(result: &GitCommitResult) -> &GitStatusResult {
    match &result.status {
        GitCommitStatus::Updated { status } => status,
        other => panic!("expected an updated status, got {other:?}"),
    }
}

fn assert_refused(
    fixture: &Fixture,
    project: &Path,
    message: &str,
    kind: ErrorKind,
    head_before: &str,
) {
    let error = fixture.commit(project, message).expect_err("refused");
    assert_eq!(error.kind, kind, "{message:?}: {}", error.detail);
    assert_eq!(fixture.head(project), head_before, "{message:?}");
}

// ---- What is committed ----

#[test]
fn a_staged_modification_is_committed_with_the_given_message() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let before = fixture.head(&project);

    let result = fixture.commit(&project, SUBJECT).unwrap();

    assert_ne!(fixture.head(&project), before);
    assert_eq!(fixture.head_content(&project, "tracked.md"), "changed\n");
    assert_eq!(fixture.stored_message(&project), "subject\n");
    assert!(updated_status(&result).files.is_empty());
}

#[test]
fn the_commit_id_is_the_new_head() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    let result = fixture.commit(&project, SUBJECT).unwrap();

    assert_eq!(
        result.commit_id.as_deref(),
        Some(fixture.head(&project).as_str())
    );
    let length = result.commit_id.unwrap().len();
    assert!(length == 40 || length == 64);
}

#[test]
fn a_staged_new_file_is_committed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "new.md", "new\n");
    fixture.git(&project, &["add", "new.md"]);

    fixture.commit(&project, SUBJECT).unwrap();

    assert!(fixture.head_files(&project).contains(&"new.md".to_owned()));
}

#[test]
fn a_staged_deletion_is_committed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["rm", "-q", "other.md"]);

    fixture.commit(&project, SUBJECT).unwrap();

    assert!(!fixture
        .head_files(&project)
        .contains(&"other.md".to_owned()));
    assert!(!project.join("other.md").exists());
}

#[test]
fn a_staged_rename_is_committed_as_the_new_path_only() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["mv", "other.md", "renamed.md"]);

    fixture.commit(&project, SUBJECT).unwrap();

    let files = fixture.head_files(&project);
    assert!(files.contains(&"renamed.md".to_owned()));
    assert!(!files.contains(&"other.md".to_owned()));
}

#[test]
fn only_the_staged_content_is_committed_and_later_edits_stay_in_the_working_tree() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "staged\n");
    fixture.git(&project, &["add", "tracked.md"]);
    write(&project, "tracked.md", "staged\nextra edit\n");

    let result = fixture.commit(&project, SUBJECT).unwrap();

    assert_eq!(fixture.head_content(&project, "tracked.md"), "staged\n");
    assert_eq!(
        fs::read_to_string(project.join("tracked.md")).unwrap(),
        "staged\nextra edit\n"
    );
    let status = updated_status(&result);
    assert_eq!(status.files.len(), 1);
    assert_eq!(status.files[0].worktree_status, GitFileChange::Modified);
    assert_eq!(status.files[0].index_status, GitFileChange::Unmodified);
}

#[test]
fn unstaged_tracked_changes_and_untracked_files_are_not_committed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "staged\n");
    fixture.git(&project, &["add", "tracked.md"]);
    write(&project, "other.md", "unstaged change\n");
    write(&project, "untracked.md", "u\n");

    fixture.commit(&project, SUBJECT).unwrap();

    assert_eq!(fixture.head_content(&project, "other.md"), "other\n");
    assert!(!fixture
        .head_files(&project)
        .contains(&"untracked.md".to_owned()));
    let status = fixture.status(&project);
    let untracked = status
        .files
        .iter()
        .find(|file| file.path == "untracked.md")
        .unwrap();
    assert_eq!(untracked.worktree_status, GitFileChange::Untracked);
    assert!(status.files.iter().any(|file| file.path == "other.md"));
}

// ---- Refusals before anything runs ----

#[test]
fn nothing_staged_is_refused_and_head_is_unchanged() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "unstaged\n");
    write(&project, "untracked.md", "u\n");
    let before = fixture.head(&project);

    assert_refused(
        &fixture,
        &project,
        SUBJECT,
        ErrorKind::NothingToCommit,
        &before,
    );
}

#[test]
fn an_empty_repository_with_only_untracked_files_has_nothing_to_commit() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    fixture.git(&project, &["init", "-q"]);
    fixture.git(&project, &["config", "user.name", AUTHOR_NAME]);
    fixture.git(&project, &["config", "user.email", AUTHOR_EMAIL]);
    write(&project, "untracked.md", "u\n");

    let error = fixture.commit(&project, SUBJECT).unwrap_err();

    assert_eq!(error.kind, ErrorKind::NothingToCommit);
    assert!(!fixture.git_in(&project, &["rev-parse", "--verify", "--quiet", "HEAD"]));
}

#[test]
fn the_first_commit_of_an_empty_repository_can_be_made() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    fixture.git(&project, &["init", "-q"]);
    fixture.git(&project, &["config", "user.name", AUTHOR_NAME]);
    fixture.git(&project, &["config", "user.email", AUTHOR_EMAIL]);
    write(&project, "first.md", "x\n");
    fixture.git(&project, &["add", "first.md"]);

    let result = fixture.commit(&project, SUBJECT).unwrap();

    assert_eq!(
        result.commit_id.as_deref(),
        Some(fixture.head(&project).as_str())
    );
}

#[test]
fn invalid_messages_are_refused_before_any_git_command_runs() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let before = fixture.head(&project);
    let too_long = "a".repeat(COMMIT_MESSAGE_LIMIT_BYTES + 1);
    // A runner whose git would leave a marker proves that nothing is started for a message
    // that is refused (the repository check runs first, which is why the marker is only
    // written for `commit`).
    let marker = fixture.directory("marker").join("ran");
    let marker_text = marker.display().to_string();
    #[cfg(unix)]
    let runner = {
        let real = fixture.executable.display().to_string();
        let script = fixture.directory("fake-git").join("git");
        write_script(
            &script,
            &format!(
                "for argument in \"$@\"; do case \"$argument\" in commit|status|var) touch '{marker_text}';; esac; done\nexec '{real}' \"$@\""
            ),
        );
        fixture.runner_for(script)
    };
    #[cfg(not(unix))]
    let runner = fixture.runner();

    for message in ["", "  \n ", "a\0b", "a\u{1b}b", too_long.as_str()] {
        let error = commit_staged(Some(&runner), &project, message).unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::InvalidCommitMessage,
            "{message:.20?}"
        );
    }

    assert!(!marker.exists());
    assert_eq!(fixture.head(&project), before);
}

#[test]
fn a_repository_that_is_not_ready_is_refused() {
    let fixture = fixture_or_skip!();
    let repository = fixture.repository();
    write(&repository, "nested-project/inside.md", "x");
    let plain = fixture.directory("plain");
    write(&plain, "file.md", "x");

    for root in [repository.join("nested-project"), plain] {
        let error = fixture.commit(&root, SUBJECT).unwrap_err();
        assert_eq!(error.kind, ErrorKind::GitNotReady);
    }
}

#[test]
fn commit_without_git_is_refused() {
    let project = TempDir::new();

    let error = commit_staged(None, project.path(), SUBJECT).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
}

#[test]
fn unmerged_files_are_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    write(&project, "tracked.md", "side\n");
    fixture.git(&project, &["commit", "-q", "-am", "side change"]);
    fixture.git(&project, &["checkout", "-q", "-"]);
    write(&project, "tracked.md", "main\n");
    fixture.git(&project, &["commit", "-q", "-am", "main change"]);
    assert!(!fixture.git_in(&project, &["merge", "side"]));
    let before = fixture.head(&project);

    assert_refused(
        &fixture,
        &project,
        SUBJECT,
        ErrorKind::GitUnmergedChanges,
        &before,
    );
}

#[test]
fn a_merge_in_progress_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    write(&project, "side.md", "side\n");
    fixture.git(&project, &["add", "side.md"]);
    fixture.git(&project, &["commit", "-q", "-m", "side change"]);
    fixture.git(&project, &["checkout", "-q", "-"]);
    write(&project, "main.md", "main\n");
    fixture.git(&project, &["add", "main.md"]);
    fixture.git(&project, &["commit", "-q", "-m", "main change"]);
    fixture.git(&project, &["merge", "--no-commit", "--no-ff", "side"]);
    let before = fixture.head(&project);

    assert_refused(
        &fixture,
        &project,
        SUBJECT,
        ErrorKind::GitOperationInProgress,
        &before,
    );
}

#[test]
fn a_missing_identity_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    // `useConfigOnly` stops git from inventing an identity from the user name and host.
    fixture.git(&project, &["config", "--unset", "user.name"]);
    fixture.git(&project, &["config", "--unset", "user.email"]);
    fixture.git(&project, &["config", "user.useConfigOnly", "true"]);
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let before = fixture.head(&project);

    assert_refused(
        &fixture,
        &project,
        SUBJECT,
        ErrorKind::GitIdentityMissing,
        &before,
    );
}

// ---- Message handling ----

#[test]
fn a_japanese_multi_line_message_is_stored_with_whitespace_cleanup() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    fixture
        .commit(
            &project,
            "\n\n件名です  \n\n\n# コメント風の行  \n本文\t \n\n\n",
        )
        .unwrap();

    assert_eq!(
        fixture.stored_message(&project),
        "件名です\n\n# コメント風の行\n本文\n"
    );
}

#[test]
fn crlf_and_cr_line_endings_are_stored_as_lf() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    fixture.commit(&project, "one\r\ntwo\rthree").unwrap();

    assert_eq!(fixture.stored_message(&project), "one\ntwo\nthree\n");
}

#[test]
fn messages_that_look_like_options_or_shell_syntax_are_stored_literally() {
    let fixture = fixture_or_skip!();
    let messages = [
        "--amend",
        "-a",
        "$(touch injected)",
        "; touch injected",
        "`touch injected`",
        "&& touch injected",
        "| touch injected",
    ];
    for (index, message) in messages.iter().enumerate() {
        let project = fixture.directory(&format!("project-{index}"));
        fixture.git(&project, &["init", "-q"]);
        fixture.git(&project, &["config", "user.name", AUTHOR_NAME]);
        fixture.git(&project, &["config", "user.email", AUTHOR_EMAIL]);
        write(&project, "a.md", "a\n");
        fixture.git(&project, &["add", "a.md"]);
        // An unstaged tracked change would be swept in by `-a`.
        write(&project, "b.md", "b\n");

        fixture.commit(&project, message).unwrap();

        assert_eq!(fixture.stored_message(&project), format!("{message}\n"));
        assert_eq!(fixture.head_files(&project), ["a.md"]);
        assert!(!project.join("injected").exists(), "{message}");
    }
}

#[test]
fn a_message_at_the_size_limit_is_accepted() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    fixture
        .commit(&project, &"a".repeat(COMMIT_MESSAGE_LIMIT_BYTES))
        .unwrap();

    assert_eq!(
        fixture.stored_message(&project).len(),
        COMMIT_MESSAGE_LIMIT_BYTES + 1
    );
}

// ---- Hooks ----

#[cfg(unix)]
fn install_hook(project: &Path, name: &str, body: &str) {
    write_script(&project.join(HOOKS_DIRECTORY).join(name), body);
}

#[cfg(unix)]
#[test]
fn a_succeeding_pre_commit_hook_runs_and_the_commit_is_made() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let marker = fixture.directory("hook-marker").join("ran");
    install_hook(
        &project,
        "pre-commit",
        &format!("touch '{}'", marker.display()),
    );
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let before = fixture.head(&project);

    fixture.commit(&project, SUBJECT).unwrap();

    assert!(marker.exists());
    assert_ne!(fixture.head(&project), before);
}

#[cfg(unix)]
#[test]
fn a_failing_pre_commit_hook_rejects_the_commit_and_head_is_unchanged() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    install_hook(&project, "pre-commit", "echo 'hook says no' >&2\nexit 1");
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let before = fixture.head(&project);

    let error = fixture.commit(&project, "secret message text").unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitCommitRejected);
    assert!(!error.detail.contains("secret message text"));
    assert_eq!(fixture.head(&project), before);
    // The staged change is still staged.
    assert_eq!(
        fixture.status(&project).files[0].index_status,
        GitFileChange::Modified
    );
}

#[cfg(unix)]
#[test]
fn a_hook_that_changes_the_index_is_reflected_in_the_returned_status() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "extra.md", "added by the hook\n");
    install_hook(&project, "pre-commit", "git add extra.md");
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    let result = fixture.commit(&project, SUBJECT).unwrap();

    assert_eq!(updated_status(&result), &fixture.status(&project));
    assert_eq!(
        result.commit_id.as_deref(),
        Some(fixture.head(&project).as_str())
    );
    // Git's actual behaviour is what the status shows, whichever way the hook's `git add`
    // ended up (committed with the rest, or left staged for the next commit).
    let committed = fixture
        .head_files(&project)
        .contains(&"extra.md".to_owned());
    let listed = updated_status(&result)
        .files
        .iter()
        .any(|file| file.path == "extra.md");
    assert_ne!(committed, listed);
}

// ---- Environment and status refresh ----

#[test]
fn git_dir_and_git_index_file_of_the_process_are_ignored() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let other = fixture.directory("other-repository");
    fixture.git(&other, &["init", "-q"]);
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let other_before = fixture.git_output(&other, &["count-objects"]);

    // Only this test sets them and every git start in this binary removes them, so parallel
    // tests are unaffected.
    std::env::set_var("GIT_DIR", other.join(".git"));
    std::env::set_var("GIT_INDEX_FILE", other.join(".git/index"));
    let result = fixture.commit(&project, SUBJECT);
    std::env::remove_var("GIT_DIR");
    std::env::remove_var("GIT_INDEX_FILE");

    let result = result.unwrap();
    assert_eq!(
        result.commit_id.as_deref(),
        Some(fixture.head(&project).as_str())
    );
    assert_eq!(fixture.head_content(&project, "tracked.md"), "changed\n");
    assert_eq!(fixture.git_output(&other, &["count-objects"]), other_before);
}

#[cfg(unix)]
#[test]
fn a_failing_status_after_a_successful_commit_is_reported_as_unavailable() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let real = fixture.executable.display().to_string();
    let marker = fixture.directory("fake-marker").join("committed");
    let script = fixture.directory("fake-git").join("git");
    // Behaves like git, except that `status` fails once a `commit` has happened.
    write_script(
        &script,
        &format!(
            "for argument in \"$@\"; do\n  case \"$argument\" in\n    commit) '{real}' \"$@\"; code=$?; touch '{marker}'; exit $code;;\n    status) [ -e '{marker}' ] && {{ echo boom >&2; exit 1; }};;\n  esac\ndone\nexec '{real}' \"$@\"",
            marker = marker.display()
        ),
    );

    let result = commit_staged(Some(&fixture.runner_for(script)), &project, SUBJECT).unwrap();

    assert_eq!(
        result.commit_id.as_deref(),
        Some(fixture.head(&project).as_str())
    );
    assert_eq!(
        result.status,
        GitCommitStatus::Unavailable {
            error_kind: ErrorKind::GitCommandFailed
        }
    );
    assert_eq!(fixture.head_content(&project, "tracked.md"), "changed\n");
}

#[cfg(unix)]
#[test]
fn a_head_that_cannot_be_read_after_a_successful_commit_gives_a_null_commit_id() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let real = fixture.executable.display().to_string();
    let marker = fixture.directory("fake-marker").join("committed");
    let script = fixture.directory("fake-git").join("git");
    // Behaves like git, except that `rev-parse --verify` fails once a `commit` happened.
    write_script(
        &script,
        &format!(
            "for argument in \"$@\"; do\n  case \"$argument\" in\n    commit) '{real}' \"$@\"; code=$?; touch '{marker}'; exit $code;;\n    --verify) [ -e '{marker}' ] && {{ echo boom >&2; exit 1; }};;\n  esac\ndone\nexec '{real}' \"$@\"",
            marker = marker.display()
        ),
    );

    let result = commit_staged(Some(&fixture.runner_for(script)), &project, SUBJECT).unwrap();

    assert_eq!(result.commit_id, None);
    assert!(updated_status(&result).files.is_empty());
    assert_eq!(fixture.head_content(&project, "tracked.md"), "changed\n");
    assert_eq!(
        serde_json::to_value(&result).unwrap()["commitId"],
        serde_json::Value::Null
    );
}

const FAKE_GIT_PROBE_VARIABLE: &str = "DAWN_FAKE_GIT_PROBE";
#[cfg(unix)]
const TEXT_FILE_BUSY: i32 = 26;
#[cfg(unix)]
const PROBE_ATTEMPTS: u32 = 200;
#[cfg(unix)]
const PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);

/// Writes an executable script (a fake git or a hook) and waits until it can run. Another
/// test thread may fork while the write handle is open; until that child execs, running
/// the script fails with "text file busy", which git would report as a failing hook. The
/// probe run exits at once so nothing of the body happens.
#[cfg(unix)]
fn write_script(script: &Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(script.parent().unwrap()).unwrap();
    fs::write(
        script,
        format!("#!/bin/sh\n[ -n \"${FAKE_GIT_PROBE_VARIABLE}\" ] && exit 0\n{body}\n"),
    )
    .unwrap();
    fs::set_permissions(script, fs::Permissions::from_mode(0o755)).unwrap();
    for _ in 0..PROBE_ATTEMPTS {
        match Command::new(script)
            .env(FAKE_GIT_PROBE_VARIABLE, "1")
            .status()
        {
            Err(error) if error.raw_os_error() == Some(TEXT_FILE_BUSY) => {
                std::thread::sleep(PROBE_INTERVAL);
            }
            Ok(_) => return,
            Err(error) => panic!("script could not run: {error}"),
        }
    }
    panic!("script stayed busy");
}
