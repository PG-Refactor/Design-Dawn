//! Shared helpers for the persistence integration tests. Every test works on a copy of
//! `fixtures/projects/basic` in a unique temporary directory; repository fixtures are never
//! modified.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use design_dawn_lib::application::load_issue::{LoadIssue, LoadIssueKind};
use design_dawn_lib::application::project_operations::open_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::snapshot::ProjectSnapshot;
use uuid::Uuid;

pub const FIXTURE_PROJECT: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/projects/basic");

pub const PROJECT_ID: &str = "01928f3a-5b6c-7d8e-9f01-23456789abcd";
pub const DOCUMENT_ID: &str = "01928f3a-6c7d-7e8f-a012-3456789abcde";
pub const OVERVIEW_SHEET_ID: &str = "01928f3a-7d8e-7f90-b123-456789abcdef";
pub const DETAILS_SHEET_ID: &str = "01928f3a-7d8f-7f90-b123-456789abcdef";
pub const OVERVIEW_MARKDOWN_BLOCK_ID: &str = "01928f3a-8e9f-7a01-8234-56789abcdef0";
pub const DETAILS_MARKDOWN_BLOCK_ID: &str = "01928f3a-b1c2-7d34-b567-89abcdef0123";
/// A valid UUIDv7 that no fixture uses.
pub const UNKNOWN_ID: &str = "01928f3a-ffff-7fff-bfff-ffffffffffff";

pub const OVERVIEW_MARKDOWN_PATH: &str = "sheets/overview/blocks/markdown-1.md";
pub const OVERVIEW_MERMAID_PATH: &str = "sheets/overview/blocks/mermaid-1.mmd";
pub const DETAILS_MARKDOWN_PATH: &str = "sheets/details/blocks/markdown-1.md";

/// Removes its directory on drop so failed tests do not leave artifacts behind.
pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!("design-dawn-test-{}", Uuid::now_v7()));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub fn copy_dir_all(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("create destination");
    for entry in fs::read_dir(from).expect("read source") {
        let entry = entry.expect("entry");
        let destination = to.join(entry.file_name());
        if entry.file_type().expect("file type").is_dir() {
            copy_dir_all(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).expect("copy file");
        }
    }
}

/// A fresh copy of the sample project. Keep the `TempDir` alive for the whole test.
pub fn project_copy() -> (TempDir, PathBuf) {
    let temp = TempDir::new();
    let root = temp.path().join("project");
    copy_dir_all(Path::new(FIXTURE_PROJECT), &root);
    (temp, root)
}

pub struct OpenedProject {
    pub temp: TempDir,
    pub root: PathBuf,
    pub sessions: ProjectSessions,
    pub snapshot: ProjectSnapshot,
}

pub fn open_copy() -> OpenedProject {
    let (temp, root) = project_copy();
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, &root).expect("open sample project");
    OpenedProject {
        temp,
        root,
        sessions,
        snapshot,
    }
}

pub fn document_dir(root: &Path) -> PathBuf {
    root.join("documents").join("system-design")
}

pub fn sheet_dir(root: &Path, name: &str) -> PathBuf {
    document_dir(root).join("sheets").join(name)
}

/// Every file (content) and directory (`None`) below `root`, for before/after comparisons.
pub fn tree_snapshot(root: &Path) -> BTreeMap<String, Option<Vec<u8>>> {
    fn walk(base: &Path, directory: &Path, out: &mut BTreeMap<String, Option<Vec<u8>>>) {
        for entry in fs::read_dir(directory).expect("read dir") {
            let entry = entry.expect("entry");
            let path = entry.path();
            let key = path
                .strip_prefix(base)
                .expect("inside base")
                .to_string_lossy()
                .replace('\\', "/");
            if entry.file_type().expect("file type").is_dir() {
                out.insert(key, None);
                walk(base, &path, out);
            } else {
                out.insert(key, Some(fs::read(&path).expect("read file")));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

pub fn read_text(path: &Path) -> String {
    fs::read_to_string(path).expect("read text")
}

pub fn write_text(path: &Path, text: &str) {
    fs::write(path, text).expect("write text");
}

pub fn issues_of_kind(issues: &[LoadIssue], kind: LoadIssueKind) -> Vec<&LoadIssue> {
    issues.iter().filter(|issue| issue.kind == kind).collect()
}

/// Replaces `from` with `to` in a file, failing loudly if the text is not there.
pub fn replace_in_file(path: &Path, from: &str, to: &str) {
    let text = read_text(path);
    assert!(
        text.contains(from),
        "{from:?} not found in {}",
        path.display()
    );
    write_text(path, &text.replace(from, to));
}

pub fn write_json(path: &Path, value: &serde_json::Value) {
    let mut text = serde_json::to_string_pretty(value).expect("serialize");
    text.push('\n');
    write_text(path, &text);
}

pub fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_str(&read_text(path)).expect("valid json")
}
