//! Byte-stability of load -> save, and the atomic write primitives.

mod support;

use std::fs;

use design_dawn_lib::application::block_content_operations::{
    read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::{load_document, save_document};
use design_dawn_lib::application::project_operations::{open_project, save_project};
use design_dawn_lib::application::sheet_operations::save_sheet;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::filesystem::atomic_write::{
    create_new_file, write_atomic, WriteOutcome,
};
use support::*;

#[test]
fn opening_and_loading_the_sample_project_reports_no_issues_and_writes_nothing() {
    let mut opened = open_copy();
    let before = tree_snapshot(&opened.root);
    assert!(
        opened.snapshot.issues.is_empty(),
        "{:?}",
        opened.snapshot.issues
    );
    let document = load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    assert!(document.issues.is_empty(), "{:?}", document.issues);
    assert_eq!(document.sheets.len(), 2);
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn saving_everything_that_was_loaded_leaves_every_file_byte_identical() {
    let mut opened = open_copy();
    let first = save_project(&mut opened.sessions, PROJECT_ID, &opened.snapshot.project).unwrap();
    assert!(
        !first.written,
        "the basic sample is in the current format; a schemaVersion 1 sample is covered by schema_migration.rs"
    );
    let before = tree_snapshot(&opened.root);

    let saved = save_project(&mut opened.sessions, PROJECT_ID, &opened.snapshot.project).unwrap();
    assert!(!saved.written, "project.json must not be rewritten");

    let document = load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let saved = save_document(&mut opened.sessions, PROJECT_ID, &document.document).unwrap();
    assert!(!saved.written, "document.json must not be rewritten");

    for entry in &document.sheets {
        let sheet = entry.sheet.as_ref().expect("sheet loaded");
        let saved = save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, sheet).unwrap();
        assert!(!saved.written, "{} must not be rewritten", entry.sheet_id);
        for block in &sheet.blocks {
            if block.block_type == "image" {
                continue;
            }
            let text = read_block_content(
                &mut opened.sessions,
                PROJECT_ID,
                DOCUMENT_ID,
                &block.content_path,
            )
            .unwrap();
            let saved = write_block_content(
                &mut opened.sessions,
                PROJECT_ID,
                DOCUMENT_ID,
                &block.content_path,
                &text,
            )
            .unwrap();
            assert!(
                !saved.written,
                "{} must not be rewritten",
                block.content_path
            );
        }
    }
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn saving_a_changed_entity_replaces_the_file_and_leaves_no_temp_file() {
    let mut opened = open_copy();
    let mut project = opened.snapshot.project.clone();
    project.name = "Renamed".to_owned();
    let saved = save_project(&mut opened.sessions, PROJECT_ID, &project).unwrap();
    assert!(saved.written);

    assert!(read_text(&opened.root.join("project.json")).contains("\"name\": \"Renamed\""));
    assert!(tree_snapshot(&opened.root)
        .keys()
        .all(|path| !path.ends_with(".dawn-tmp")));

    let reopened = open_project(&mut opened.sessions, &opened.root).unwrap();
    assert_eq!(reopened.project.name, "Renamed");
}

#[test]
fn atomic_write_replaces_content_reuses_a_stale_temp_and_skips_identical_bytes() {
    let temp = TempDir::new();
    let target = temp.path().join("file.json");
    fs::write(&target, b"old").unwrap();
    let stale_temp = temp.path().join(".file.json.dawn-tmp");
    fs::write(
        &stale_temp,
        b"garbage left by a crash, longer than the new content",
    )
    .unwrap();

    assert_eq!(
        write_atomic(&target, b"new").unwrap(),
        WriteOutcome::Written
    );
    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert!(!stale_temp.exists());

    assert_eq!(
        write_atomic(&target, b"new").unwrap(),
        WriteOutcome::Unchanged
    );
    assert!(!stale_temp.exists());
}

// A cloned repository may contain a symlink named like our temp file; writing through it
// would modify a file outside the Project.
#[cfg(unix)]
#[test]
fn atomic_write_never_writes_through_a_planted_temp_symlink() {
    let temp = TempDir::new();
    let project = temp.path().join("project");
    let outside = temp.path().join("outside.txt");
    fs::create_dir(&project).unwrap();
    fs::write(&outside, b"do not touch").unwrap();
    let target = project.join("sheet.json");
    fs::write(&target, b"old").unwrap();
    std::os::unix::fs::symlink(&outside, project.join(".sheet.json.dawn-tmp")).unwrap();

    assert_eq!(
        write_atomic(&target, b"new").unwrap(),
        WriteOutcome::Written
    );
    assert_eq!(fs::read(&outside).unwrap(), b"do not touch");
    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert!(fs::symlink_metadata(&target).unwrap().file_type().is_file());
    assert!(fs::symlink_metadata(project.join(".sheet.json.dawn-tmp")).is_err());
}

#[test]
fn a_failed_atomic_write_removes_its_temp_file_and_keeps_the_target() {
    let temp = TempDir::new();
    // Renaming a file over a non-empty directory fails, which exercises the cleanup path.
    let target = temp.path().join("occupied");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("inner.txt"), b"keep me").unwrap();

    let error = write_atomic(&target, b"data").unwrap_err();
    assert_eq!(error.kind, PersistenceErrorKind::IoError);
    assert!(!temp.path().join(".occupied.dawn-tmp").exists());
    assert_eq!(fs::read(target.join("inner.txt")).unwrap(), b"keep me");
}

#[test]
fn create_new_file_never_overwrites() {
    let temp = TempDir::new();
    let target = temp.path().join("new.md");
    create_new_file(&target, b"first").unwrap();
    let error = create_new_file(&target, b"second").unwrap_err();
    assert_eq!(error.kind, PersistenceErrorKind::AlreadyExists);
    assert_eq!(fs::read(&target).unwrap(), b"first");
}
