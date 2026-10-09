//! Git runner, repository detection and `status` against the system `git` in temporary
//! repositories (docs/testing.md §26, docs/git-development.md §11). Every git process runs
//! with a hermetic configuration (no user or system config, a throwaway HOME) so the
//! result does not depend on the machine. Tests are skipped, with a message, when no `git`
//! is installed.

mod support;

use std::collections::VecDeque;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use design_dawn_lib::application::error::{ApplicationResult, ErrorKind};
use design_dawn_lib::application::folder_selection::{FolderPicker, FolderPickerError};
use design_dawn_lib::application::git_operations::{
    diff_path, read_git_status, stage_paths, unstage_paths, DiffSide, GitDiff, GitDiffOutcome,
    GitFileChange, GitFileStatus, GitRepositoryState, GitStatusResult,
};
use design_dawn_lib::application::local_state::operations::{LocalState, LocalStateDirectories};
use design_dawn_lib::commands::SharedFolderPicker;
use design_dawn_lib::infrastructure::git::constants::{
    DIFF_OUTPUT_LIMIT_BYTES, GIT_COMMAND_TIMEOUT,
};
use design_dawn_lib::infrastructure::git::executable::{
    find_git_executable, find_git_executable_in, Platform,
};
use design_dawn_lib::infrastructure::git::paths::{
    pathspec_stdin, validate_project_relative_path, ValidatedGitPath,
};
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use design_dawn_lib::infrastructure::git::version::{git_version, is_supported_git};
use serde_json::Value;
use support::*;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindowBuilder};

const PROJECT_DIRECTORY: &str = "project";
const HOME_DIRECTORY: &str = "home";
const EMPTY_CONFIG_FILE: &str = "empty-gitconfig";
const AUTHOR_NAME: &str = "Design Dawn Test";
const AUTHOR_EMAIL: &str = "test@example.invalid";
const MAIN_WINDOW_LABEL: &str = "main";
const SECOND_WINDOW_LABEL: &str = "window-1";
const LOCAL_ORIGIN: &str = "tauri://localhost";

/// Environment applied to every git process of a test, the runner's and the set-up's.
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
        ("GIT_AUTHOR_NAME", OsString::from(AUTHOR_NAME)),
        ("GIT_AUTHOR_EMAIL", OsString::from(AUTHOR_EMAIL)),
        ("GIT_COMMITTER_NAME", OsString::from(AUTHOR_NAME)),
        ("GIT_COMMITTER_EMAIL", OsString::from(AUTHOR_EMAIL)),
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
    /// `None` (with a message) when git is not installed.
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

    /// A directory under the temp root, created.
    fn directory(&self, name: &str) -> PathBuf {
        let path = self.temp.path().join(name);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn project(&self) -> PathBuf {
        self.directory(PROJECT_DIRECTORY)
    }

    /// Runs git for set-up (not through the runner under test); returns whether it
    /// succeeded so a deliberately conflicting merge can be told from a failure.
    fn git_in(&self, directory: &Path, arguments: &[&str]) -> bool {
        let mut command = Command::new(&self.executable);
        command.args(arguments).current_dir(directory);
        for (name, value) in &self.environment {
            command.env(name, value);
        }
        for name in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] {
            command.env_remove(name);
        }
        command.output().expect("run git").status.success()
    }

    fn git(&self, directory: &Path, arguments: &[&str]) {
        assert!(
            self.git_in(directory, arguments),
            "git {arguments:?} failed"
        );
    }

    /// A repository whose root is the Project directory, with one commit.
    fn repository(&self) -> PathBuf {
        let project = self.project();
        self.git(&project, &["init", "-q"]);
        write(&project, "tracked.md", "base\n");
        write(&project, "other.md", "other\n");
        self.git(&project, &["add", "-A"]);
        self.git(&project, &["commit", "-q", "-m", "initial"]);
        project
    }

    fn status(&self, project: &Path) -> GitStatusResult {
        read_git_status(Some(&self.runner()), project).expect("status")
    }
}

fn write(directory: &Path, name: &str, content: &str) {
    let path = directory.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn find<'a>(result: &'a GitStatusResult, path: &str) -> &'a GitFileStatus {
    result
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("{path} is not in {:?}", result.files))
}

fn ready_files(result: &GitStatusResult) -> &[GitFileStatus] {
    assert_eq!(result.repository.state, GitRepositoryState::Ready);
    &result.files
}

macro_rules! fixture_or_skip {
    () => {
        match Fixture::new() {
            Some(fixture) => fixture,
            None => return,
        }
    };
}

#[test]
fn project_root_equal_to_repository_root_is_ready_and_clean() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();

    let result = fixture.status(&project);

    assert_eq!(result.repository.state, GitRepositoryState::Ready);
    assert!(result.files.is_empty());
}

#[test]
fn a_project_in_a_subdirectory_of_a_repository_is_unsupported_and_lists_no_files() {
    let fixture = fixture_or_skip!();
    let repository = fixture.repository();
    let nested = repository.join("nested-project");
    write(&nested, "inside.md", "x");

    let result = fixture.status(&nested);

    assert_eq!(
        result.repository.state,
        GitRepositoryState::UnsupportedRepositoryLayout
    );
    assert!(result.files.is_empty());
}

#[test]
fn a_directory_that_is_not_in_a_repository_is_not_a_repository() {
    let fixture = fixture_or_skip!();
    let project = fixture.project();
    write(&project, "a.md", "x");

    let result = fixture.status(&project);

    assert_eq!(result.repository.state, GitRepositoryState::NotRepository);
    assert!(result.files.is_empty());
}

#[test]
fn a_symlinked_project_root_is_compared_by_real_path() {
    let fixture = fixture_or_skip!();
    let repository = fixture.repository();
    #[cfg(unix)]
    {
        let link = fixture.temp.path().join("link-to-project");
        std::os::unix::fs::symlink(&repository, &link).unwrap();

        assert_eq!(
            fixture.status(&link).repository.state,
            GitRepositoryState::Ready
        );
    }
    #[cfg(not(unix))]
    let _ = repository;
}

#[test]
fn without_git_on_path_the_state_is_git_unavailable() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let empty_directory = fixture.directory("empty-bin");
    let path_value = std::env::join_paths([&empty_directory]).unwrap();

    let found = find_git_executable_in(Some(&path_value), Platform::current());
    let result = read_git_status(found.map(GitRunner::new).as_ref(), &project).unwrap();

    assert_eq!(result.repository.state, GitRepositoryState::GitUnavailable);
    assert!(result.files.is_empty());
}

#[cfg(unix)]
#[test]
fn a_git_script_in_the_project_directory_is_never_executed() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = fixture_or_skip!();
    let project = fixture.project();
    let marker = project.join("fake-git-was-run");
    let script = project.join("git");
    fs::write(
        &script,
        format!("#!/bin/sh\ntouch '{}'\nexit 1\n", marker.display()),
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

    // PATH that does not list the project: nothing is found, and the script is not tried.
    let other = fixture.directory("empty-bin");
    let nothing = find_git_executable_in(
        Some(&std::env::join_paths([&other]).unwrap()),
        Platform::Unix,
    );
    assert!(nothing.is_none());
    // The real PATH finds the real git; the project's script still is not run.
    let result = fixture.status(&project);

    assert_eq!(result.repository.state, GitRepositoryState::NotRepository);
    assert!(!marker.exists(), "the script in the project was executed");
    assert_ne!(fixture.executable, script);
}

#[test]
fn modified_untracked_and_deleted_files() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "new/inner file.md", "new\n");
    fs::remove_file(project.join("other.md")).unwrap();

    let result = fixture.status(&project);
    ready_files(&result);

    let tracked = find(&result, "tracked.md");
    assert_eq!(tracked.index_status, GitFileChange::Unmodified);
    assert_eq!(tracked.worktree_status, GitFileChange::Modified);
    // `--untracked-files=all` lists the file, not its directory.
    let untracked = find(&result, "new/inner file.md");
    assert_eq!(untracked.index_status, GitFileChange::Untracked);
    assert_eq!(untracked.worktree_status, GitFileChange::Untracked);
    let deleted = find(&result, "other.md");
    assert_eq!(deleted.worktree_status, GitFileChange::Deleted);
    assert_eq!(result.files.len(), 3);
}

#[test]
fn staged_and_staged_then_modified_files() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "staged\n");
    write(&project, "added.md", "added\n");
    fixture.git(&project, &["add", "tracked.md", "added.md"]);
    write(&project, "added.md", "added and edited\n");

    let result = fixture.status(&project);
    ready_files(&result);

    let staged = find(&result, "tracked.md");
    assert_eq!(staged.index_status, GitFileChange::Modified);
    assert_eq!(staged.worktree_status, GitFileChange::Unmodified);
    let both = find(&result, "added.md");
    assert_eq!(both.index_status, GitFileChange::Added);
    assert_eq!(both.worktree_status, GitFileChange::Modified);
}

#[test]
fn a_staged_rename_reports_the_original_path() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["mv", "tracked.md", "renamed file.md"]);

    let result = fixture.status(&project);
    ready_files(&result);

    let renamed = find(&result, "renamed file.md");
    assert_eq!(renamed.index_status, GitFileChange::Renamed);
    assert_eq!(renamed.worktree_status, GitFileChange::Unmodified);
    assert_eq!(renamed.original_path.as_deref(), Some("tracked.md"));
    assert_eq!(result.files.len(), 1);
}

#[test]
fn a_merge_conflict_is_unmerged_on_both_sides() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    write(&project, "tracked.md", "side\n");
    fixture.git(&project, &["commit", "-q", "-am", "side change"]);
    fixture.git(&project, &["checkout", "-q", "-"]);
    write(&project, "tracked.md", "main\n");
    fixture.git(&project, &["commit", "-q", "-am", "main change"]);
    // The merge is expected to stop with a conflict (exit 1).
    assert!(!fixture.git_in(&project, &["merge", "side"]));

    let result = fixture.status(&project);
    ready_files(&result);

    let conflict = find(&result, "tracked.md");
    assert_eq!(conflict.index_status, GitFileChange::Unmerged);
    assert_eq!(conflict.worktree_status, GitFileChange::Unmerged);
}

#[test]
fn japanese_file_names_are_returned_unquoted() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "設計/概要 資料.md", "x");

    let result = fixture.status(&project);
    ready_files(&result);

    assert_eq!(
        find(&result, "設計/概要 資料.md").worktree_status,
        GitFileChange::Untracked
    );
}

#[cfg(unix)]
#[test]
fn shell_metacharacters_in_names_are_data_and_nothing_is_executed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let names = [
        "a; b & c | d > e < f $g `h`.md",
        "x $(touch pwned-by-substitution).md",
        "y `touch pwned-by-backtick`.md",
        "z; touch pwned-by-semicolon",
    ];
    for name in names {
        write(&project, name, "x");
    }

    let result = fixture.status(&project);
    ready_files(&result);

    for name in names {
        assert_eq!(
            find(&result, name).worktree_status,
            GitFileChange::Untracked
        );
    }
    for marker in [
        "pwned-by-substitution",
        "pwned-by-backtick",
        "pwned-by-semicolon",
    ] {
        assert!(!project.join(marker).exists(), "{marker} was created");
        assert!(!fixture.temp.path().join(marker).exists());
    }
}

#[test]
fn ignored_files_are_not_listed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, ".gitignore", "*.log\n");
    fixture.git(&project, &["add", ".gitignore"]);
    write(&project, "debug.log", "x");

    let result = fixture.status(&project);
    ready_files(&result);

    assert!(result.files.iter().all(|file| file.path != "debug.log"));
}

// ---- Through the Tauri IPC (mock runtime, real capability) ----

struct FakePicker {
    outcomes: Mutex<VecDeque<PathBuf>>,
}

impl FolderPicker for FakePicker {
    fn pick_folder(&self) -> Result<Option<PathBuf>, FolderPickerError> {
        Ok(self.outcomes.lock().unwrap().pop_front())
    }
}

fn build_app(folder: PathBuf, root: &Path) -> App<tauri::test::MockRuntime> {
    let picker: SharedFolderPicker = Arc::new(FakePicker {
        outcomes: Mutex::new(VecDeque::from([folder])),
    });
    let directories = LocalStateDirectories {
        config_dir: root.join("config"),
        local_data_dir: root.join("local-data"),
    };
    design_dawn_lib::configure(mock_builder())
        .manage(picker)
        .manage(LocalState::new(directories))
        .build(tauri::generate_context!())
        .expect("build app")
}

fn invoke<W: AsRef<tauri::Webview<tauri::test::MockRuntime>>>(
    webview: &W,
    command: &str,
    args: &Value,
) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: LOCAL_ORIGIN.parse().unwrap(),
        body: InvokeBody::Json(args.clone()),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(webview, request)
        .map(|body| body.deserialize::<Value>().expect("response is JSON"))
}

#[test]
fn git_status_over_ipc_has_the_documented_shape_and_no_absolute_path() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    copy_dir_all(Path::new(FIXTURE_PROJECT), &project);
    fixture.git(&project, &["init", "-q"]);
    let app = build_app(project.clone(), fixture.temp.path());
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("main window");
    let selection = invoke(&webview, "select_project_folder", &serde_json::json!({})).unwrap();
    let snapshot = invoke(
        &webview,
        "open_project",
        &serde_json::json!({ "selectionId": selection["selectionId"] }),
    )
    .unwrap();
    let project_id = snapshot["project"]["projectId"].as_str().unwrap();

    let response = invoke(
        &webview,
        "git_status",
        &serde_json::json!({ "projectId": project_id }),
    )
    .unwrap();

    assert_eq!(response["repository"]["state"], "ready");
    let files = response["files"].as_array().unwrap();
    assert!(!files.is_empty());
    let project_json = files
        .iter()
        .find(|file| file["path"] == "project.json")
        .expect("project.json is untracked");
    assert_eq!(
        project_json,
        &serde_json::json!({
            "path": "project.json",
            "indexStatus": "untracked",
            "worktreeStatus": "untracked",
            "originalPath": null
        })
    );
    let text = response.to_string();
    assert!(!text.contains(fixture.temp.path().to_str().unwrap()));
    assert!(files
        .iter()
        .all(|file| !file["path"].as_str().unwrap().starts_with('/')));
}

#[test]
fn git_status_over_ipc_reports_a_plain_folder_as_not_a_repository() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    copy_dir_all(Path::new(FIXTURE_PROJECT), &project);
    let app = build_app(project, fixture.temp.path());
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("main window");
    let selection = invoke(&webview, "select_project_folder", &serde_json::json!({})).unwrap();
    let snapshot = invoke(
        &webview,
        "open_project",
        &serde_json::json!({ "selectionId": selection["selectionId"] }),
    )
    .unwrap();

    let response = invoke(
        &webview,
        "git_status",
        &serde_json::json!({ "projectId": snapshot["project"]["projectId"] }),
    );

    // The temp directory could itself sit inside a repository on an unusual machine; the
    // point is that it is a normal answer, never an error, and lists no files.
    let response = response.unwrap();
    assert_ne!(response["repository"]["state"], "ready");
    assert_eq!(response["files"], serde_json::json!([]));
}

#[test]
fn git_status_over_ipc_is_refused_for_a_window_that_does_not_have_the_project() {
    let fixture = fixture_or_skip!();
    let project = fixture.directory(PROJECT_DIRECTORY);
    copy_dir_all(Path::new(FIXTURE_PROJECT), &project);
    fixture.git(&project, &["init", "-q"]);
    let app = build_app(project, fixture.temp.path());
    let main = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("main window");
    let other = WebviewWindowBuilder::new(&app, SECOND_WINDOW_LABEL, Default::default())
        .build()
        .expect("second window");
    let selection = invoke(&main, "select_project_folder", &serde_json::json!({})).unwrap();
    let snapshot = invoke(
        &main,
        "open_project",
        &serde_json::json!({ "selectionId": selection["selectionId"] }),
    )
    .unwrap();
    let project_id = snapshot["project"]["projectId"].clone();

    let refused = invoke(
        &other,
        "git_status",
        &serde_json::json!({ "projectId": project_id }),
    );
    let unknown = invoke(
        &main,
        "git_status",
        &serde_json::json!({ "projectId": UNKNOWN_ID }),
    );

    for outcome in [refused, unknown] {
        match outcome {
            Err(error) => assert_eq!(error["kind"], "projectNotOpen"),
            Ok(value) => panic!("expected projectNotOpen, got {value}"),
        }
    }
}

// Runner-level checks of how paths reach git (docs/git-development.md §11.6, §11.7). `git
// add` is used only to prove the mechanism; there is no public Stage API yet.

const PATHSPEC_ADD_ARGUMENTS: [&str; 4] = [
    "add",
    "--pathspec-from-file=-",
    "--pathspec-file-nul",
    "--force",
];

fn add_through_runner(fixture: &Fixture, project: &Path, names: &[&str]) {
    let paths: Vec<ValidatedGitPath> = names
        .iter()
        .map(|name| validate_project_relative_path(name).expect(name))
        .collect();
    let stdin = pathspec_stdin(&paths).unwrap();
    let output = fixture
        .runner()
        .run(
            &PATHSPEC_ADD_ARGUMENTS,
            project,
            Some(&stdin),
            GIT_COMMAND_TIMEOUT,
        )
        .unwrap();
    assert!(output.success(), "git add failed: {}", output.stderr_text());
}

fn staged_names(fixture: &Fixture, project: &Path) -> Vec<String> {
    let output = fixture
        .runner()
        .run(
            &["diff", "--cached", "--name-only", "-z"],
            project,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .unwrap();
    let mut names: Vec<String> = String::from_utf8(output.stdout)
        .unwrap()
        .split('\0')
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect();
    names.sort();
    names
}

#[test]
fn pathspec_magic_in_names_is_literal_and_only_the_named_files_are_staged() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let mut names = vec![
        ":(exclude)foo",
        ":(glob)x",
        "*",
        "?",
        "--help",
        "-x.md",
        "with space.md",
        "設計 書.md",
        "sub dir/file.md",
    ];
    // Characters Windows forbids in file names.
    if cfg!(unix) {
        names.extend(["a;b&c|d$e`f.md", "quote\"s.md", "[abc].md"]);
    }
    for name in &names {
        write(&project, name, "content\n");
    }
    write(&project, "bystander.md", "must stay untracked\n");
    write(&project, "abc.md", "must stay untracked\n");

    add_through_runner(&fixture, &project, &names);

    let mut expected: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    expected.sort();
    assert_eq!(staged_names(&fixture, &project), expected);
}

#[test]
fn the_probed_git_version_is_supported_and_matches_the_minimum_rule() {
    let fixture = fixture_or_skip!();

    let version = git_version(&fixture.runner()).unwrap();

    assert!(version.is_some(), "git --version was not parsable");
    assert_eq!(
        is_supported_git(&fixture.runner()).unwrap(),
        version.unwrap().is_supported()
    );
}

#[cfg(unix)]
#[test]
fn a_git_that_is_too_old_or_unparsable_is_git_unavailable() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    for (index, answer) in ["git version 2.24.9", "not a version"].iter().enumerate() {
        let directory = fixture.directory(&format!("fake-git-{index}"));
        let script = directory.join("git");
        write_fake_git(&script, &format!("echo '{answer}'"));

        let result = read_git_status(Some(&GitRunner::new(script)), &project).unwrap();

        assert_eq!(
            result.repository.state,
            GitRepositoryState::GitUnavailable,
            "{answer}"
        );
        assert!(result.files.is_empty());
    }
}

// ---- Stage (`git_stage`, docs/git-development.md §11.6, §11.7) ----

fn stage(fixture: &Fixture, project: &Path, names: &[&str]) -> ApplicationResult<GitStatusResult> {
    let paths: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    stage_paths(Some(&fixture.runner()), project, &paths)
}

fn assert_rejected(fixture: &Fixture, project: &Path, names: &[&str], kind: ErrorKind) {
    let before = staged_names(fixture, project);
    let error = stage(fixture, project, names).expect_err(&format!("{names:?} was accepted"));
    assert_eq!(error.kind, kind, "{names:?}");
    assert_eq!(staged_names(fixture, project), before, "{names:?}");
}

#[test]
fn stage_takes_a_modified_tracked_file() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");

    let result = stage(&fixture, &project, &["tracked.md"]).unwrap();

    let file = find(&result, "tracked.md");
    assert_eq!(file.index_status, GitFileChange::Modified);
    assert_eq!(file.worktree_status, GitFileChange::Unmodified);
}

#[test]
fn stage_takes_an_untracked_file() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "new.md", "new\n");

    let result = stage(&fixture, &project, &["new.md"]).unwrap();

    assert_eq!(find(&result, "new.md").index_status, GitFileChange::Added);
}

#[test]
fn stage_takes_the_deletion_of_a_tracked_file() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fs::remove_file(project.join("tracked.md")).unwrap();

    let result = stage(&fixture, &project, &["tracked.md"]).unwrap();

    let file = find(&result, "tracked.md");
    assert_eq!(file.index_status, GitFileChange::Deleted);
    assert_eq!(file.worktree_status, GitFileChange::Unmodified);
}

#[test]
fn stage_takes_several_files_in_one_call_and_leaves_the_rest() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "new.md", "new\n");
    write(&project, "bystander.md", "stays\n");
    fs::remove_file(project.join("other.md")).unwrap();

    // The duplicate is harmless.
    let result = stage(
        &fixture,
        &project,
        &["tracked.md", "new.md", "other.md", "new.md"],
    )
    .unwrap();

    assert_eq!(
        staged_names(&fixture, &project),
        ["new.md", "other.md", "tracked.md"]
    );
    let bystander = find(&result, "bystander.md");
    assert_eq!(bystander.index_status, GitFileChange::Untracked);
}

#[test]
fn stage_takes_odd_but_valid_names_literally() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let mut names = vec![
        "設計 書.md",
        "with space.md",
        "-leading-dash.md",
        "..foo",
        "a..b.md",
        "deep/er/nested.md",
    ];
    if cfg!(unix) {
        names.extend(["a;b&c|d$e`f.md", "quote\"s.md"]);
    }
    for name in &names {
        write(&project, name, "content\n");
    }
    write(&project, "bystander.md", "stays\n");

    let result = stage(&fixture, &project, &names).unwrap();

    let mut expected: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    expected.sort();
    assert_eq!(staged_names(&fixture, &project), expected);
    for name in &names {
        assert_eq!(find(&result, name).index_status, GitFileChange::Added);
    }
    assert_eq!(
        find(&result, "bystander.md").index_status,
        GitFileChange::Untracked
    );
}

#[test]
fn stage_rejects_invalid_paths_and_runs_nothing() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "documents/a.md", "x");
    for path in [
        "",
        ".",
        "..",
        "../foo",
        "..\\foo",
        "/foo",
        "\\foo",
        "C:\\foo",
        "C:/foo",
        "D:/foo",
        "\\\\server\\share",
        "\\\\?\\C:\\x",
        "foo/../bar",
        "documents/",
    ] {
        // One valid, changed file next to it must not be staged either.
        assert_rejected(
            &fixture,
            &project,
            &["tracked.md", path],
            ErrorKind::InvalidGitPath,
        );
    }
}

#[test]
fn stage_rejects_paths_the_status_does_not_list_as_changed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "folder/inside.md", "x");
    for path in [
        "folder",     // a directory
        "missing.md", // exists nowhere
        "other.md",   // tracked and unchanged
        "--all",      // option-like, not a file
        "--help",
        ":(exclude)foo",
        ":(glob)*",
        "*",
        "*.md", // would match every file without literal pathspecs
    ] {
        assert_rejected(
            &fixture,
            &project,
            &["tracked.md", path],
            ErrorKind::InvalidGitPath,
        );
    }
}

#[test]
fn stage_of_real_files_named_like_pathspec_magic_stages_only_those_files() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let names = ["--all", ":(glob)*", "--help"];
    // Not permitted by Windows file systems, but git and the unix file systems accept them.
    if !cfg!(unix) {
        return;
    }
    for name in names {
        write(&project, name, "content\n");
    }
    write(&project, "bystander.md", "stays\n");
    write(&project, "tracked.md", "changed\n");

    stage(&fixture, &project, &names).unwrap();

    let mut expected: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    expected.sort();
    assert_eq!(staged_names(&fixture, &project), expected);
}

#[test]
fn stage_of_an_empty_list_is_a_no_op_that_returns_the_status() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");

    let result = stage(&fixture, &project, &[]).unwrap();

    assert_eq!(result, fixture.status(&project));
    assert!(staged_names(&fixture, &project).is_empty());
}

#[test]
fn stage_in_a_repository_that_is_not_ready_is_refused() {
    let fixture = fixture_or_skip!();
    let repository = fixture.repository();
    write(&repository, "nested-project/inside.md", "x");
    let plain = fixture.directory("plain");
    write(&plain, "file.md", "x");
    let cases = [
        (
            repository.join("nested-project"),
            "unsupportedRepositoryLayout",
        ),
        (plain, "notRepository"),
    ];
    for (root, label) in cases {
        let error = stage(&fixture, &root, &["inside.md"]).expect_err(label);
        // An enclosing repository on an unusual machine could make `plain` a layout case;
        // either way nothing is staged and the kind is the same.
        assert_eq!(error.kind, ErrorKind::GitNotReady, "{label}");
    }
    assert!(staged_names(&fixture, &repository).is_empty());
    assert!(!repository.join("nested-project/.git").exists());
}

#[test]
fn stage_without_git_is_refused() {
    let project = TempDir::new();

    let error = stage_paths(None, project.path(), &["a.md".to_owned()]).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
}

#[cfg(unix)]
#[test]
fn stage_with_an_unusable_git_version_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "new.md", "x");
    let directory = fixture.directory("fake-git");
    let script = directory.join("git");
    write_fake_git(&script, "echo 'git version 2.24.9'");

    let error = stage_paths(
        Some(&GitRunner::new(script)),
        &project,
        &["new.md".to_owned()],
    )
    .unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
    assert!(staged_names(&fixture, &project).is_empty());
}

#[test]
fn stage_ignores_git_dir_and_git_index_file_of_the_process() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let other = fixture.directory("other-repository");
    fixture.git(&other, &["init", "-q"]);
    write(&project, "new.md", "x");
    write(&other, "decoy.md", "x");
    let other_git_dir = other.join(".git");
    let other_index = other_git_dir.join("index");

    // Only this test sets them and every git start in this binary removes them, so parallel
    // tests are unaffected.
    std::env::set_var("GIT_DIR", &other_git_dir);
    std::env::set_var("GIT_INDEX_FILE", &other_index);
    let result = stage(&fixture, &project, &["new.md"]);
    std::env::remove_var("GIT_DIR");
    std::env::remove_var("GIT_INDEX_FILE");

    let result = result.unwrap();
    assert_eq!(find(&result, "new.md").index_status, GitFileChange::Added);
    assert!(staged_names(&fixture, &project).contains(&"new.md".to_owned()));
    assert!(staged_names(&fixture, &other).is_empty());
}

// ---- Unstage (`git_unstage`, docs/git-development.md §11.6) ----

fn unstage(
    fixture: &Fixture,
    project: &Path,
    names: &[&str],
) -> ApplicationResult<GitStatusResult> {
    let paths: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    unstage_paths(Some(&fixture.runner()), project, &paths)
}

/// `ls-files --stage` (mode, object, stage number and path of every entry) as one string:
/// equal before and after means the index was not touched at all.
fn index_snapshot(fixture: &Fixture, project: &Path) -> String {
    let output = fixture
        .runner()
        .run(
            &["ls-files", "--stage", "-z"],
            project,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .unwrap();
    String::from_utf8(output.stdout).unwrap()
}

fn assert_unstage_rejected(fixture: &Fixture, project: &Path, names: &[&str], kind: ErrorKind) {
    let before = index_snapshot(fixture, project);
    let error = unstage(fixture, project, names).expect_err(&format!("{names:?} was accepted"));
    assert_eq!(error.kind, kind, "{names:?}");
    assert_eq!(index_snapshot(fixture, project), before, "{names:?}");
}

#[test]
fn unstage_takes_a_staged_modification_back_and_keeps_the_content() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    let result = unstage(&fixture, &project, &["tracked.md"]).unwrap();

    let file = find(&result, "tracked.md");
    assert_eq!(file.index_status, GitFileChange::Unmodified);
    assert_eq!(file.worktree_status, GitFileChange::Modified);
    assert_eq!(
        fs::read_to_string(project.join("tracked.md")).unwrap(),
        "changed\n"
    );
}

#[test]
fn unstage_makes_a_staged_new_file_untracked_and_keeps_it() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "new.md", "new\n");
    fixture.git(&project, &["add", "new.md"]);

    let result = unstage(&fixture, &project, &["new.md"]).unwrap();

    assert_eq!(
        find(&result, "new.md").index_status,
        GitFileChange::Untracked
    );
    assert_eq!(fs::read_to_string(project.join("new.md")).unwrap(), "new\n");
}

#[test]
fn unstage_in_a_repository_without_a_commit_removes_only_the_index_entry() {
    let fixture = fixture_or_skip!();
    let project = fixture.project();
    fixture.git(&project, &["init", "-q"]);
    write(&project, "first.md", "first\n");
    write(&project, "second.md", "second\n");
    write(&project, "-dash.md", "dash\n");
    fixture.git(&project, &["add", "-A"]);

    let result = unstage(&fixture, &project, &["first.md", "-dash.md"]).unwrap();

    assert_eq!(
        find(&result, "first.md").index_status,
        GitFileChange::Untracked
    );
    assert_eq!(
        find(&result, "-dash.md").index_status,
        GitFileChange::Untracked
    );
    assert_eq!(
        find(&result, "second.md").index_status,
        GitFileChange::Added
    );
    assert_eq!(staged_names(&fixture, &project), ["second.md"]);
    assert_eq!(
        fs::read_to_string(project.join("first.md")).unwrap(),
        "first\n"
    );
    assert_eq!(
        fs::read_to_string(project.join("-dash.md")).unwrap(),
        "dash\n"
    );
}

#[test]
fn unstage_takes_several_files_in_one_call_and_leaves_the_rest() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "new.md", "new\n");
    write(&project, "kept.md", "kept\n");
    fixture.git(&project, &["add", "-A"]);

    // The duplicate is harmless.
    unstage(&fixture, &project, &["tracked.md", "new.md", "tracked.md"]).unwrap();

    assert_eq!(staged_names(&fixture, &project), ["kept.md"]);
}

#[test]
fn unstage_takes_odd_but_valid_names_literally() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let mut names = vec![
        "設計 書.md",
        "-leading-dash.md",
        "with space.md",
        "deep/er/nested.md",
    ];
    if cfg!(unix) {
        names.extend(["a;b&c|d$e`f.md", "quote\"s.md"]);
    }
    for name in &names {
        write(&project, name, "content\n");
    }
    write(&project, "kept.md", "kept\n");
    fixture.git(&project, &["add", "-A"]);

    let result = unstage(&fixture, &project, &names).unwrap();

    assert_eq!(staged_names(&fixture, &project), ["kept.md"]);
    for name in &names {
        assert_eq!(find(&result, name).index_status, GitFileChange::Untracked);
    }
}

#[test]
fn unstage_of_a_staged_deletion_restores_the_index_and_leaves_the_file_deleted() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["rm", "-q", "tracked.md"]);

    let result = unstage(&fixture, &project, &["tracked.md"]).unwrap();

    let file = find(&result, "tracked.md");
    assert_eq!(file.index_status, GitFileChange::Unmodified);
    assert_eq!(file.worktree_status, GitFileChange::Deleted);
    assert!(!project.join("tracked.md").exists());
}

#[test]
fn unstage_of_a_staged_rename_unstages_it_as_a_whole() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["mv", "tracked.md", "renamed.md"]);
    assert_eq!(
        find(&fixture.status(&project), "renamed.md").index_status,
        GitFileChange::Renamed
    );

    let result = unstage(&fixture, &project, &["renamed.md"]).unwrap();

    assert!(staged_names(&fixture, &project).is_empty());
    assert_eq!(
        find(&result, "renamed.md").index_status,
        GitFileChange::Untracked
    );
    assert_eq!(
        find(&result, "tracked.md").worktree_status,
        GitFileChange::Deleted
    );
    assert!(project.join("renamed.md").exists());
}

#[test]
fn unstage_of_a_partly_staged_file_keeps_the_working_tree_changes() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "staged\n");
    fixture.git(&project, &["add", "tracked.md"]);
    write(&project, "tracked.md", "staged\nand more\n");

    let result = unstage(&fixture, &project, &["tracked.md"]).unwrap();

    let file = find(&result, "tracked.md");
    assert_eq!(file.index_status, GitFileChange::Unmodified);
    assert_eq!(file.worktree_status, GitFileChange::Modified);
    assert_eq!(
        fs::read_to_string(project.join("tracked.md")).unwrap(),
        "staged\nand more\n"
    );
}

#[test]
fn unstage_rejects_invalid_paths_and_runs_nothing() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "documents/a.md", "x");
    fixture.git(&project, &["add", "-A"]);
    for path in [
        "",
        ".",
        "..",
        "../foo",
        "..\\foo",
        "/foo",
        "\\foo",
        "C:\\foo",
        "C:/foo",
        "D:/foo",
        "\\\\server\\share",
        "\\\\?\\C:\\x",
        "foo/../bar",
        "documents/",
    ] {
        assert_unstage_rejected(
            &fixture,
            &project,
            &["tracked.md", path],
            ErrorKind::InvalidGitPath,
        );
    }
}

#[test]
fn unstage_rejects_paths_without_a_staged_change() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);
    write(&project, "other.md", "modified but not staged\n");
    write(&project, "untracked.md", "x");
    write(&project, "folder/inside.md", "x");
    fixture.git(&project, &["add", "folder/inside.md"]);
    for path in [
        "other.md",     // changed in the working tree only
        "untracked.md", // untracked
        "missing.md",   // exists nowhere
        "folder",       // a directory
        "--all",
        "--help",
        ":(exclude)foo",
        ":(glob)*",
        "*",
        "*.md", // would match every file without literal pathspecs
    ] {
        assert_unstage_rejected(
            &fixture,
            &project,
            &["tracked.md", path],
            ErrorKind::InvalidGitPath,
        );
    }
}

#[test]
fn unstage_rejects_an_unmerged_entry() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    write(&project, "tracked.md", "side\n");
    fixture.git(&project, &["commit", "-q", "-am", "side change"]);
    fixture.git(&project, &["checkout", "-q", "-"]);
    write(&project, "tracked.md", "main\n");
    fixture.git(&project, &["commit", "-q", "-am", "main change"]);
    assert!(!fixture.git_in(&project, &["merge", "side"]));

    assert_unstage_rejected(
        &fixture,
        &project,
        &["tracked.md"],
        ErrorKind::InvalidGitPath,
    );
}

#[test]
fn unstage_of_real_files_named_like_pathspec_magic_unstages_only_those_files() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let names = ["--all", ":(glob)*", "--help"];
    // Not permitted by Windows file systems, but git and the unix file systems accept them.
    if !cfg!(unix) {
        return;
    }
    for name in names {
        write(&project, name, "content\n");
    }
    write(&project, "kept.md", "stays staged\n");
    fixture.git(&project, &["add", "-A", "--", "."]);

    unstage(&fixture, &project, &names).unwrap();

    assert_eq!(staged_names(&fixture, &project), ["kept.md"]);
}

#[test]
fn unstage_of_an_empty_list_is_a_no_op_that_returns_the_status() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    fixture.git(&project, &["add", "tracked.md"]);

    let result = unstage(&fixture, &project, &[]).unwrap();

    assert_eq!(result, fixture.status(&project));
    assert_eq!(staged_names(&fixture, &project), ["tracked.md"]);
}

#[test]
fn unstage_in_a_repository_that_is_not_ready_is_refused() {
    let fixture = fixture_or_skip!();
    let repository = fixture.repository();
    write(&repository, "nested-project/inside.md", "x");
    let plain = fixture.directory("plain");
    write(&plain, "file.md", "x");
    for root in [repository.join("nested-project"), plain] {
        let error = unstage(&fixture, &root, &["inside.md"]).unwrap_err();
        assert_eq!(error.kind, ErrorKind::GitNotReady);
    }
    assert!(!repository.join("nested-project/.git").exists());
}

#[test]
fn unstage_without_git_is_refused() {
    let project = TempDir::new();

    let error = unstage_paths(None, project.path(), &["a.md".to_owned()]).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
}

#[test]
fn unstage_ignores_git_dir_and_git_index_file_of_the_process() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let other = fixture.directory("other-repository");
    fixture.git(&other, &["init", "-q"]);
    write(&project, "new.md", "x");
    fixture.git(&project, &["add", "new.md"]);
    let other_git_dir = other.join(".git");
    let other_index = other_git_dir.join("index");

    // Same reasoning as the stage test: every git start removes these variables.
    std::env::set_var("GIT_DIR", &other_git_dir);
    std::env::set_var("GIT_INDEX_FILE", &other_index);
    let result = unstage(&fixture, &project, &["new.md"]);
    std::env::remove_var("GIT_DIR");
    std::env::remove_var("GIT_INDEX_FILE");

    let result = result.unwrap();
    assert_eq!(
        find(&result, "new.md").index_status,
        GitFileChange::Untracked
    );
    assert!(staged_names(&fixture, &project).is_empty());
}

#[cfg(unix)]
#[test]
fn unstage_reports_a_failing_git_as_command_failed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "new.md", "x");
    fixture.git(&project, &["add", "new.md"]);
    let real = fixture.executable.display().to_string();
    let directory = fixture.directory("fake-git");
    let script = directory.join("git");
    // Answers like the real git for everything except `restore`, which fails.
    write_fake_git(
        &script,
        &format!(
            "for argument in \"$@\"; do [ \"$argument\" = restore ] && {{ echo boom >&2; exit 1; }}; done\nexec '{real}' \"$@\""
        ),
    );
    let runner = fixture
        .environment
        .iter()
        .fold(GitRunner::new(script), |runner, (name, value)| {
            runner.with_environment(name, value)
        });

    let error = unstage_paths(Some(&runner), &project, &["new.md".to_owned()]).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitCommandFailed);
    assert_eq!(staged_names(&fixture, &project), ["new.md"]);
}

fn open_repository_project(
    fixture: &Fixture,
    initialise: bool,
) -> (
    App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
    Value,
) {
    let project = fixture.directory(PROJECT_DIRECTORY);
    copy_dir_all(Path::new(FIXTURE_PROJECT), &project);
    if initialise {
        fixture.git(&project, &["init", "-q"]);
    }
    let app = build_app(project, fixture.temp.path());
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("main window");
    let selection = invoke(&webview, "select_project_folder", &serde_json::json!({})).unwrap();
    let snapshot = invoke(
        &webview,
        "open_project",
        &serde_json::json!({ "selectionId": selection["selectionId"] }),
    )
    .unwrap();
    let project_id = snapshot["project"]["projectId"].clone();
    (app, webview, project_id)
}

#[test]
fn git_stage_over_ipc_returns_the_updated_status_without_absolute_paths() {
    let fixture = fixture_or_skip!();
    let (_app, webview, project_id) = open_repository_project(&fixture, true);

    let response = invoke(
        &webview,
        "git_stage",
        &serde_json::json!({ "projectId": project_id, "paths": ["project.json"] }),
    )
    .unwrap();

    assert_eq!(response["repository"]["state"], "ready");
    let staged = response["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "project.json")
        .expect("project.json is listed");
    assert_eq!(
        staged,
        &serde_json::json!({
            "path": "project.json",
            "indexStatus": "added",
            "worktreeStatus": "unmodified",
            "originalPath": null
        })
    );
    assert!(!response
        .to_string()
        .contains(fixture.temp.path().to_str().unwrap()));
}

#[test]
fn git_stage_over_ipc_reports_invalid_paths_and_a_missing_repository() {
    let fixture = fixture_or_skip!();
    let (_app, webview, project_id) = open_repository_project(&fixture, true);

    let invalid = invoke(
        &webview,
        "git_stage",
        &serde_json::json!({ "projectId": project_id, "paths": ["../escape"] }),
    );

    match invalid {
        Err(error) => {
            assert_eq!(error["kind"], "invalidGitPath");
            assert!(!error
                .to_string()
                .contains(fixture.temp.path().to_str().unwrap()));
        }
        Ok(value) => panic!("expected invalidGitPath, got {value}"),
    }
}

#[test]
fn git_stage_over_ipc_is_refused_for_a_window_that_does_not_have_the_project() {
    let fixture = fixture_or_skip!();
    let (app, _main, project_id) = open_repository_project(&fixture, true);
    let other = WebviewWindowBuilder::new(&app, SECOND_WINDOW_LABEL, Default::default())
        .build()
        .expect("second window");

    let refused = invoke(
        &other,
        "git_stage",
        &serde_json::json!({ "projectId": project_id, "paths": ["project.json"] }),
    );

    match refused {
        Err(error) => assert_eq!(error["kind"], "projectNotOpen"),
        Ok(value) => panic!("expected projectNotOpen, got {value}"),
    }
}

#[test]
fn git_unstage_over_ipc_returns_the_updated_status_without_absolute_paths() {
    let fixture = fixture_or_skip!();
    let (_app, webview, project_id) = open_repository_project(&fixture, true);
    let staged = invoke(
        &webview,
        "git_stage",
        &serde_json::json!({ "projectId": project_id, "paths": ["project.json"] }),
    )
    .unwrap();
    assert_eq!(staged["repository"]["state"], "ready");

    let response = invoke(
        &webview,
        "git_unstage",
        &serde_json::json!({ "projectId": project_id, "paths": ["project.json"] }),
    )
    .unwrap();

    assert_eq!(response["repository"]["state"], "ready");
    let file = response["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "project.json")
        .expect("project.json is listed");
    assert_eq!(
        file,
        &serde_json::json!({
            "path": "project.json",
            "indexStatus": "untracked",
            "worktreeStatus": "untracked",
            "originalPath": null
        })
    );
    assert!(!response
        .to_string()
        .contains(fixture.temp.path().to_str().unwrap()));
}

#[test]
fn git_unstage_over_ipc_reports_invalid_paths() {
    let fixture = fixture_or_skip!();
    let (_app, webview, project_id) = open_repository_project(&fixture, true);

    let invalid = invoke(
        &webview,
        "git_unstage",
        &serde_json::json!({ "projectId": project_id, "paths": ["../escape"] }),
    );

    match invalid {
        Err(error) => {
            assert_eq!(error["kind"], "invalidGitPath");
            assert!(!error
                .to_string()
                .contains(fixture.temp.path().to_str().unwrap()));
        }
        Ok(value) => panic!("expected invalidGitPath, got {value}"),
    }
}

#[test]
fn git_unstage_over_ipc_is_refused_for_a_window_that_does_not_have_the_project() {
    let fixture = fixture_or_skip!();
    let (app, _main, project_id) = open_repository_project(&fixture, true);
    let other = WebviewWindowBuilder::new(&app, SECOND_WINDOW_LABEL, Default::default())
        .build()
        .expect("second window");

    let refused = invoke(
        &other,
        "git_unstage",
        &serde_json::json!({ "projectId": project_id, "paths": ["project.json"] }),
    );

    match refused {
        Err(error) => assert_eq!(error["kind"], "projectNotOpen"),
        Ok(value) => panic!("expected projectNotOpen, got {value}"),
    }
}

/// Set while probing a freshly written fake git, which then exits at once.
#[cfg(unix)]
const FAKE_GIT_PROBE_VARIABLE: &str = "DAWN_FAKE_GIT_PROBE";
/// `ETXTBSY` on Linux.
#[cfg(unix)]
const TEXT_FILE_BUSY: i32 = 26;
#[cfg(unix)]
const PROBE_ATTEMPTS: u32 = 200;
#[cfg(unix)]
const PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);

/// Writes an executable fake git and waits until it can run. Another test thread may fork
/// while the script's write handle is open; until that child execs, running the script
/// fails with "text file busy" (which the version probe would report as a spawn failure
/// instead of an unusable git). The handle is already closed, so once one run succeeds
/// every later run does too.
#[cfg(unix)]
fn write_fake_git(script: &Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::write(
        script,
        format!("#!/bin/sh\n[ -n \"${FAKE_GIT_PROBE_VARIABLE}\" ] && exit 0\n{body}\n"),
    )
    .unwrap();
    fs::set_permissions(script, fs::Permissions::from_mode(0o755)).unwrap();
    for _ in 0..PROBE_ATTEMPTS {
        match std::process::Command::new(script)
            .env(FAKE_GIT_PROBE_VARIABLE, "1")
            .status()
        {
            Err(error) if error.raw_os_error() == Some(TEXT_FILE_BUSY) => {
                std::thread::sleep(PROBE_INTERVAL);
            }
            Ok(_) => return,
            Err(error) => panic!("fake git could not run: {error}"),
        }
    }
    panic!("fake git stayed busy");
}

// ---- Diff (`diff_path`, docs/git-development.md §11.10) ----

fn diff(
    fixture: &Fixture,
    project: &Path,
    name: &str,
    side: DiffSide,
) -> ApplicationResult<GitDiff> {
    diff_path(Some(&fixture.runner()), project, name, side)
}

fn diff_text(result: GitDiff) -> String {
    match result.outcome {
        GitDiffOutcome::Text { diff } => diff,
        other => panic!("expected a text diff, got {other:?}"),
    }
}

/// Every file below the root except `.git` with its bytes: equal before and after means the
/// working tree was not touched.
fn worktree_snapshot(directory: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn walk(directory: &Path, found: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().is_some_and(|name| name == ".git") {
                continue;
            }
            if path.is_dir() {
                walk(&path, found);
            } else {
                found.push((path.clone(), fs::read(&path).unwrap()));
            }
        }
    }
    let mut found = Vec::new();
    walk(directory, &mut found);
    found.sort();
    found
}

/// A diff call that must not change the index or the working tree, whatever its result.
fn diff_leaving_everything_unchanged(
    fixture: &Fixture,
    project: &Path,
    name: &str,
    side: DiffSide,
) -> ApplicationResult<GitDiff> {
    let index_before = index_snapshot(fixture, project);
    let worktree_before = worktree_snapshot(project);
    let result = diff(fixture, project, name, side);
    assert_eq!(index_snapshot(fixture, project), index_before, "{name}");
    assert_eq!(worktree_snapshot(project), worktree_before, "{name}");
    result
}

fn assert_diff_rejected(fixture: &Fixture, project: &Path, name: &str, side: DiffSide) {
    let error = diff_leaving_everything_unchanged(fixture, project, name, side)
        .expect_err(&format!("{name:?} was accepted"));
    assert_eq!(error.kind, ErrorKind::InvalidGitPath, "{name:?}");
}

#[test]
fn diff_of_an_unstaged_modification_is_a_text_diff() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "base\nadded line\n");

    let result =
        diff_leaving_everything_unchanged(&fixture, &project, "tracked.md", DiffSide::Unstaged)
            .unwrap();

    assert_eq!(result.path, "tracked.md");
    assert_eq!(result.side, DiffSide::Unstaged);
    let text = diff_text(result);
    assert!(text.contains("+added line"), "{text}");
    assert!(!text.contains("\u{1b}["), "no colour codes");
}

#[test]
fn diff_of_a_staged_modification_is_a_text_diff() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "base\nstaged line\n");
    fixture.git(&project, &["add", "tracked.md"]);

    let result =
        diff_leaving_everything_unchanged(&fixture, &project, "tracked.md", DiffSide::Staged)
            .unwrap();

    assert_eq!(result.side, DiffSide::Staged);
    assert!(diff_text(result).contains("+staged line"));
}

#[test]
fn a_file_staged_and_modified_again_has_a_separate_diff_per_side() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "base\nstaged line\n");
    fixture.git(&project, &["add", "tracked.md"]);
    write(&project, "tracked.md", "base\nstaged line\nworktree line\n");

    let staged = diff_text(diff(&fixture, &project, "tracked.md", DiffSide::Staged).unwrap());
    let unstaged = diff_text(diff(&fixture, &project, "tracked.md", DiffSide::Unstaged).unwrap());

    assert!(staged.contains("+staged line") && !staged.contains("worktree line"));
    assert!(unstaged.contains("+worktree line") && !unstaged.contains("+staged line"));
}

#[test]
fn diff_of_a_staged_new_file_shows_an_addition() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "new.md", "brand new\n");
    fixture.git(&project, &["add", "new.md"]);

    let text = diff_text(
        diff_leaving_everything_unchanged(&fixture, &project, "new.md", DiffSide::Staged).unwrap(),
    );

    assert!(text.contains("new file mode"), "{text}");
    assert!(text.contains("+brand new"));
}

#[test]
fn diff_of_a_staged_deletion_shows_a_removal() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["rm", "-q", "other.md"]);

    let text = diff_text(
        diff_leaving_everything_unchanged(&fixture, &project, "other.md", DiffSide::Staged)
            .unwrap(),
    );

    assert!(text.contains("deleted file mode"), "{text}");
    assert!(text.contains("-other"));
}

#[test]
fn diff_of_an_unstaged_deletion_shows_a_removal() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fs::remove_file(project.join("other.md")).unwrap();

    let text = diff_text(
        diff_leaving_everything_unchanged(&fixture, &project, "other.md", DiffSide::Unstaged)
            .unwrap(),
    );

    assert!(text.contains("deleted file mode"), "{text}");
}

#[test]
fn an_untracked_file_has_the_untracked_outcome_and_no_git_diff_is_run() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "fresh.md", "x\n");
    // A git that fails for `diff` proves that no diff process is started.
    let real = fixture.executable.display().to_string();
    let directory = fixture.directory("fake-git");
    let script = directory.join("git");
    #[cfg(unix)]
    {
        write_fake_git(
            &script,
            &format!(
                "for argument in \"$@\"; do [ \"$argument\" = diff ] && {{ echo no >&2; exit 1; }}; done\nexec '{real}' \"$@\""
            ),
        );
        let runner = fixture
            .environment
            .iter()
            .fold(GitRunner::new(script), |runner, (name, value)| {
                runner.with_environment(name, value)
            });

        let result = diff_path(Some(&runner), &project, "fresh.md", DiffSide::Unstaged).unwrap();

        assert_eq!(result.outcome, GitDiffOutcome::Untracked);
    }
    #[cfg(not(unix))]
    let _ = (real, script);
    let result = diff(&fixture, &project, "fresh.md", DiffSide::Unstaged).unwrap();
    assert_eq!(result.outcome, GitDiffOutcome::Untracked);
}

#[test]
fn the_staged_side_of_an_untracked_file_is_invalid() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "fresh.md", "x\n");

    assert_diff_rejected(&fixture, &project, "fresh.md", DiffSide::Staged);
}

#[test]
fn diff_works_for_odd_but_valid_names() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let mut names = vec![
        "設計 書.md",
        "with space.md",
        "-leading-dash.md",
        "deep/er/nested.md",
    ];
    if cfg!(unix) {
        names.extend(["a;b&c|d$e`f.md", "quote\"s.md"]);
    }
    for name in &names {
        write(&project, name, "content\n");
    }
    fixture.git(&project, &["add", "-A"]);
    fixture.git(&project, &["commit", "-q", "-m", "names"]);
    for name in &names {
        write(&project, name, "content\nchanged\n");
    }

    for name in &names {
        let text = diff_text(
            diff_leaving_everything_unchanged(&fixture, &project, name, DiffSide::Unstaged)
                .unwrap(),
        );
        assert!(text.contains("+changed"), "{name}: {text}");
    }
}

#[cfg(unix)]
#[test]
fn real_files_named_like_pathspec_magic_are_diffed_alone() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let names = ["--help", ":(exclude)x", "--all", ":(glob)*"];
    for name in names {
        write(&project, name, "one\n");
    }
    fixture.git(&project, &["add", "-A"]);
    fixture.git(&project, &["commit", "-q", "-m", "magic"]);
    for name in names {
        write(&project, name, &format!("one\nchanged {name}\n"));
    }
    write(&project, "tracked.md", "base\nbystander\n");

    for name in names {
        let text = diff_text(diff(&fixture, &project, name, DiffSide::Unstaged).unwrap());
        assert!(text.contains(&format!("+changed {name}")), "{name}: {text}");
        assert!(!text.contains("bystander"), "{name}");
        assert_eq!(text.matches("diff --git").count(), 1, "{name}");
    }
}

#[test]
fn a_staged_rename_is_shown_as_a_rename_pair() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["mv", "tracked.md", "renamed.md"]);

    let text = diff_text(
        diff_leaving_everything_unchanged(&fixture, &project, "renamed.md", DiffSide::Staged)
            .unwrap(),
    );

    assert!(text.contains("rename from tracked.md"), "{text}");
    assert!(text.contains("rename to renamed.md"), "{text}");
}

#[test]
fn an_unchanged_file_and_unknown_names_are_invalid() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "documents/a.md", "x");
    write(&project, "tracked.md", "changed\n");

    for side in [DiffSide::Unstaged, DiffSide::Staged] {
        assert_diff_rejected(&fixture, &project, "other.md", side);
        assert_diff_rejected(&fixture, &project, "missing.md", side);
        assert_diff_rejected(&fixture, &project, "documents", side);
        for pattern in ["--all", "--help", ":(exclude)x", ":(glob)*", "*", "*.md"] {
            assert_diff_rejected(&fixture, &project, pattern, side);
        }
    }
    // Changed on the other side only.
    assert_diff_rejected(&fixture, &project, "tracked.md", DiffSide::Staged);
}

#[test]
fn the_empty_and_oversized_outcomes_follow_git_s_own_output() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");

    // The status lists the change but git's diff is empty (a timestamp-only change cannot
    // be produced deterministically, so git is replaced for the text call only).
    let empty = diff_with_fake_text_output(&fixture, &project, "exit 0");
    assert_eq!(empty.outcome, GitDiffOutcome::Empty);

    let at_limit = diff_with_fake_text_output(
        &fixture,
        &project,
        &format!("head -c {DIFF_OUTPUT_LIMIT_BYTES} /dev/zero"),
    );
    assert!(matches!(at_limit.outcome, GitDiffOutcome::Text { .. }));

    let over_limit = diff_with_fake_text_output(
        &fixture,
        &project,
        &format!("head -c {} /dev/zero", DIFF_OUTPUT_LIMIT_BYTES + 1),
    );
    assert_eq!(
        over_limit.outcome,
        GitDiffOutcome::TooLarge {
            limit_bytes: DIFF_OUTPUT_LIMIT_BYTES
        }
    );
}

/// Real git for everything except the text `diff` call (the one without `--numstat`),
/// which runs `text_script` instead.
#[cfg(unix)]
fn diff_with_fake_text_output(fixture: &Fixture, project: &Path, text_script: &str) -> GitDiff {
    let real = fixture.executable.display().to_string();
    let directory = fixture.directory(&format!("fake-git-{}", text_script.len()));
    let script = directory.join("git");
    write_fake_git(
        &script,
        &format!(
            "is_diff=0\nfor argument in \"$@\"; do\n  [ \"$argument\" = --numstat ] && exec '{real}' \"$@\"\n  [ \"$argument\" = diff ] && is_diff=1\ndone\n[ $is_diff = 1 ] && {{ {text_script}; exit 0; }}\nexec '{real}' \"$@\""
        ),
    );
    let runner = fixture
        .environment
        .iter()
        .fold(GitRunner::new(script), |runner, (name, value)| {
            runner.with_environment(name, value)
        });
    diff_path(Some(&runner), project, "tracked.md", DiffSide::Unstaged).unwrap()
}

#[cfg(not(unix))]
fn diff_with_fake_text_output(_: &Fixture, _: &Path, _: &str) -> GitDiff {
    GitDiff {
        path: String::new(),
        side: DiffSide::Unstaged,
        outcome: GitDiffOutcome::Empty,
    }
}

#[test]
fn a_binary_file_has_the_binary_outcome_and_no_content() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fs::write(project.join("image.bin"), [0_u8, 1, 2, 3, 0, 255]).unwrap();
    fixture.git(&project, &["add", "image.bin"]);
    fixture.git(&project, &["commit", "-q", "-m", "binary"]);
    fs::write(project.join("image.bin"), [0_u8, 9, 9, 0, 0, 1, 2]).unwrap();

    let unstaged =
        diff_leaving_everything_unchanged(&fixture, &project, "image.bin", DiffSide::Unstaged)
            .unwrap();
    fixture.git(&project, &["add", "image.bin"]);
    let staged =
        diff_leaving_everything_unchanged(&fixture, &project, "image.bin", DiffSide::Staged)
            .unwrap();

    assert_eq!(unstaged.outcome, GitDiffOutcome::Binary);
    assert_eq!(staged.outcome, GitDiffOutcome::Binary);
}

#[test]
fn text_that_is_not_utf8_has_the_not_utf8_outcome() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    // Shift_JIS bytes for Japanese text, without any NUL byte, so git treats it as text.
    let shift_jis = [0x93_u8, 0xFA, 0x96, 0x7B, 0x8C, 0xEA, b'\n'];
    fs::write(project.join("tracked.md"), shift_jis).unwrap();

    let result =
        diff_leaving_everything_unchanged(&fixture, &project, "tracked.md", DiffSide::Unstaged)
            .unwrap();

    assert_eq!(result.outcome, GitDiffOutcome::NotUtf8);
}

#[test]
fn a_diff_over_the_limit_is_too_large_without_content() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let large: String = (0..300_000)
        .map(|number| format!("line {number}\n"))
        .collect();
    assert!(large.len() > DIFF_OUTPUT_LIMIT_BYTES * 2);
    write(&project, "tracked.md", &large);

    let result =
        diff_leaving_everything_unchanged(&fixture, &project, "tracked.md", DiffSide::Unstaged)
            .unwrap();

    assert_eq!(
        result.outcome,
        GitDiffOutcome::TooLarge {
            limit_bytes: DIFF_OUTPUT_LIMIT_BYTES
        }
    );
}

#[test]
fn diff_in_a_repository_that_is_not_ready_is_refused() {
    let fixture = fixture_or_skip!();
    let repository = fixture.repository();
    write(&repository, "nested-project/inside.md", "x");
    let plain = fixture.directory("plain");
    write(&plain, "file.md", "x");

    for root in [repository.join("nested-project"), plain] {
        let error = diff(&fixture, &root, "inside.md", DiffSide::Unstaged).unwrap_err();
        assert_eq!(error.kind, ErrorKind::GitNotReady);
    }
    let error = diff_path(None, repository.as_path(), "a.md", DiffSide::Staged).unwrap_err();
    assert_eq!(error.kind, ErrorKind::GitNotReady);
}

#[cfg(unix)]
#[test]
fn diff_with_an_unusable_git_version_is_refused() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    let directory = fixture.directory("old-git");
    let script = directory.join("git");
    write_fake_git(&script, "echo 'git version 2.24.9'");

    let error = diff_path(
        Some(&GitRunner::new(script)),
        &project,
        "tracked.md",
        DiffSide::Unstaged,
    )
    .unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
}

#[test]
fn diff_ignores_git_dir_and_git_index_file_of_the_process() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "base\nin project\n");
    let other = fixture.directory("other-repository");
    fixture.git(&other, &["init", "-q"]);
    write(&other, "decoy.md", "x");
    let other_git_dir = other.join(".git");
    let other_index = other_git_dir.join("index");

    std::env::set_var("GIT_DIR", &other_git_dir);
    std::env::set_var("GIT_INDEX_FILE", &other_index);
    let result = diff(&fixture, &project, "tracked.md", DiffSide::Unstaged);
    std::env::remove_var("GIT_DIR");
    std::env::remove_var("GIT_INDEX_FILE");

    assert!(diff_text(result.unwrap()).contains("+in project"));
}

#[test]
fn diff_rejects_the_invalid_path_table() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    write(&project, "tracked.md", "changed\n");
    write(&project, "documents/a.md", "x");
    for path in [
        "",
        ".",
        "..",
        "../foo",
        "..\\foo",
        "/foo",
        "\\foo",
        "C:\\foo",
        "C:/foo",
        "D:/foo",
        "\\\\server\\share",
        "\\\\?\\C:\\x",
        "foo/../bar",
        "documents/",
    ] {
        for side in [DiffSide::Unstaged, DiffSide::Staged] {
            assert_diff_rejected(&fixture, &project, path, side);
        }
    }
}

#[test]
fn diff_of_an_unmerged_file_is_invalid_on_both_sides() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    write(&project, "tracked.md", "side\n");
    fixture.git(&project, &["commit", "-q", "-am", "side change"]);
    fixture.git(&project, &["checkout", "-q", "-"]);
    write(&project, "tracked.md", "main\n");
    fixture.git(&project, &["commit", "-q", "-am", "main change"]);
    assert!(!fixture.git_in(&project, &["merge", "side"]));

    assert_diff_rejected(&fixture, &project, "tracked.md", DiffSide::Unstaged);
    assert_diff_rejected(&fixture, &project, "tracked.md", DiffSide::Staged);
}

#[cfg(unix)]
#[test]
fn textconv_and_external_diff_programs_are_never_run() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository();
    let markers = fixture.directory("markers");
    let textconv_marker = markers.join("textconv-ran");
    let external_marker = markers.join("external-ran");
    write(&project, ".gitattributes", "*.md diff=marker\n");
    fixture.git(
        &project,
        &[
            "config",
            "diff.marker.textconv",
            &format!("touch '{}'; cat", textconv_marker.display()),
        ],
    );
    fixture.git(
        &project,
        &[
            "config",
            "diff.external",
            &format!("touch '{}'; true", external_marker.display()),
        ],
    );
    write(&project, "tracked.md", "base\nchanged\n");
    fixture.git(&project, &["add", "tracked.md"]);
    write(&project, "other.md", "other\nchanged\n");

    // Sanity: a plain `git diff` does run both, so the markers prove something.
    fixture.git(&project, &["diff", "--", "other.md"]);
    assert!(
        external_marker.exists(),
        "the configuration would run the external diff"
    );
    fixture.git(&project, &["diff", "--no-ext-diff", "--", "other.md"]);
    assert!(
        textconv_marker.exists(),
        "the configuration would run textconv"
    );
    fs::remove_file(&external_marker).unwrap();
    fs::remove_file(&textconv_marker).unwrap();

    let staged = diff(&fixture, &project, "tracked.md", DiffSide::Staged).unwrap();
    let unstaged = diff(&fixture, &project, "other.md", DiffSide::Unstaged).unwrap();

    assert!(diff_text(staged).contains("+changed"));
    assert!(diff_text(unstaged).contains("+changed"));
    assert!(!textconv_marker.exists());
    assert!(!external_marker.exists());
}

#[test]
fn the_wire_form_has_an_outcome_tag_and_camel_case_fields() {
    let cases = [
        (
            GitDiffOutcome::Text {
                diff: "d".to_owned(),
            },
            serde_json::json!({"path": "a.md", "side": "unstaged", "outcome": "text", "diff": "d"}),
        ),
        (
            GitDiffOutcome::Empty,
            serde_json::json!({"path": "a.md", "side": "unstaged", "outcome": "empty"}),
        ),
        (
            GitDiffOutcome::Untracked,
            serde_json::json!({"path": "a.md", "side": "unstaged", "outcome": "untracked"}),
        ),
        (
            GitDiffOutcome::Binary,
            serde_json::json!({"path": "a.md", "side": "unstaged", "outcome": "binary"}),
        ),
        (
            GitDiffOutcome::TooLarge { limit_bytes: 7 },
            serde_json::json!({"path": "a.md", "side": "unstaged", "outcome": "tooLarge", "limitBytes": 7}),
        ),
        (
            GitDiffOutcome::NotUtf8,
            serde_json::json!({"path": "a.md", "side": "unstaged", "outcome": "notUtf8"}),
        ),
    ];
    for (outcome, expected) in cases {
        let diff = GitDiff {
            path: "a.md".to_owned(),
            side: DiffSide::Unstaged,
            outcome,
        };
        assert_eq!(serde_json::to_value(diff).unwrap(), expected);
    }
    assert_eq!(serde_json::to_value(DiffSide::Staged).unwrap(), "staged");
}
