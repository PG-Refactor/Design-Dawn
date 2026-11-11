//! Resolving merge conflicts: the three versions of a conflicted file, the Block-by-Block
//! merge of sheet.json, and resolving by writing a text and staging it. Runs the real git in
//! a hermetic environment (skipped when git is missing).

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
use design_dawn_lib::application::git_conflict::{read_conflict_versions, resolve_conflict};
use design_dawn_lib::application::git_operations::GitFileChange;
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use support::TempDir;

struct Repository {
    _temp: TempDir,
    root: PathBuf,
    executable: PathBuf,
    environment: Vec<(OsString, OsString)>,
}

impl Repository {
    fn new() -> Option<Self> {
        let Some(executable) = find_git_executable() else {
            eprintln!("SKIPPED: git was not found on PATH");
            return None;
        };
        let temp = TempDir::new();
        let home = temp.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let config = temp.path().join("empty-gitconfig");
        fs::write(&config, "").unwrap();
        let environment = [
            ("HOME", home.clone().into_os_string()),
            ("XDG_CONFIG_HOME", home.into_os_string()),
            ("GIT_CONFIG_GLOBAL", config.clone().into_os_string()),
            ("GIT_CONFIG_SYSTEM", config.into_os_string()),
            ("GIT_CONFIG_NOSYSTEM", OsString::from("1")),
        ]
        .into_iter()
        .map(|(name, value)| (OsString::from(name), value))
        .collect();
        let root = temp.path().join("project");
        fs::create_dir_all(&root).unwrap();
        let repository = Self {
            _temp: temp,
            root,
            executable,
            environment,
        };
        repository.git(&["init", "-q", "-b", "main"]);
        repository.git(&["config", "user.name", "Test"]);
        repository.git(&["config", "user.email", "test@example.invalid"]);
        Some(repository)
    }

    fn git_ok(&self, arguments: &[&str]) -> bool {
        let mut command = Command::new(&self.executable);
        command.args(arguments).current_dir(&self.root);
        for (name, value) in &self.environment {
            command.env(name, value);
        }
        command.output().expect("run git").status.success()
    }

    fn git(&self, arguments: &[&str]) {
        assert!(self.git_ok(arguments), "git {arguments:?} failed");
    }

    fn runner(&self) -> GitRunner {
        self.environment.iter().fold(
            GitRunner::new(self.executable.clone()),
            |runner, (name, value)| runner.with_environment(name, value),
        )
    }

    fn write(&self, path: &str, text: &str) {
        let file = self.root.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    }

    fn commit(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
    }

    /// `path` changed to `ours` on main and to `theirs` on a branch, then merged: conflict.
    fn conflict(&self, path: &str, base: &str, ours: &str, theirs: &str) {
        self.write(path, base);
        self.commit("base");
        self.git(&["checkout", "-q", "-b", "other"]);
        self.write(path, theirs);
        self.commit("theirs");
        self.git(&["checkout", "-q", "main"]);
        self.write(path, ours);
        self.commit("ours");
        assert!(
            !self.git_ok(&["merge", "-q", "other"]),
            "a conflict is expected"
        );
    }
}

fn root_of(repository: &Repository) -> &Path {
    &repository.root
}

const SHEET: &str = "documents/d/sheets/s/sheet.json";

fn block(id: &str, x: i64) -> String {
    format!(
        r#"{{"blockId":"{id}","blockType":"markdown","position":{{"x":{x},"y":0}},"size":{{"width":100,"height":50}},"contentPath":"sheets/s/blocks/markdown-{x}.md"}}"#
    )
}

fn sheet(blocks: &[String]) -> String {
    // One Block per line, so moving two different Blocks still conflicts as text.
    format!(
        "{{\"schemaVersion\":2,\"sheetId\":\"01928f3a-7d8e-7f90-b123-456789abcdef\",\"name\":\"S\",\"blocks\":[\n{}\n]}}\n",
        blocks.join(",\n")
    )
}

const A: &str = "01928f3a-0000-7000-8000-00000000000a";
const B: &str = "01928f3a-0000-7000-8000-00000000000b";

#[test]
fn a_conflicted_markdown_file_shows_three_versions_and_is_resolved_by_staging() {
    let Some(repository) = Repository::new() else {
        return;
    };
    let path = "documents/d/sheets/s/blocks/markdown-1.md";
    repository.conflict(path, "base\n", "ours\n", "theirs\n");
    let runner = repository.runner();
    let versions = read_conflict_versions(Some(&runner), root_of(&repository), path).unwrap();
    assert_eq!(versions.base.as_deref(), Some("base\n"));
    assert_eq!(versions.ours.as_deref(), Some("ours\n"));
    assert_eq!(versions.theirs.as_deref(), Some("theirs\n"));
    assert!(versions.current.unwrap().contains("<<<<<<<"));
    assert_eq!(versions.merged, None);

    let status = resolve_conflict(Some(&runner), root_of(&repository), path, "both\n").unwrap();
    assert_eq!(
        fs::read_to_string(repository.root.join(path)).unwrap(),
        "both\n"
    );
    let file = status.files.iter().find(|file| file.path == path).unwrap();
    assert_ne!(file.worktree_status, GitFileChange::Unmerged);
    assert_ne!(file.index_status, GitFileChange::Unmerged);
}

#[test]
fn a_sheet_with_different_blocks_moved_merges_block_by_block() {
    let Some(repository) = Repository::new() else {
        return;
    };
    repository.conflict(
        SHEET,
        &sheet(&[block(A, 1), block(B, 2)]),
        &sheet(&[block(A, 10), block(B, 2)]),
        &sheet(&[block(A, 1), block(B, 20)]),
    );
    let versions =
        read_conflict_versions(Some(&repository.runner()), root_of(&repository), SHEET).unwrap();
    let merged = versions.merged.expect("a structural merge");
    assert!(merged.contains("\"x\": 10") && merged.contains("\"x\": 20"));
    assert!(versions.conflicting_blocks.is_empty());
}

#[test]
fn a_path_that_is_not_conflicted_is_refused() {
    let Some(repository) = Repository::new() else {
        return;
    };
    repository.write("a.md", "a\n");
    repository.commit("a");
    let error = read_conflict_versions(Some(&repository.runner()), root_of(&repository), "a.md")
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidGitPath);
    let escape = resolve_conflict(
        Some(&repository.runner()),
        root_of(&repository),
        "../x",
        "x",
    )
    .unwrap_err();
    assert_eq!(escape.kind, ErrorKind::InvalidGitPath);
}
