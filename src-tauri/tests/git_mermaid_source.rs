//! A Mermaid source (`.mmd`) saved through `write_block_content` is an ordinary changed text
//! file for Git: listed by `read_git_status`, a line diff in `diff_path`, and brought back
//! by `discard_paths` (docs/testing.md §28, docs/architecture.md §15). Discard works per
//! file; there is no per-block restore. Runs against the system `git` in a temporary
//! repository with a hermetic configuration, and is skipped, with a message, when no `git`
//! is installed.

mod support;

use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::process::Command;

use design_dawn_lib::application::block_content_operations::{
    read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::load_document;
use design_dawn_lib::application::git_discard::discard_paths;
use design_dawn_lib::application::git_operations::{
    diff_path, read_git_status, DiffSide, GitDiffOutcome, GitFileChange, GitRepositoryState,
};
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use support::*;

const HOME_DIRECTORY: &str = "home";
const EMPTY_CONFIG_FILE: &str = "empty-gitconfig";
const AUTHOR_NAME: &str = "Design Dawn Test";
const AUTHOR_EMAIL: &str = "test@example.invalid";
const MERMAID_GIT_PATH: &str = "documents/system-design/sheets/overview/blocks/mermaid-1.mmd";
const EDITED_SOURCE: &str = "flowchart TD\r\n  A[Start] --> B[End]\r\n  B --> C[Added]";

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

fn git(executable: &Path, environment: &[(OsString, OsString)], directory: &Path, args: &[&str]) {
    let mut command = Command::new(executable);
    command.args(args).current_dir(directory);
    for (name, value) in environment {
        command.env(name, value);
    }
    for name in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] {
        command.env_remove(name);
    }
    let output = command.output().expect("run git");
    assert!(output.status.success(), "git {args:?} failed");
}

#[test]
fn a_saved_mermaid_source_is_a_modified_file_with_a_text_diff_and_discard_restores_it() {
    let Some(executable) = find_git_executable() else {
        eprintln!("SKIPPED: git was not found on PATH");
        return;
    };
    let mut opened = open_copy();
    let environment = hermetic_environment(opened.temp.path());
    let root = opened.root.clone();
    git(&executable, &environment, &root, &["init", "-q"]);
    git(
        &executable,
        &environment,
        &root,
        &["config", "user.name", AUTHOR_NAME],
    );
    git(
        &executable,
        &environment,
        &root,
        &["config", "user.email", AUTHOR_EMAIL],
    );
    git(&executable, &environment, &root, &["add", "-A"]);
    git(
        &executable,
        &environment,
        &root,
        &["commit", "-q", "-m", "initial"],
    );
    let runner = environment.iter().fold(
        GitRunner::new(executable.clone()),
        |runner, (name, value)| runner.with_environment(name, value),
    );

    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let original = read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MERMAID_PATH,
    )
    .unwrap();
    assert!(read_git_status(Some(&runner), &root)
        .unwrap()
        .files
        .is_empty());

    let saved = write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MERMAID_PATH,
        EDITED_SOURCE,
    )
    .unwrap();
    assert!(saved.written);

    // Git lists exactly the `.mmd` file as modified in the work tree.
    let status = read_git_status(Some(&runner), &root).unwrap();
    assert_eq!(status.repository.state, GitRepositoryState::Ready);
    assert_eq!(status.files.len(), 1, "{:?}", status.files);
    assert_eq!(status.files[0].path, MERMAID_GIT_PATH);
    assert_eq!(status.files[0].worktree_status, GitFileChange::Modified);
    assert_eq!(status.files[0].index_status, GitFileChange::Unmodified);

    // The diff is a line diff of the (LF-normalised) source.
    let diff = diff_path(Some(&runner), &root, MERMAID_GIT_PATH, DiffSide::Unstaged).unwrap();
    match diff.outcome {
        GitDiffOutcome::Text { diff } => {
            assert!(diff.contains("+  B --> C[Added]"), "{diff}");
            assert!(!diff.contains('\r'), "{diff}");
        }
        other => panic!("expected a text diff, got {other:?}"),
    }

    // Discard is per file: the whole `.mmd` goes back to the committed text.
    let after = discard_paths(Some(&runner), &root, &[MERMAID_GIT_PATH.to_owned()]).unwrap();
    assert!(after.files.is_empty(), "{:?}", after.files);

    // The application reopens the Document after a discard (git-discard-flow.ts); the same
    // here, then the committed source is read back.
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let restored = read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MERMAID_PATH,
    )
    .unwrap();
    assert_eq!(restored, original);
}
