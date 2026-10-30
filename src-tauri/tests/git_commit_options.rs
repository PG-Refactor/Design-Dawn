//! Commit options, Undo Last Commit and the upstream information of the status against the
//! system `git` in temporary repositories. Every git process runs with a hermetic configuration
//! (no user or system config, a throwaway HOME, identity only from the repository's own
//! config). Hooks live inside the temporary repository; no global hook path is touched.
//! Tests are skipped, with a message, when no `git` is installed.

mod support;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::git_commit::{
    commit_with_options, undo_last_commit, GitCommitOptions, GitCommitResult, GitCommitStatus,
    GitUndoCommitResult,
};
use design_dawn_lib::application::git_operations::{
    read_git_status, GitBranchInfo, GitFileChange, GitStatusResult,
};
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use support::*;

const PROJECT_DIRECTORY: &str = "project";
const HOME_DIRECTORY: &str = "home";
const EMPTY_CONFIG_FILE: &str = "empty-gitconfig";
const AUTHOR_NAME: &str = "Design Dawn Test";
const AUTHOR_EMAIL: &str = "test@example.invalid";
const SUBJECT: &str = "subject";
const REMOTE_DIRECTORY: &str = "remote.git";
const OTHER_CLONE_DIRECTORY: &str = "other-clone";
const PLAIN: GitCommitOptions = GitCommitOptions {
    amend: false,
    stage_all: false,
};
const AMEND: GitCommitOptions = GitCommitOptions {
    amend: true,
    stage_all: false,
};
const STAGE_ALL: GitCommitOptions = GitCommitOptions {
    amend: false,
    stage_all: true,
};

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

    fn commit(
        &self,
        project: &Path,
        message: &str,
        options: GitCommitOptions,
    ) -> ApplicationOutcome {
        commit_with_options(Some(&self.runner()), project, message, options)
    }

    fn undo(
        &self,
        project: &Path,
    ) -> design_dawn_lib::application::error::ApplicationResult<GitUndoCommitResult> {
        undo_last_commit(Some(&self.runner()), project)
    }

    fn status(&self, project: &Path) -> GitStatusResult {
        read_git_status(Some(&self.runner()), project).expect("status")
    }

    fn branch_name(&self, project: &Path) -> String {
        self.git_output(project, &["branch", "--show-current"])
            .trim()
            .to_owned()
    }

    /// Adds a local bare remote named `origin` and pushes the current branch to it with
    /// upstream tracking. Returns the bare repository's path.
    fn publish(&self, project: &Path) -> PathBuf {
        let remote = self.directory(REMOTE_DIRECTORY);
        self.git(&remote, &["init", "-q", "--bare"]);
        self.git(
            project,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        self.git(project, &["push", "-q", "-u", "origin", "HEAD"]);
        remote
    }

    fn commit_file(&self, project: &Path, name: &str, content: &str, message: &str) {
        write(project, name, content);
        self.git(project, &["add", "-A"]);
        self.git(project, &["commit", "-q", "-m", message]);
    }

    fn branch_info(&self, project: &Path) -> GitBranchInfo {
        self.status(project)
            .branch
            .expect("ready repository has a branch")
    }

    fn subject_of_head(&self, project: &Path) -> String {
        self.git_output(project, &["log", "-1", "--format=%s"])
            .trim()
            .to_owned()
    }

    fn head_parent(&self, project: &Path) -> String {
        self.git_output(project, &["rev-parse", "HEAD~1"])
            .trim()
            .to_owned()
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

fn updated_status(status: &GitCommitStatus) -> &GitStatusResult {
    match status {
        GitCommitStatus::Updated { status } => status,
        other => panic!("expected an updated status, got {other:?}"),
    }
}

// ---- Status: upstream, ahead / behind, headPushed ----

#[test]
fn a_branch_without_upstream_has_no_counts_and_is_not_pushed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();

    let branch = fixture.branch_info(&project);

    assert_eq!(branch.upstream, None);
    assert_eq!((branch.ahead, branch.behind), (None, None));
    assert!(!branch.head_pushed);
}

#[test]
fn an_unborn_branch_is_not_pushed() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    fixture.git(&project, &["init", "-q"]);

    let branch = fixture.branch_info(&project);

    assert_eq!(branch.oid, None);
    assert!(!branch.head_pushed);
}

#[test]
fn a_published_branch_reports_its_upstream_and_is_pushed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.publish(&project);

    let branch = fixture.branch_info(&project);

    assert_eq!(
        branch.upstream,
        Some(format!("origin/{}", fixture.branch_name(&project)))
    );
    assert_eq!((branch.ahead, branch.behind), (Some(0), Some(0)));
    assert!(branch.head_pushed);
}

#[test]
fn local_commits_count_as_ahead_and_are_not_pushed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.publish(&project);
    fixture.commit_file(&project, "a.md", "a\n", "local 1");
    fixture.commit_file(&project, "b.md", "b\n", "local 2");

    let branch = fixture.branch_info(&project);

    assert_eq!((branch.ahead, branch.behind), (Some(2), Some(0)));
    assert!(!branch.head_pushed);
}

#[test]
fn commits_on_the_remote_count_as_behind_after_a_fetch() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let remote = fixture.publish(&project);
    let branch_name = fixture.branch_name(&project);
    let other = fixture.directory(OTHER_CLONE_DIRECTORY);
    fixture.git(
        fixture.temp.path(),
        &[
            "clone",
            "-q",
            remote.to_str().unwrap(),
            other.to_str().unwrap(),
        ],
    );
    fixture.git(&other, &["config", "user.name", AUTHOR_NAME]);
    fixture.git(&other, &["config", "user.email", AUTHOR_EMAIL]);
    fixture.commit_file(&other, "remote.md", "r\n", "remote 1");
    fixture.git(&other, &["push", "-q", "origin", &branch_name]);
    fixture.commit_file(&project, "local.md", "l\n", "local");
    fixture.git(&project, &["fetch", "-q"]);

    let branch = fixture.branch_info(&project);

    assert_eq!((branch.ahead, branch.behind), (Some(1), Some(1)));
    assert!(!branch.head_pushed);
}

#[test]
fn a_gone_upstream_keeps_its_name_but_has_no_counts() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.publish(&project);
    let branch_name = fixture.branch_name(&project);
    fixture.git(
        &project,
        &[
            "update-ref",
            "-d",
            &format!("refs/remotes/origin/{branch_name}"),
        ],
    );

    let branch = fixture.branch_info(&project);

    assert_eq!(branch.upstream, Some(format!("origin/{branch_name}")));
    assert_eq!((branch.ahead, branch.behind), (None, None));
    assert!(!branch.head_pushed);
}

#[test]
fn a_push_without_tracking_still_makes_the_head_pushed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let remote = fixture.directory(REMOTE_DIRECTORY);
    fixture.git(&remote, &["init", "-q", "--bare"]);
    fixture.git(
        &project,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    fixture.git(&project, &["push", "-q", "origin", "HEAD"]);

    let branch = fixture.branch_info(&project);

    assert_eq!(branch.upstream, None);
    assert!(branch.head_pushed);
}

// ---- Commit: stage all ----

#[test]
fn stage_all_commits_modified_deleted_and_untracked_files() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "new/untracked.md", "new\n");
    fs::remove_file(project.join("other.md")).unwrap();

    let result = fixture.commit(&project, SUBJECT, STAGE_ALL).unwrap();

    assert_eq!(fixture.head_content(&project, "tracked.md"), "changed\n");
    assert_eq!(fixture.head_content(&project, "new/untracked.md"), "new\n");
    assert!(!fixture
        .head_files(&project)
        .contains(&"other.md".to_owned()));
    assert!(updated_status(&result.status).files.is_empty());
}

#[test]
fn stage_all_without_any_change_is_nothing_to_commit() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let before = fixture.head(&project);

    let error = fixture.commit(&project, SUBJECT, STAGE_ALL).unwrap_err();

    assert_eq!(error.kind, ErrorKind::NothingToCommit);
    assert_eq!(fixture.head(&project), before);
}

#[test]
fn stage_all_is_refused_before_adding_when_a_message_is_blank() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");

    let error = fixture.commit(&project, "  ", STAGE_ALL).unwrap_err();

    assert_eq!(error.kind, ErrorKind::InvalidCommitMessage);
    // Nothing was staged by the refused call.
    assert!(fixture
        .status(&project)
        .files
        .iter()
        .all(|file| file.index_status == GitFileChange::Unmodified));
}

#[test]
fn stage_all_does_not_resolve_a_conflict() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let main = fixture.branch_name(&project);
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    fixture.commit_file(&project, "tracked.md", "side\n", "side");
    fixture.git(&project, &["checkout", "-q", &main]);
    fixture.commit_file(&project, "tracked.md", "main\n", "main");
    assert!(!fixture.git_in(&project, &["merge", "-q", "side"]));
    let before = fixture.head(&project);

    let error = fixture.commit(&project, SUBJECT, STAGE_ALL).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitUnmergedChanges);
    assert_eq!(fixture.head(&project), before);
    assert!(fixture
        .status(&project)
        .files
        .iter()
        .any(|file| file.index_status == GitFileChange::Unmerged));
}

// ---- Commit: amend ----

#[test]
fn amend_replaces_the_last_commit_with_the_staged_changes_and_the_new_message() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.commit_file(&project, "a.md", "a\n", "to be replaced");
    let parent = fixture.head_parent(&project);
    write(&project, "tracked.md", "amended\n");
    fixture.git(&project, &["add", "tracked.md"]);

    let result = fixture.commit(&project, "new message", AMEND).unwrap();

    assert_eq!(fixture.head_parent(&project), parent);
    assert_eq!(fixture.subject_of_head(&project), "new message");
    assert_eq!(fixture.head_content(&project, "tracked.md"), "amended\n");
    assert_eq!(fixture.head_content(&project, "a.md"), "a\n");
    assert_eq!(
        result.commit_id.as_deref(),
        Some(fixture.head(&project).as_str())
    );
    assert!(updated_status(&result.status).files.is_empty());
}

#[test]
fn amend_with_a_blank_message_keeps_the_old_one() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.commit_file(&project, "a.md", "a\n", "keep me");
    write(&project, "tracked.md", "amended\n");
    fixture.git(&project, &["add", "tracked.md"]);

    fixture.commit(&project, " \n ", AMEND).unwrap();

    assert_eq!(fixture.stored_message(&project), "keep me\n");
    assert_eq!(fixture.head_content(&project, "tracked.md"), "amended\n");
}

#[test]
fn amend_may_change_only_the_message() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let tree_before = fixture.git_output(&project, &["rev-parse", "HEAD^{tree}"]);

    fixture.commit(&project, "reworded", AMEND).unwrap();

    assert_eq!(fixture.subject_of_head(&project), "reworded");
    assert_eq!(
        fixture.git_output(&project, &["rev-parse", "HEAD^{tree}"]),
        tree_before
    );
}

#[test]
fn amend_with_stage_all_includes_the_working_tree_changes() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "all\n");
    write(&project, "fresh.md", "fresh\n");

    let options = GitCommitOptions {
        amend: true,
        stage_all: true,
    };
    fixture.commit(&project, "", options).unwrap();

    assert_eq!(fixture.head_content(&project, "tracked.md"), "all\n");
    assert_eq!(fixture.head_content(&project, "fresh.md"), "fresh\n");
    assert_eq!(fixture.stored_message(&project), "initial\n");
}

#[test]
fn a_blank_message_is_still_refused_without_amend() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    let error = fixture.commit(&project, "  ", PLAIN).unwrap_err();

    assert_eq!(error.kind, ErrorKind::InvalidCommitMessage);
}

#[test]
fn amend_without_any_commit_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    fixture.git(&project, &["init", "-q"]);
    fixture.git(&project, &["config", "user.name", AUTHOR_NAME]);
    fixture.git(&project, &["config", "user.email", AUTHOR_EMAIL]);
    write(&project, "a.md", "a\n");
    fixture.git(&project, &["add", "a.md"]);

    let error = fixture.commit(&project, SUBJECT, AMEND).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNoCommitToAmend);
    assert!(!fixture.git_in(&project, &["rev-parse", "--verify", "-q", "HEAD"]));
}

#[test]
fn amend_of_a_pushed_commit_is_refused_and_changes_nothing() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.publish(&project);
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    let before = fixture.head(&project);

    let error = fixture.commit(&project, "rewrite", AMEND).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitCommitAlreadyPushed);
    assert_eq!(fixture.head(&project), before);
    assert_eq!(fixture.subject_of_head(&project), "initial");
}

#[test]
fn amend_of_a_local_commit_after_a_push_is_allowed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.publish(&project);
    fixture.commit_file(&project, "a.md", "a\n", "local");

    fixture.commit(&project, "local, reworded", AMEND).unwrap();

    assert_eq!(fixture.subject_of_head(&project), "local, reworded");
}

#[test]
fn amend_during_a_merge_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let main = fixture.branch_name(&project);
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    fixture.commit_file(&project, "side.md", "side\n", "side");
    fixture.git(&project, &["checkout", "-q", &main]);
    fixture.commit_file(&project, "main.md", "main\n", "main");
    fixture.git(&project, &["merge", "-q", "--no-ff", "--no-commit", "side"]);
    let before = fixture.head(&project);

    let error = fixture.commit(&project, "x", AMEND).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitOperationInProgress);
    assert_eq!(fixture.head(&project), before);
}

// ---- Undo Last Commit ----

#[test]
fn undo_returns_the_message_and_keeps_the_changes_staged() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let first = fixture.head(&project);
    write(&project, "tracked.md", "second\n");
    write(&project, "added.md", "added\n");
    fixture.git(&project, &["add", "-A"]);
    fixture.git(
        &project,
        &["commit", "-q", "-m", "second commit", "-m", "body 日本語"],
    );

    let result = fixture.undo(&project).unwrap();

    assert_eq!(
        result.message.as_deref(),
        Some("second commit\n\nbody 日本語\n")
    );
    assert_eq!(fixture.head(&project), first);
    assert_eq!(
        fs::read_to_string(project.join("tracked.md")).unwrap(),
        "second\n"
    );
    assert_eq!(
        fs::read_to_string(project.join("added.md")).unwrap(),
        "added\n"
    );
    let status = updated_status(&result.status);
    let staged: Vec<_> = status
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.index_status, file.worktree_status))
        .collect();
    assert_eq!(
        staged,
        vec![
            ("added.md", GitFileChange::Added, GitFileChange::Unmodified),
            (
                "tracked.md",
                GitFileChange::Modified,
                GitFileChange::Unmodified
            ),
        ]
    );
}

#[test]
fn undo_keeps_unstaged_and_untracked_work() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.commit_file(&project, "a.md", "a\n", "second");
    write(&project, "other.md", "dirty\n");
    write(&project, "untracked.md", "u\n");

    fixture.undo(&project).unwrap();

    assert_eq!(
        fs::read_to_string(project.join("other.md")).unwrap(),
        "dirty\n"
    );
    assert_eq!(
        fs::read_to_string(project.join("untracked.md")).unwrap(),
        "u\n"
    );
}

fn assert_undo_refused(fixture: &Fixture, project: &Path, kind: ErrorKind) {
    let head = fixture.head(project);
    let status = fixture.status(project);

    let error = fixture.undo(project).unwrap_err();

    assert_eq!(error.kind, kind, "{}", error.detail);
    assert_eq!(fixture.head(project), head);
    assert_eq!(fixture.status(project), status);
}

#[test]
fn undo_of_the_root_commit_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();

    assert_undo_refused(&fixture, &project, ErrorKind::GitCannotUndoCommit);
}

#[test]
fn undo_without_any_commit_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    fixture.git(&project, &["init", "-q"]);

    let error = fixture.undo(&project).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitCannotUndoCommit);
}

#[test]
fn undo_of_a_merge_commit_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let main = fixture.branch_name(&project);
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    fixture.commit_file(&project, "side.md", "side\n", "side");
    fixture.git(&project, &["checkout", "-q", &main]);
    fixture.commit_file(&project, "main.md", "main\n", "main");
    fixture.git(&project, &["merge", "-q", "--no-ff", "-m", "merge", "side"]);

    assert_undo_refused(&fixture, &project, ErrorKind::GitCannotUndoCommit);
}

#[test]
fn undo_of_a_pushed_commit_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.commit_file(&project, "a.md", "a\n", "second");
    fixture.publish(&project);

    assert_undo_refused(&fixture, &project, ErrorKind::GitCommitAlreadyPushed);
}

#[test]
fn undo_of_a_local_commit_after_a_push_is_allowed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.publish(&project);
    let pushed = fixture.head(&project);
    fixture.commit_file(&project, "a.md", "a\n", "local");

    let result = fixture.undo(&project).unwrap();

    assert_eq!(result.message.as_deref(), Some("local\n"));
    assert_eq!(fixture.head(&project), pushed);
}

#[test]
fn undo_during_a_merge_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let main = fixture.branch_name(&project);
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    fixture.commit_file(&project, "side.md", "side\n", "side");
    fixture.git(&project, &["checkout", "-q", &main]);
    fixture.commit_file(&project, "main.md", "main\n", "main");
    fixture.git(&project, &["merge", "-q", "--no-ff", "--no-commit", "side"]);

    assert_undo_refused(&fixture, &project, ErrorKind::GitOperationInProgress);
}

#[test]
fn undo_outside_a_repository_is_not_ready() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);

    let error = fixture.undo(&project).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
}
