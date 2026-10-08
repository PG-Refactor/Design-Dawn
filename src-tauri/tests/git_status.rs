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
    read_git_status, stage_paths, GitFileChange, GitFileStatus, GitRepositoryState, GitStatusResult,
};
use design_dawn_lib::application::local_state::operations::{LocalState, LocalStateDirectories};
use design_dawn_lib::commands::SharedFolderPicker;
use design_dawn_lib::infrastructure::git::constants::GIT_COMMAND_TIMEOUT;
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
