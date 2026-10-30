//! The migration registry end to end:
//! an older file is read as the current shape, loading never rewrites it, it is written in
//! the current version only by its next save or by "update all", and a newer file is never
//! written at all.

mod support;

use std::fs;

use design_dawn_lib::application::document_operations::{load_document, save_document};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::format_update::{list_outdated_files, update_outdated_files};
use design_dawn_lib::application::load_issue::LoadIssueKind;
use design_dawn_lib::application::project_operations::{load_project, open_project, save_project};
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::sheet_operations::save_sheet;
use design_dawn_lib::application::snapshot::EntityState;
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::{DocumentDto, SheetDto};
use serde_json::json;
use support::*;

const CURRENT_PROJECT_JSON: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/projects/basic/project.json"
);

fn current_project_text() -> String {
    read_text(std::path::Path::new(CURRENT_PROJECT_JSON))
}

#[test]
fn a_version_1_project_means_the_same_as_the_current_one_and_loading_writes_nothing() {
    let (_legacy_temp, legacy_root) = legacy_project_copy();
    let before = tree_snapshot(&legacy_root);
    let legacy = load_project(&legacy_root).unwrap().snapshot;
    assert_eq!(
        tree_snapshot(&legacy_root),
        before,
        "loading must not write"
    );

    let (_current_temp, current_root) = project_copy();
    let current = load_project(&current_root).unwrap().snapshot;

    assert_eq!(legacy.project, current.project);
    assert_eq!(legacy.documents, current.documents);
    assert_eq!(legacy.folders, current.folders);
    assert!(current.issues.is_empty());
    let outdated = issues_of_kind(&legacy.issues, LoadIssueKind::OutdatedFormat);
    assert_eq!(outdated.len(), 1);
    assert_eq!(outdated[0].path.as_deref(), Some("project.json"));
    assert_eq!(legacy.issues.len(), 1);
}

#[test]
fn the_next_save_writes_the_current_version_and_is_then_stable() {
    let (_temp, root) = legacy_project_copy();
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, &root).unwrap();

    let first = save_project(&mut sessions, PROJECT_ID, &snapshot.project).unwrap();
    assert!(first.written);
    assert_eq!(
        read_text(&root.join("project.json")),
        current_project_text()
    );

    let reopened = open_project(&mut sessions, &root).unwrap();
    assert!(reopened.issues.is_empty(), "{:?}", reopened.issues);
    assert_eq!(reopened.project, snapshot.project);
    let second = save_project(&mut sessions, PROJECT_ID, &reopened.project).unwrap();
    assert!(!second.written, "migration is idempotent");
}

#[test]
fn update_all_writes_only_the_outdated_files_in_the_current_version() {
    let (_temp, root) = legacy_project_copy();
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).unwrap();
    let before = tree_snapshot(&root);

    assert_eq!(
        list_outdated_files(&mut sessions, PROJECT_ID).unwrap(),
        ["project.json"]
    );
    assert_eq!(tree_snapshot(&root), before, "listing must not write");

    let result = update_outdated_files(&mut sessions, PROJECT_ID).unwrap();
    assert_eq!(result.updated, ["project.json"]);
    assert_eq!(
        read_text(&root.join("project.json")),
        current_project_text()
    );
    let mut expected = before;
    expected.insert(
        "project.json".to_owned(),
        Some(current_project_text().into_bytes()),
    );
    assert_eq!(tree_snapshot(&root), expected, "nothing else changes");

    // Nothing is outdated any more, so a second run writes nothing.
    assert!(update_outdated_files(&mut sessions, PROJECT_ID)
        .unwrap()
        .updated
        .is_empty());
    assert!(open_project(&mut sessions, &root)
        .unwrap()
        .issues
        .is_empty());
}

#[test]
fn update_all_stops_when_a_file_changed_outside_the_app() {
    let (_temp, root) = legacy_project_copy();
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).unwrap();
    replace_in_file(
        &root.join("project.json"),
        "Basic Project",
        "Edited elsewhere",
    );
    let before = tree_snapshot(&root);

    let error = update_outdated_files(&mut sessions, PROJECT_ID).unwrap_err();

    assert_eq!(
        error.kind,
        ErrorKind::Persistence(PersistenceErrorKind::ExternallyModified)
    );
    assert_eq!(
        tree_snapshot(&root),
        before,
        "the external edit is not overwritten"
    );
}

mod newer_than_supported {
    use super::*;

    #[test]
    fn a_newer_document_is_listed_as_failed_and_is_never_written() {
        let (_temp, root) = project_copy();
        let path = document_dir(&root).join("document.json");
        let mut value = read_json(&path);
        value["schemaVersion"] = json!(2);
        write_json(&path, &value);
        let before = tree_snapshot(&root);
        let mut sessions = ProjectSessions::default();

        let snapshot = open_project(&mut sessions, &root).unwrap();
        assert_eq!(snapshot.documents[0].state, EntityState::LoadFailed);
        let failed_issue = issues_of_kind(&snapshot.issues, LoadIssueKind::EntityLoadFailed);
        assert_eq!(failed_issue.len(), 1);
        assert_eq!(failed_issue[0].reason, Some("unsupportedSchemaVersion"));
        let error = load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::Domain(DomainErrorKind::UnsupportedSchemaVersion)
        );
        let payload: DocumentDto = serde_json::from_value(json!({
            "schemaVersion": 1,
            "documentId": DOCUMENT_ID,
            "name": "Overwrite attempt",
            "sheetOrder": []
        }))
        .unwrap();
        let error = save_document(&mut sessions, PROJECT_ID, &payload).unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotWritable);
        assert_eq!(tree_snapshot(&root), before);
    }

    #[test]
    fn a_newer_sheet_is_listed_as_failed_and_is_never_written() {
        let (_temp, root) = project_copy();
        let path = sheet_dir(&root, "overview").join("sheet.json");
        let mut value = read_json(&path);
        value["schemaVersion"] = json!(2);
        value["somethingNew"] = json!(true);
        write_json(&path, &value);
        let before = tree_snapshot(&root);
        let mut sessions = ProjectSessions::default();
        open_project(&mut sessions, &root).unwrap();

        let document = load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
        let failed = document
            .sheets
            .iter()
            .find(|entry| entry.sheet_id == OVERVIEW_SHEET_ID)
            .unwrap();
        assert_eq!(failed.state, EntityState::LoadFailed);
        let payload: SheetDto = serde_json::from_value(json!({
            "schemaVersion": 1,
            "sheetId": OVERVIEW_SHEET_ID,
            "name": "Overwrite attempt",
            "blocks": []
        }))
        .unwrap();
        let error = save_sheet(&mut sessions, PROJECT_ID, DOCUMENT_ID, &payload).unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotWritable);
        assert_eq!(tree_snapshot(&root), before);
    }

    #[test]
    fn a_newer_folder_is_listed_as_failed() {
        let (_temp, root) = folders_project_copy();
        let path = root
            .join("documents")
            .join("architecture")
            .join("folder.json");
        let mut value = read_json(&path);
        value["schemaVersion"] = json!(2);
        write_json(&path, &value);
        let before = tree_snapshot(&root);

        let snapshot = load_project(&root).unwrap().snapshot;

        let folder = snapshot
            .folders
            .iter()
            .find(|entry| entry.folder_id == ARCHITECTURE_FOLDER_ID)
            .unwrap();
        assert_eq!(folder.state, EntityState::LoadFailed);
        assert_eq!(tree_snapshot(&root), before);
    }

    #[test]
    fn a_newer_project_does_not_open() {
        let (_temp, root) = project_copy();
        fs::write(
            root.join("project.json"),
            r#"{"schemaVersion":3,"future":true}"#,
        )
        .unwrap();
        let error = open_project(&mut ProjectSessions::default(), &root).unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::Domain(DomainErrorKind::UnsupportedSchemaVersion)
        );
    }
}
