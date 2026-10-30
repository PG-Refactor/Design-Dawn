//! Fetch, pull, push, publish and the remote list against the system `git` in temporary
//! repositories with a local bare remote (a file path: no network). Every git process runs with a hermetic configuration (no user or system config,
//! a throwaway HOME, identity only from each repository's own config). Tests are skipped,
//! with a message, when no `git` is installed.

mod support;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use design_dawn_lib::application::error::{ApplicationResult, ErrorKind};
use design_dawn_lib::application::git_commit::GitCommitStatus;
use design_dawn_lib::application::git_operations::{
    read_git_status, GitFileChange, GitStatusResult,
};
use design_dawn_lib::application::git_remote::{
    fetch, publish, pull, push, remotes, GitRemoteResult,
};
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use support::*;

const PROJECT_DIRECTORY: &str = "project";
const HOME_DIRECTORY: &str = "home";
const EMPTY_CONFIG_FILE: &str = "empty-gitconfig";
const AUTHOR_NAME: &str = "Design Dawn Test";
const AUTHOR_EMAIL: &str = "test@example.invalid";
const REMOTE_DIRECTORY: &str = "remote.git";
const OTHER_CLONE_DIRECTORY: &str = "other-clone";
const ORIGIN: &str = "origin";

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
        let home = temp.path().join(HOME_DIRECTORY);
        fs::create_dir_all(&home).unwrap();
        let empty_config = temp.path().join(EMPTY_CONFIG_FILE);
        fs::write(&empty_config, "").unwrap();
        let environment = [
            ("HOME", home.clone().into_os_string()),
            ("XDG_CONFIG_HOME", home.into_os_string()),
            ("GIT_CONFIG_GLOBAL", empty_config.clone().into_os_string()),
            ("GIT_CONFIG_SYSTEM", empty_config.into_os_string()),
            ("GIT_CONFIG_NOSYSTEM", OsString::from("1")),
        ]
        .into_iter()
        .map(|(name, value)| (OsString::from(name), value))
        .collect();
        Some(Self {
            temp,
            executable,
            environment,
        })
    }

    fn runner(&self) -> GitRunner {
        self.environment.iter().fold(
            GitRunner::new(self.executable.clone()),
            |runner, (name, value)| runner.with_environment(name, value),
        )
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
        // Another test sets these to prove the app ignores them; the set-up must not see them.
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

    fn identify(&self, repository: &Path) {
        self.git(repository, &["config", "user.name", AUTHOR_NAME]);
        self.git(repository, &["config", "user.email", AUTHOR_EMAIL]);
    }

    /// A repository with one commit and no remote.
    fn repository(&self) -> PathBuf {
        let project = self.directory(PROJECT_DIRECTORY);
        self.git(&project, &["init", "-q"]);
        self.identify(&project);
        write(&project, "tracked.md", "base\n");
        write(&project, "other.md", "other\n");
        self.git(&project, &["add", "-A"]);
        self.git(&project, &["commit", "-q", "-m", "initial"]);
        project
    }

    /// Adds a local bare remote named `origin` without pushing.
    fn add_remote(&self, project: &Path) -> PathBuf {
        let remote = self.directory(REMOTE_DIRECTORY);
        self.git(&remote, &["init", "-q", "--bare"]);
        self.git(
            project,
            &["remote", "add", ORIGIN, remote.to_str().unwrap()],
        );
        remote
    }

    /// A repository with a remote and the current branch published with upstream tracking.
    fn published_repository(&self) -> (PathBuf, PathBuf) {
        let project = self.repository();
        let remote = self.add_remote(&project);
        self.git(&project, &["push", "-q", "-u", ORIGIN, "HEAD"]);
        (project, remote)
    }

    fn clone_of(&self, remote: &Path) -> PathBuf {
        let other = self.directory(OTHER_CLONE_DIRECTORY);
        self.git(
            self.temp.path(),
            &[
                "clone",
                "-q",
                remote.to_str().unwrap(),
                other.to_str().unwrap(),
            ],
        );
        self.identify(&other);
        other
    }

    fn commit_file(&self, repository: &Path, name: &str, content: &str, message: &str) {
        write(repository, name, content);
        self.git(repository, &["add", "-A"]);
        self.git(repository, &["commit", "-q", "-m", message]);
    }

    /// Commits `name` in a second clone and pushes it, so the remote is ahead of `project`.
    fn advance_remote(&self, remote: &Path, branch: &str, name: &str, content: &str) {
        let other = self.clone_of(remote);
        self.commit_file(&other, name, content, "remote commit");
        self.git(&other, &["push", "-q", ORIGIN, branch]);
    }

    fn branch_name(&self, project: &Path) -> String {
        self.git_output(project, &["branch", "--show-current"])
            .trim()
            .to_owned()
    }

    fn head(&self, project: &Path) -> String {
        self.git_output(project, &["rev-parse", "HEAD"])
            .trim()
            .to_owned()
    }

    fn remote_branch_head(&self, remote: &Path, branch: &str) -> String {
        self.git_output(remote, &["rev-parse", &format!("refs/heads/{branch}")])
            .trim()
            .to_owned()
    }

    fn status(&self, project: &Path) -> GitStatusResult {
        read_git_status(Some(&self.runner()), project).expect("status")
    }

    fn fetch(&self, project: &Path) -> ApplicationResult<GitRemoteResult> {
        fetch(Some(&self.runner()), project)
    }

    fn pull(&self, project: &Path) -> ApplicationResult<GitRemoteResult> {
        pull(Some(&self.runner()), project)
    }

    fn push(&self, project: &Path) -> ApplicationResult<GitRemoteResult> {
        push(Some(&self.runner()), project)
    }

    fn publish(&self, project: &Path, remote: &str) -> ApplicationResult<GitRemoteResult> {
        publish(Some(&self.runner()), project, remote)
    }
}

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

fn updated(result: &GitRemoteResult) -> &GitStatusResult {
    match &result.status {
        GitCommitStatus::Updated { status } => status,
        other => panic!("expected an updated status, got {other:?}"),
    }
}

fn error_kind<T: std::fmt::Debug>(result: ApplicationResult<T>) -> ErrorKind {
    result.expect_err("the operation must be refused").kind
}

// ---- remotes ----

#[test]
fn remotes_lists_the_names_only() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    assert_eq!(
        remotes(Some(&fixture.runner()), &project).unwrap(),
        Vec::<String>::new()
    );
    fixture.add_remote(&project);
    fixture.git(
        &project,
        &[
            "remote",
            "add",
            "backup",
            "https://user:secret@example.invalid/a.git",
        ],
    );

    let mut names = remotes(Some(&fixture.runner()), &project).unwrap();
    names.sort();

    assert_eq!(names, ["backup", ORIGIN]);
}

#[test]
fn remotes_is_refused_when_the_repository_is_not_ready() {
    let fixture = fixture_or_skip!();
    let plain = fixture.directory("plain");

    assert_eq!(
        error_kind(remotes(Some(&fixture.runner()), &plain)),
        ErrorKind::GitNotReady
    );
}

// ---- fetch ----

#[test]
fn fetch_updates_the_behind_count_without_touching_the_branch() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.advance_remote(&remote, &branch, "remote.md", "r\n");
    let head_before = fixture.head(&project);

    let result = fixture.fetch(&project).unwrap();

    let info = updated(&result).branch.clone().unwrap();
    assert_eq!((info.ahead, info.behind), (Some(0), Some(1)));
    assert_eq!(fixture.head(&project), head_before);
    assert!(!project.join("remote.md").exists());
}

#[test]
fn fetch_without_a_remote_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();

    assert_eq!(error_kind(fixture.fetch(&project)), ErrorKind::GitNoRemote);
}

// ---- pull ----

#[test]
fn pull_fast_forwards_head_and_files() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.advance_remote(&remote, &branch, "remote.md", "r\n");
    let head_before = fixture.head(&project);

    let result = fixture.pull(&project).unwrap();

    assert_ne!(fixture.head(&project), head_before);
    assert_eq!(
        fs::read_to_string(project.join("remote.md")).unwrap(),
        "r\n"
    );
    let info = updated(&result).branch.clone().unwrap();
    assert_eq!((info.ahead, info.behind), (Some(0), Some(0)));
}

#[test]
fn pull_merges_a_diverged_branch_without_an_editor_even_if_rebase_is_configured() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.git(&project, &["config", "pull.rebase", "true"]);
    fixture.advance_remote(&remote, &branch, "remote.md", "r\n");
    fixture.commit_file(&project, "local.md", "l\n", "local commit");

    let result = fixture.pull(&project).unwrap();

    let parents = fixture.git_output(&project, &["log", "-1", "--format=%P"]);
    assert_eq!(parents.split_whitespace().count(), 2, "a merge commit");
    assert!(project.join("remote.md").exists());
    assert!(project.join("local.md").exists());
    let info = updated(&result).branch.clone().unwrap();
    assert_eq!((info.ahead, info.behind), (Some(2), Some(0)));
}

#[test]
fn pull_conflict_is_reported_and_leaves_unmerged_files() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.advance_remote(&remote, &branch, "tracked.md", "remote version\n");
    fixture.commit_file(&project, "tracked.md", "local version\n", "local edit");

    assert_eq!(
        error_kind(fixture.pull(&project)),
        ErrorKind::GitPullConflicts
    );

    let status = fixture.status(&project);
    assert!(status
        .files
        .iter()
        .any(|file| file.path == "tracked.md" && file.index_status == GitFileChange::Unmerged));
}

#[test]
fn pull_is_refused_while_files_are_unmerged() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.advance_remote(&remote, &branch, "tracked.md", "remote version\n");
    fixture.commit_file(&project, "tracked.md", "local version\n", "local edit");
    assert_eq!(
        error_kind(fixture.pull(&project)),
        ErrorKind::GitPullConflicts
    );

    assert_eq!(
        error_kind(fixture.pull(&project)),
        ErrorKind::GitUnmergedChanges
    );
}

#[test]
fn pull_blocked_by_local_changes_changes_nothing() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.advance_remote(&remote, &branch, "tracked.md", "remote version\n");
    write(&project, "tracked.md", "uncommitted edit\n");
    let head_before = fixture.head(&project);

    assert_eq!(
        error_kind(fixture.pull(&project)),
        ErrorKind::GitPullBlockedByLocalChanges
    );

    assert_eq!(fixture.head(&project), head_before);
    assert_eq!(
        fs::read_to_string(project.join("tracked.md")).unwrap(),
        "uncommitted edit\n"
    );
}

#[test]
fn pull_without_an_upstream_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.add_remote(&project);

    assert_eq!(error_kind(fixture.pull(&project)), ErrorKind::GitNoUpstream);
}

#[test]
fn pull_on_a_detached_head_is_refused() {
    let fixture = fixture_or_skip!();
    let (project, _remote) = fixture.published_repository();
    fixture.git(&project, &["checkout", "-q", "--detach"]);

    assert_eq!(
        error_kind(fixture.pull(&project)),
        ErrorKind::GitDetachedHead
    );
}

#[test]
fn pull_during_an_unfinished_merge_is_refused() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.advance_remote(&remote, &branch, "remote.md", "r\n");
    fixture.git(&project, &["fetch", "-q"]);
    fixture.commit_file(&project, "local.md", "l\n", "local commit");
    fixture.git(
        &project,
        &[
            "merge",
            "-q",
            "--no-commit",
            "--no-ff",
            &format!("{ORIGIN}/{branch}"),
        ],
    );

    assert_eq!(
        error_kind(fixture.pull(&project)),
        ErrorKind::GitOperationInProgress
    );
}

// ---- push ----

#[test]
fn push_sends_local_commits_and_clears_the_ahead_count() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.commit_file(&project, "a.md", "a\n", "local 1");

    let result = fixture.push(&project).unwrap();

    let info = updated(&result).branch.clone().unwrap();
    assert_eq!((info.ahead, info.behind), (Some(0), Some(0)));
    assert_eq!(
        fixture.remote_branch_head(&remote, &branch),
        fixture.head(&project)
    );
}

#[test]
fn a_rejected_push_is_reported_and_the_remote_is_not_forced() {
    let fixture = fixture_or_skip!();
    let (project, remote) = fixture.published_repository();
    let branch = fixture.branch_name(&project);
    fixture.advance_remote(&remote, &branch, "remote.md", "r\n");
    let remote_head = fixture.remote_branch_head(&remote, &branch);
    fixture.commit_file(&project, "local.md", "l\n", "local commit");

    assert_eq!(
        error_kind(fixture.push(&project)),
        ErrorKind::GitPushRejected
    );

    assert_eq!(fixture.remote_branch_head(&remote, &branch), remote_head);
}

#[test]
fn push_without_an_upstream_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let remote = fixture.add_remote(&project);

    assert_eq!(error_kind(fixture.push(&project)), ErrorKind::GitNoUpstream);

    assert!(!fixture.git_in(&remote, &["rev-parse", "--verify", "-q", "HEAD"]));
}

#[test]
fn push_on_a_detached_head_is_refused() {
    let fixture = fixture_or_skip!();
    let (project, _remote) = fixture.published_repository();
    fixture.git(&project, &["checkout", "-q", "--detach"]);

    assert_eq!(
        error_kind(fixture.push(&project)),
        ErrorKind::GitDetachedHead
    );
}

// ---- publish ----

#[test]
fn publish_pushes_the_branch_and_sets_the_upstream() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let remote = fixture.add_remote(&project);
    let branch = fixture.branch_name(&project);

    let result = fixture.publish(&project, ORIGIN).unwrap();

    let info = updated(&result).branch.clone().unwrap();
    assert_eq!(info.upstream, Some(format!("{ORIGIN}/{branch}")));
    assert_eq!((info.ahead, info.behind), (Some(0), Some(0)));
    assert_eq!(
        fixture.remote_branch_head(&remote, &branch),
        fixture.head(&project)
    );
}

#[test]
fn publish_refuses_a_remote_that_does_not_exist_or_looks_like_an_option() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let remote = fixture.add_remote(&project);

    for name in ["nowhere", "-x", "--force", "", "origin ", "ORIGIN"] {
        assert_eq!(
            error_kind(fixture.publish(&project, name)),
            ErrorKind::GitRemoteNotFound,
            "{name:?}"
        );
    }

    assert!(!fixture.git_in(&remote, &["rev-parse", "--verify", "-q", "HEAD"]));
    assert_eq!(fixture.status(&project).branch.unwrap().upstream, None);
}

#[test]
fn publish_is_refused_when_the_branch_already_has_an_upstream() {
    let fixture = fixture_or_skip!();
    let (project, _remote) = fixture.published_repository();

    assert_eq!(
        error_kind(fixture.publish(&project, ORIGIN)),
        ErrorKind::GitCommandFailed
    );
}

#[test]
fn publish_on_a_detached_head_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.add_remote(&project);
    fixture.git(&project, &["checkout", "-q", "--detach"]);

    assert_eq!(
        error_kind(fixture.publish(&project, ORIGIN)),
        ErrorKind::GitDetachedHead
    );
}
