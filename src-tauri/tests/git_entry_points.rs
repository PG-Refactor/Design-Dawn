//! The git commands the app calls take a Project id and find `git` themselves. Against an
//! opened Project that is not a Git repository they refuse without running anything, and an
//! id with no opened Project is refused before any git is looked for. No network, no
//! repository is touched.

mod support;

use std::sync::Mutex;

use design_dawn_lib::application::error::{ApplicationError, ErrorKind};
use design_dawn_lib::application::git_commit::git_abort_merge;
use design_dawn_lib::application::git_conflict::{
    git_conflict_versions, git_resolve_conflict, git_resolve_conflict_with_side, ConflictSide,
};
use design_dawn_lib::application::git_operations::{enable_git_long_paths, DiffSide};
use design_dawn_lib::application::git_remote::{
    git_fetch, git_publish, git_pull, git_push, git_remotes,
};
use design_dawn_lib::application::git_sheet_versions::git_sheet_versions;
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use support::*;

const UNKNOWN_PROJECT_ID: &str = "01928f3a-aaaa-7bbb-8ccc-0123456789ab";
const PATH: &str = "documents/a/document.json";

type Call = fn(
    &Mutex<design_dawn_lib::application::session::ProjectSessions>,
    &str,
) -> Result<(), ApplicationError>;

fn calls() -> Vec<(&'static str, Call)> {
    vec![
        ("fetch", |s, id| git_fetch(s, id).map(drop)),
        ("pull", |s, id| git_pull(s, id).map(drop)),
        ("push", |s, id| git_push(s, id).map(drop)),
        ("publish", |s, id| git_publish(s, id, "origin").map(drop)),
        ("remotes", |s, id| git_remotes(s, id).map(drop)),
        ("abort merge", |s, id| git_abort_merge(s, id).map(drop)),
        ("conflict versions", |s, id| {
            git_conflict_versions(s, id, PATH).map(drop)
        }),
        ("resolve", |s, id| {
            git_resolve_conflict(s, id, PATH, "x").map(drop)
        }),
        ("resolve with side", |s, id| {
            git_resolve_conflict_with_side(s, id, PATH, ConflictSide::Ours).map(drop)
        }),
        ("sheet versions", |s, id| {
            git_sheet_versions(s, id, PATH, DiffSide::Staged).map(drop)
        }),
    ]
}

#[test]
fn every_git_command_refuses_a_project_that_is_not_open() {
    let opened = open_copy();
    let sessions = Mutex::new(opened.sessions);
    for (name, call) in calls() {
        assert!(call(&sessions, UNKNOWN_PROJECT_ID).is_err(), "{name}");
    }
    assert!(enable_git_long_paths(&sessions, UNKNOWN_PROJECT_ID).is_err());
}

#[test]
fn every_git_command_refuses_a_project_that_is_not_a_repository() {
    if find_git_executable().is_none() {
        eprintln!("SKIPPED: git was not found on PATH");
        return;
    }
    let opened = open_copy();
    let project_id = opened.snapshot.project.project_id.clone();
    let sessions = Mutex::new(opened.sessions);
    for (name, call) in calls() {
        let error = call(&sessions, &project_id).expect_err(name);
        assert_eq!(error.kind, ErrorKind::GitNotReady, "{name}");
    }
    let error = enable_git_long_paths(&sessions, &project_id).unwrap_err();
    assert_eq!(error.kind, ErrorKind::GitCommandFailed);
}
