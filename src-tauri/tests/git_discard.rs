//! `discard_paths`, `git_discard_impact` and the untracked-file guard against the system
//! `git` in temporary repositories.
//! Every git process runs with a hermetic configuration (no user or system config, a
//! throwaway HOME). Tests are skipped, with a message, when no `git` is installed.

mod support;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use design_dawn_lib::application::error::{ApplicationResult, ErrorKind};
use design_dawn_lib::application::git_discard::{
    discard_paths, git_discard_impact, untracked_file_location, GitDiscardImpact,
};
use design_dawn_lib::application::git_operations::{
    read_git_status, GitFileChange, GitRepositoryState, GitStatusResult,
};
use design_dawn_lib::application::project_operations::open_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use design_dawn_lib::infrastructure::git::paths::validate_project_relative_path;
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use support::*;

const PROJECT_DIRECTORY: &str = "project";
const OUTSIDE_DIRECTORY: &str = "outside";
const HOME_DIRECTORY: &str = "home";
const EMPTY_CONFIG_FILE: &str = "empty-gitconfig";
const AUTHOR_NAME: &str = "Design Dawn Test";
const AUTHOR_EMAIL: &str = "test@example.invalid";

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

    /// A repository with a committed `tracked.md` and `other.md`.
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

    fn discard(&self, project: &Path, names: &[&str]) -> ApplicationResult<GitStatusResult> {
        let paths: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
        discard_paths(Some(&self.runner()), project, &paths)
    }

    fn status(&self, project: &Path) -> GitStatusResult {
        read_git_status(Some(&self.runner()), project).expect("status")
    }

    /// Everything in the work tree and the index, to prove a rejected request changed nothing.
    fn snapshot(&self, project: &Path) -> (String, Vec<(String, String)>) {
        let index = self.git_output(project, &["ls-files", "-s", "-z"]);
        let mut files: Vec<(String, String)> = Vec::new();
        collect_files(project, project, &mut files);
        files.sort();
        (index, files)
    }
}

fn collect_files(root: &Path, directory: &Path, files: &mut Vec<(String, String)>) {
    for entry in fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.file_name().is_some_and(|name| name == ".git") {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap().display().to_string();
        let metadata = fs::symlink_metadata(&path).unwrap();
        if metadata.is_dir() {
            collect_files(root, &path, files);
        } else if metadata.file_type().is_symlink() {
            files.push((
                relative,
                format!("link:{}", path.read_link().unwrap().display()),
            ));
        } else {
            files.push((relative, fs::read_to_string(&path).unwrap_or_default()));
        }
    }
}

fn write(directory: &Path, name: &str, content: &str) {
    let path = directory.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn read(directory: &Path, name: &str) -> String {
    fs::read_to_string(directory.join(name)).unwrap()
}

macro_rules! fixture_or_skip {
    () => {
        match Fixture::new() {
            Some(fixture) => fixture,
            None => return,
        }
    };
}

fn find<'a>(
    result: &'a GitStatusResult,
    path: &str,
) -> Option<&'a design_dawn_lib::application::git_operations::GitFileStatus> {
    result.files.iter().find(|file| file.path == path)
}

// ---- Acceptance ----

#[test]
fn a_modified_file_goes_back_to_the_index() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "edited\n");

    let status = fixture.discard(&project, &["tracked.md"]).unwrap();

    assert_eq!(read(&project, "tracked.md"), "base\n");
    assert!(status.files.is_empty());
    assert_eq!(status.repository.state, GitRepositoryState::Ready);
    assert!(status.branch.is_some());
}

#[test]
fn a_deleted_file_comes_back() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fs::remove_file(project.join("tracked.md")).unwrap();

    let status = fixture.discard(&project, &["tracked.md"]).unwrap();

    assert_eq!(read(&project, "tracked.md"), "base\n");
    assert!(status.files.is_empty());
}

#[test]
fn a_partly_staged_file_returns_to_the_index_and_keeps_the_staged_part() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "staged\n");
    fixture.git(&project, &["add", "tracked.md"]);
    write(&project, "tracked.md", "staged\nworktree\n");

    let status = fixture.discard(&project, &["tracked.md"]).unwrap();

    assert_eq!(read(&project, "tracked.md"), "staged\n");
    let entry = find(&status, "tracked.md").expect("still staged");
    assert_eq!(entry.index_status, GitFileChange::Modified);
    assert_eq!(entry.worktree_status, GitFileChange::Unmodified);
}

#[test]
fn an_untracked_file_is_deleted_and_its_directory_stays() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "notes/new.txt", "scratch\n");

    let status = fixture.discard(&project, &["notes/new.txt"]).unwrap();

    assert!(!project.join("notes/new.txt").exists());
    // Only files are removed; the (now empty) directory is left alone.
    assert!(project.join("notes").is_dir());
    assert!(status.files.is_empty());
}

#[test]
fn restore_and_delete_can_be_requested_together_in_any_order() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "edited\n");
    write(&project, "new.txt", "scratch\n");

    let status = fixture
        .discard(&project, &["new.txt", "tracked.md"])
        .unwrap();

    assert_eq!(read(&project, "tracked.md"), "base\n");
    assert!(!project.join("new.txt").exists());
    assert!(status.files.is_empty());
}

#[test]
fn an_empty_request_returns_the_status_and_changes_nothing() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "edited\n");

    let status = fixture.discard(&project, &[]).unwrap();

    assert_eq!(read(&project, "tracked.md"), "edited\n");
    assert!(find(&status, "tracked.md").is_some());
}

#[test]
fn duplicate_paths_are_discarded_once() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "edited\n");
    write(&project, "new.txt", "scratch\n");

    let status = fixture
        .discard(
            &project,
            &["tracked.md", "new.txt", "tracked.md", "new.txt"],
        )
        .unwrap();

    assert!(status.files.is_empty());
}

#[test]
fn non_ascii_and_spaced_paths_are_handled() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "設計 書.md", "base\n");
    write(&project, "dir with space/メモ.md", "base\n");
    fixture.git(&project, &["add", "-A"]);
    fixture.git(&project, &["commit", "-q", "-m", "names"]);
    write(&project, "設計 書.md", "edited\n");
    write(&project, "dir with space/メモ.md", "edited\n");
    write(&project, "新しい 設計.txt", "new\n");

    let status = fixture
        .discard(
            &project,
            &["設計 書.md", "dir with space/メモ.md", "新しい 設計.txt"],
        )
        .unwrap();

    assert_eq!(read(&project, "設計 書.md"), "base\n");
    assert_eq!(read(&project, "dir with space/メモ.md"), "base\n");
    assert!(!project.join("新しい 設計.txt").exists());
    assert!(status.files.is_empty());
}

#[test]
fn pathspec_characters_are_literal() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "*.md", "star base\n");
    fixture.git(&project, &["add", "-A"]);
    fixture.git(&project, &["commit", "-q", "-m", "star"]);
    write(&project, "*.md", "star edited\n");
    write(&project, "tracked.md", "edited\n");

    fixture.discard(&project, &["*.md"]).unwrap();

    assert_eq!(read(&project, "*.md"), "star base\n");
    // `tracked.md` matches the glob but was not named.
    assert_eq!(read(&project, "tracked.md"), "edited\n");
}

// ---- Rejections (nothing changes) ----

fn assert_rejected_without_change(
    fixture: &Fixture,
    project: &Path,
    names: &[&str],
    kind: ErrorKind,
) {
    let before = fixture.snapshot(project);

    let error = fixture.discard(project, names).unwrap_err();

    assert_eq!(error.kind, kind, "{}", error.detail);
    assert_eq!(fixture.snapshot(project), before);
}

#[test]
fn a_staged_only_change_is_rejected() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "staged\n");
    fixture.git(&project, &["add", "tracked.md"]);

    assert_rejected_without_change(
        &fixture,
        &project,
        &["tracked.md"],
        ErrorKind::GitDiscardRejected,
    );
}

#[test]
fn a_conflicted_file_is_rejected() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    write(&project, "tracked.md", "side\n");
    fixture.git(&project, &["commit", "-q", "-am", "side"]);
    fixture.git(&project, &["checkout", "-q", "-"]);
    write(&project, "tracked.md", "main\n");
    fixture.git(&project, &["commit", "-q", "-am", "main"]);
    assert!(!fixture.git_in(&project, &["merge", "side"]));
    assert_eq!(
        find(&fixture.status(&project), "tracked.md")
            .unwrap()
            .index_status,
        GitFileChange::Unmerged
    );

    assert_rejected_without_change(
        &fixture,
        &project,
        &["tracked.md"],
        ErrorKind::GitDiscardRejected,
    );
}

#[test]
fn unchanged_unknown_and_directory_paths_are_rejected() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "dir/new.txt", "new\n");

    for name in ["other.md", "missing.md", "dir", "*.md"] {
        assert_rejected_without_change(&fixture, &project, &[name], ErrorKind::GitDiscardRejected);
    }
}

#[test]
fn an_ignored_file_is_rejected() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, ".gitignore", "ignored.txt\n");
    fixture.git(&project, &["add", ".gitignore"]);
    fixture.git(&project, &["commit", "-q", "-m", "ignore"]);
    write(&project, "ignored.txt", "x\n");

    assert_rejected_without_change(
        &fixture,
        &project,
        &["ignored.txt"],
        ErrorKind::GitDiscardRejected,
    );
}

#[test]
fn one_invalid_path_among_valid_ones_changes_nothing() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "edited\n");
    write(&project, "new.txt", "scratch\n");

    assert_rejected_without_change(
        &fixture,
        &project,
        &["tracked.md", "new.txt", "other.md"],
        ErrorKind::GitDiscardRejected,
    );
    assert_rejected_without_change(
        &fixture,
        &project,
        &["tracked.md", "new.txt", "../escape"],
        ErrorKind::InvalidGitPath,
    );
}

#[test]
fn invalid_paths_are_rejected_before_anything_runs() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "edited\n");

    for name in ["", "/abs", "a/../b", "a\\b", "C:/x", "a//b", "dir/"] {
        assert_rejected_without_change(&fixture, &project, &[name], ErrorKind::InvalidGitPath);
    }
}

#[test]
fn a_repository_that_is_not_ready_is_git_not_ready() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    write(&project, "new.txt", "scratch\n");

    let error = fixture.discard(&project, &["new.txt"]).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
    assert!(project.join("new.txt").exists());
}

#[test]
fn a_missing_git_is_git_not_ready() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);

    let error = discard_paths(None, &project, &["a.md".to_owned()]).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
}

#[test]
fn the_process_git_dir_is_ignored() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let other = fixture.directory("other-repository");
    fixture.git(&other, &["init", "-q"]);
    write(&project, "tracked.md", "edited\n");

    // Only this test sets it and every git start in this binary removes it.
    std::env::set_var("GIT_DIR", other.join(".git"));
    let result = fixture.discard(&project, &["tracked.md"]);
    std::env::remove_var("GIT_DIR");

    result.unwrap();
    assert_eq!(read(&project, "tracked.md"), "base\n");
}

#[test]
fn staged_content_of_other_files_survives() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "other.md", "staged\n");
    fixture.git(&project, &["add", "other.md"]);
    write(&project, "tracked.md", "edited\n");

    let status = fixture.discard(&project, &["tracked.md"]).unwrap();

    assert_eq!(read(&project, "other.md"), "staged\n");
    let other = find(&status, "other.md").unwrap();
    assert_eq!(other.index_status, GitFileChange::Modified);
}

// ---- Untracked removal guard (symbolic links) ----

#[cfg(unix)]
#[test]
fn an_untracked_link_is_removed_as_a_link_and_its_target_survives() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let outside = fixture.directory(OUTSIDE_DIRECTORY);
    write(&outside, "target.txt", "precious\n");
    std::os::unix::fs::symlink(outside.join("target.txt"), project.join("link.txt")).unwrap();
    assert_eq!(
        find(&fixture.status(&project), "link.txt")
            .unwrap()
            .worktree_status,
        GitFileChange::Untracked
    );

    let status = fixture.discard(&project, &["link.txt"]).unwrap();

    assert!(fs::symlink_metadata(project.join("link.txt")).is_err());
    assert_eq!(read(&outside, "target.txt"), "precious\n");
    assert!(status.files.is_empty());
}

#[cfg(unix)]
#[test]
fn a_link_to_a_directory_is_removed_without_touching_the_directory() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let outside = fixture.directory(OUTSIDE_DIRECTORY);
    write(&outside, "target.txt", "precious\n");
    std::os::unix::fs::symlink(&outside, project.join("dir-link")).unwrap();

    fixture.discard(&project, &["dir-link"]).unwrap();

    assert!(fs::symlink_metadata(project.join("dir-link")).is_err());
    assert_eq!(read(&outside, "target.txt"), "precious\n");
}

#[cfg(unix)]
#[test]
fn a_path_through_a_link_to_another_directory_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let outside = fixture.directory(OUTSIDE_DIRECTORY);
    write(&outside, "target.txt", "precious\n");
    std::os::unix::fs::symlink(&outside, project.join("escape")).unwrap();
    let path = validate_project_relative_path("escape/target.txt").unwrap();

    let error = untracked_file_location(&project, &path).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitDiscardRejected);
    assert_eq!(read(&outside, "target.txt"), "precious\n");
    // Also when the link points to another place inside the project.
    fs::create_dir_all(project.join("real")).unwrap();
    write(&project, "real/x.txt", "x\n");
    std::os::unix::fs::symlink(project.join("real"), project.join("inner")).unwrap();
    let inner = validate_project_relative_path("inner/x.txt").unwrap();
    assert_eq!(
        untracked_file_location(&project, &inner).unwrap_err().kind,
        ErrorKind::GitDiscardRejected
    );
}

#[test]
fn only_files_and_links_have_a_removable_location() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    write(&project, "dir/file.txt", "x\n");

    for (name, accepted) in [
        ("dir/file.txt", true),
        ("dir", false),
        ("dir/missing.txt", false),
        ("nowhere/file.txt", false),
    ] {
        let path = validate_project_relative_path(name).unwrap();
        assert_eq!(
            untracked_file_location(&project, &path).is_ok(),
            accepted,
            "{name}"
        );
    }
}

// ---- Impact ----

fn impact(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    names: &[&str],
) -> ApplicationResult<GitDiscardImpact> {
    let paths: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    git_discard_impact(sessions, project_id, &paths)
}

#[test]
fn a_document_path_maps_to_its_document() {
    let opened = open_copy();
    let sessions = Mutex::new(opened.sessions);

    let result = impact(
        &sessions,
        PROJECT_ID,
        &[
            "documents/system-design/sheets/overview/blocks/markdown-1.md",
            "documents/system-design/document.json",
        ],
    )
    .unwrap();

    assert_eq!(result.document_ids, [DOCUMENT_ID]);
    assert!(!result.project_files_affected);
}

#[test]
fn a_document_inside_nested_folders_and_the_folder_files_are_recognised() {
    let (_temp, root) = folders_project_copy();
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).expect("open folders project");
    let sessions = Mutex::new(sessions);

    let document = impact(
        &sessions,
        FOLDERS_PROJECT_ID,
        &[
            "documents/glossary/document.json",
            "documents/architecture/backend/api-design/document.json",
            "documents/architecture/backend/api-design/sheets/x/sheet.json",
        ],
    )
    .unwrap();
    assert_eq!(
        document.document_ids,
        [GLOSSARY_DOCUMENT_ID, API_DESIGN_DOCUMENT_ID]
    );
    assert!(!document.project_files_affected);

    for name in [
        "project.json",
        "documents/architecture/folder.json",
        "documents/archive/folder.json",
    ] {
        let result = impact(&sessions, FOLDERS_PROJECT_ID, &[name]).unwrap();
        assert!(result.project_files_affected, "{name}");
        assert!(result.document_ids.is_empty(), "{name}");
    }
}

#[test]
fn unrelated_paths_affect_nothing() {
    let opened = open_copy();
    let sessions = Mutex::new(opened.sessions);

    for name in [
        "notes/x.txt",
        "system-design.dawn",
        "documents/folder.json",
        "documents/system-design-copy/document.json",
        "documents/other/folder.json",
        "sub/project.json",
    ] {
        let result = impact(&sessions, PROJECT_ID, &[name]).unwrap();
        assert!(result.document_ids.is_empty(), "{name}");
        assert!(!result.project_files_affected, "{name}");
    }
}

#[test]
fn the_impact_rejects_invalid_paths_and_unknown_projects() {
    let opened = open_copy();
    let sessions = Mutex::new(opened.sessions);

    assert_eq!(
        impact(&sessions, PROJECT_ID, &["../x"]).unwrap_err().kind,
        ErrorKind::InvalidGitPath
    );
    assert_eq!(
        impact(&sessions, UNKNOWN_ID, &["a"]).unwrap_err().kind,
        ErrorKind::ProjectNotOpen
    );
    assert_eq!(
        impact(&sessions, PROJECT_ID, &[]).unwrap(),
        GitDiscardImpact {
            document_ids: Vec::new(),
            project_files_affected: false
        }
    );
}
