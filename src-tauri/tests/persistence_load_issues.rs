//! Every Load Issue kind in docs/data-model.md §7, plus load failures. All tests also assert
//! that loading never changes a file ("ロードは書き込みを行わない").

mod support;

use std::fs;
use std::path::Path;

use design_dawn_lib::application::block_content_operations::write_block_content;
use design_dawn_lib::application::document_operations::{load_document, save_document};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::load_issue::LoadIssueKind;
use design_dawn_lib::application::project_operations::open_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::sheet_operations::{create_sheet, save_sheet};
use design_dawn_lib::application::snapshot::{DocumentSnapshot, EntityState, ProjectSnapshot};
use design_dawn_lib::domain::entity_id::{DocumentId, ProjectId, SheetId};
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::SheetDto;
use serde_json::json;
use support::*;

/// Opens and loads the sample document, asserting that nothing on disk changed.
fn open_and_load(root: &Path) -> (ProjectSessions, ProjectSnapshot, DocumentSnapshot) {
    let before = tree_snapshot(root);
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, root).expect("open");
    let document = load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).expect("load document");
    assert_eq!(tree_snapshot(root), before, "loading must not write");
    (sessions, snapshot, document)
}

fn sheet_json(sheet_id: &str, name: &str, schema_version: u32) -> serde_json::Value {
    json!({
        "schemaVersion": schema_version,
        "sheetId": sheet_id,
        "name": name,
        "blocks": []
    })
}

fn set_project_order(root: &Path, order: &[&str]) {
    let path = root.join("project.json");
    let mut value = read_json(&path);
    value["documentOrder"] = json!(order);
    write_json(&path, &value);
}

fn set_sheet_order(root: &Path, order: &[&str]) {
    let path = document_dir(root).join("document.json");
    let mut value = read_json(&path);
    value["sheetOrder"] = json!(order);
    write_json(&path, &value);
}

fn failing_sheet_detail(document: &DocumentSnapshot) -> String {
    document
        .issues
        .iter()
        .find(|issue| issue.kind == LoadIssueKind::EntityLoadFailed)
        .expect("an entityLoadFailed issue")
        .detail
        .clone()
}

#[test]
fn unlisted_entities_are_appended_in_name_order_and_reported() {
    let (_temp, root) = project_copy();
    set_project_order(&root, &[]);
    set_sheet_order(&root, &[OVERVIEW_SHEET_ID]);
    let (_sessions, snapshot, document) = open_and_load(&root);

    let unlisted = issues_of_kind(&snapshot.issues, LoadIssueKind::UnlistedEntity);
    assert_eq!(unlisted.len(), 1);
    assert_eq!(unlisted[0].path.as_deref(), Some("documents/system-design"));
    assert_eq!(snapshot.project.child_order, [DOCUMENT_ID]);

    let unlisted = issues_of_kind(&document.issues, LoadIssueKind::UnlistedEntity);
    assert_eq!(unlisted.len(), 1);
    assert_eq!(unlisted[0].entity_id.as_deref(), Some(DETAILS_SHEET_ID));
    assert_eq!(
        document.document.sheet_order,
        [OVERVIEW_SHEET_ID, DETAILS_SHEET_ID]
    );
}

#[test]
fn the_order_array_decides_the_display_order_of_existing_entities() {
    let (_temp, root) = project_copy();
    set_sheet_order(&root, &[DETAILS_SHEET_ID, OVERVIEW_SHEET_ID]);
    let (_sessions, _snapshot, document) = open_and_load(&root);
    assert!(document.issues.is_empty(), "{:?}", document.issues);
    let ids: Vec<&str> = document
        .sheets
        .iter()
        .map(|s| s.sheet_id.as_str())
        .collect();
    assert_eq!(ids, [DETAILS_SHEET_ID, OVERVIEW_SHEET_ID]);
}

#[test]
fn listed_but_missing_entities_are_ignored_and_reported() {
    let (_temp, root) = project_copy();
    set_project_order(&root, &[DOCUMENT_ID, UNKNOWN_ID]);
    set_sheet_order(&root, &[OVERVIEW_SHEET_ID, UNKNOWN_ID, DETAILS_SHEET_ID]);
    let (_sessions, snapshot, document) = open_and_load(&root);

    let missing = issues_of_kind(&snapshot.issues, LoadIssueKind::MissingEntity);
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].entity_id.as_deref(), Some(UNKNOWN_ID));
    assert_eq!(snapshot.project.child_order, [DOCUMENT_ID]);
    assert_eq!(
        issues_of_kind(&document.issues, LoadIssueKind::MissingEntity).len(),
        1
    );
    assert_eq!(
        document.document.sheet_order,
        [OVERVIEW_SHEET_ID, DETAILS_SHEET_ID]
    );
}

#[test]
fn invalid_and_duplicate_order_entries_are_ignored_and_reported() {
    let (_temp, root) = project_copy();
    set_project_order(&root, &[DOCUMENT_ID, "not-an-id", DOCUMENT_ID]);
    set_sheet_order(
        &root,
        &[OVERVIEW_SHEET_ID, "", DETAILS_SHEET_ID, OVERVIEW_SHEET_ID],
    );
    let (_sessions, snapshot, document) = open_and_load(&root);

    assert_eq!(
        issues_of_kind(&snapshot.issues, LoadIssueKind::InvalidOrderEntry).len(),
        2
    );
    assert_eq!(snapshot.project.child_order, [DOCUMENT_ID]);
    assert_eq!(
        issues_of_kind(&document.issues, LoadIssueKind::InvalidOrderEntry).len(),
        2
    );
    assert_eq!(
        document.document.sheet_order,
        [OVERVIEW_SHEET_ID, DETAILS_SHEET_ID]
    );
    assert!(issues_of_kind(&document.issues, LoadIssueKind::MissingEntity).is_empty());
}

#[test]
fn a_second_document_directory_with_the_same_id_is_excluded() {
    let (_temp, root) = project_copy();
    let documents = root.join("documents");
    copy_dir_all(
        &documents.join("system-design"),
        &documents.join("system-design-copy"),
    );
    let (sessions, snapshot, _document) = open_and_load(&root);

    let duplicates = issues_of_kind(&snapshot.issues, LoadIssueKind::DuplicateEntityId);
    assert_eq!(duplicates.len(), 1);
    assert_eq!(
        duplicates[0].path.as_deref(),
        Some("documents/system-design-copy")
    );
    assert_eq!(snapshot.documents.len(), 1);
    let record = sessions
        .get(&ProjectId::parse(PROJECT_ID).unwrap())
        .unwrap()
        .document(&DocumentId::parse(DOCUMENT_ID).unwrap())
        .unwrap()
        .clone();
    assert_eq!(record.relative_path, "system-design");
}

#[test]
fn among_sheets_with_the_same_id_the_first_in_byte_order_wins() {
    let (_temp, root) = project_copy();
    let sheets = document_dir(&root).join("sheets");
    copy_dir_all(&sheets.join("details"), &sheets.join("aa-details"));
    copy_dir_all(&sheets.join("details"), &sheets.join("zz-details"));
    let (sessions, _snapshot, document) = open_and_load(&root);

    let duplicates = issues_of_kind(&document.issues, LoadIssueKind::DuplicateEntityId);
    let mut paths: Vec<&str> = duplicates
        .iter()
        .filter_map(|i| i.path.as_deref())
        .collect();
    paths.sort_unstable();
    assert_eq!(
        paths,
        [
            "documents/system-design/sheets/details",
            "documents/system-design/sheets/zz-details"
        ]
    );
    assert_eq!(document.sheets.len(), 2);
    let record = sessions
        .get(&ProjectId::parse(PROJECT_ID).unwrap())
        .unwrap()
        .document(&DocumentId::parse(DOCUMENT_ID).unwrap())
        .unwrap();
    let details = record
        .sheets
        .get(&SheetId::parse(DETAILS_SHEET_ID).unwrap())
        .unwrap();
    assert_eq!(details.directory_name, "aa-details");
}

#[test]
fn a_block_id_shared_by_two_sheets_is_reported_but_nothing_is_excluded() {
    let (_temp, root) = project_copy();
    replace_in_file(
        &sheet_dir(&root, "details").join("sheet.json"),
        DETAILS_MARKDOWN_BLOCK_ID,
        OVERVIEW_MARKDOWN_BLOCK_ID,
    );
    let (_sessions, _snapshot, document) = open_and_load(&root);

    let duplicates = issues_of_kind(&document.issues, LoadIssueKind::DuplicateEntityId);
    assert_eq!(duplicates.len(), 1);
    assert_eq!(
        duplicates[0].entity_id.as_deref(),
        Some(OVERVIEW_MARKDOWN_BLOCK_ID)
    );
    assert!(document
        .sheets
        .iter()
        .all(|s| s.state == EntityState::Loaded));
}

#[test]
fn a_sheet_with_broken_json_fails_to_load_and_is_reported() {
    let (_temp, root) = project_copy();
    write_text(
        &sheet_dir(&root, "details").join("sheet.json"),
        "{ not json",
    );
    let (_sessions, _snapshot, document) = open_and_load(&root);

    assert!(failing_sheet_detail(&document).contains("invalidJson"));
    // The ID is unreadable, so the sheet cannot be listed; its order entry is then "missing".
    assert_eq!(document.sheets.len(), 1);
    assert_eq!(
        issues_of_kind(&document.issues, LoadIssueKind::MissingEntity).len(),
        1
    );
}

#[test]
fn unknown_keys_and_non_integer_numbers_make_a_sheet_fail_with_the_specific_error() {
    let (_temp, root) = project_copy();
    let path = sheet_dir(&root, "overview").join("sheet.json");
    let mut value = read_json(&path);
    value["extra"] = json!(true);
    write_json(&path, &value);
    let (_sessions, _snapshot, document) = open_and_load(&root);
    assert!(failing_sheet_detail(&document).contains("invalidFileStructure"));

    let mut value = read_json(&path);
    value.as_object_mut().unwrap().remove("extra");
    value["blocks"][0]["position"]["x"] = json!(1.5);
    write_json(&path, &value);
    let (_sessions, _snapshot, document) = open_and_load(&root);
    assert!(failing_sheet_detail(&document).contains("invalidPosition"));
}

#[test]
fn a_newer_sheet_schema_fails_to_load_is_listed_and_can_never_be_written() {
    let (_temp, root) = project_copy();
    write_json(
        &sheet_dir(&root, "details").join("sheet.json"),
        &sheet_json(DETAILS_SHEET_ID, "Details", 2),
    );
    let (mut sessions, _snapshot, document) = open_and_load(&root);

    assert!(failing_sheet_detail(&document).contains("unsupportedSchemaVersion"));
    let details = document
        .sheets
        .iter()
        .find(|sheet| sheet.sheet_id == DETAILS_SHEET_ID)
        .expect("listed by its recovered id");
    assert_eq!(details.state, EntityState::LoadFailed);
    assert_eq!(details.name.as_deref(), Some("Details"));
    assert!(details.sheet.is_none());

    let payload: SheetDto =
        serde_json::from_value(sheet_json(DETAILS_SHEET_ID, "Overwrite", 1)).unwrap();
    let error = save_sheet(&mut sessions, PROJECT_ID, DOCUMENT_ID, &payload).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotWritable);
    let error = write_block_content(
        &mut sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        DETAILS_MARKDOWN_PATH,
        "overwritten",
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotWritable);
    assert!(
        read_text(&sheet_dir(&root, "details").join("sheet.json")).contains("\"schemaVersion\": 2")
    );
    assert!(
        read_text(&sheet_dir(&root, "details").join("blocks/markdown-1.md"))
            .starts_with("## Details")
    );

    // Healthy siblings stay writable.
    let overview: SheetDto =
        serde_json::from_value(sheet_json(OVERVIEW_SHEET_ID, "Overview", 1)).unwrap();
    assert!(save_sheet(&mut sessions, PROJECT_ID, DOCUMENT_ID, &overview).is_ok());
}

#[test]
fn a_newer_document_schema_lists_the_document_as_failed_and_blocks_writes() {
    let (_temp, root) = project_copy();
    replace_in_file(
        &document_dir(&root).join("document.json"),
        "\"schemaVersion\": 1",
        "\"schemaVersion\": 2",
    );
    let before = tree_snapshot(&root);
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, &root).unwrap();

    assert_eq!(snapshot.documents.len(), 1);
    assert_eq!(snapshot.documents[0].state, EntityState::LoadFailed);
    assert_eq!(snapshot.documents[0].name.as_deref(), Some("System Design"));
    assert_eq!(
        issues_of_kind(&snapshot.issues, LoadIssueKind::EntityLoadFailed).len(),
        1
    );

    let error = load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap_err();
    assert_eq!(
        error.kind,
        ErrorKind::Domain(DomainErrorKind::UnsupportedSchemaVersion)
    );
    let payload = serde_json::from_value(json!({
        "schemaVersion": 1, "documentId": DOCUMENT_ID, "name": "X", "sheetOrder": []
    }))
    .unwrap();
    let error = save_document(&mut sessions, PROJECT_ID, &payload).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotWritable);
    let error =
        create_sheet(&mut sessions, PROJECT_ID, DOCUMENT_ID, UNKNOWN_ID, "New").unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotWritable);
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn an_unreadable_project_file_is_a_command_error_with_a_specific_kind() {
    let cases: [(&str, &[u8], ErrorKind); 8] = [
        ("broken json", b"{ nope", ErrorKind::Persistence(PersistenceErrorKind::InvalidJson)),
        (
            "unknown key",
            br#"{"schemaVersion":1,"projectId":"01928f3a-5b6c-7d8e-9f01-23456789abcd","name":"P","documentOrder":[],"extra":1}"#,
            ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure),
        ),
        (
            "missing key",
            br#"{"schemaVersion":1,"name":"P","documentOrder":[]}"#,
            ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure),
        ),
        ("not utf-8", &[0xFF, 0xFE, 0x00], ErrorKind::Persistence(PersistenceErrorKind::InvalidEncoding)),
        (
            "newer schema",
            br#"{"schemaVersion":3,"projectId":"01928f3a-5b6c-7d8e-9f01-23456789abcd","name":"P","childOrder":[]}"#,
            ErrorKind::Domain(DomainErrorKind::UnsupportedSchemaVersion),
        ),
        (
            "newer schema with a structure this app does not know",
            br#"{"schemaVersion":3,"future":true}"#,
            ErrorKind::Domain(DomainErrorKind::UnsupportedSchemaVersion),
        ),
        (
            "schema 2 with the old documentOrder key",
            br#"{"schemaVersion":2,"projectId":"01928f3a-5b6c-7d8e-9f01-23456789abcd","name":"P","documentOrder":[]}"#,
            ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure),
        ),
        (
            "schema 1 with the new childOrder key",
            br#"{"schemaVersion":1,"projectId":"01928f3a-5b6c-7d8e-9f01-23456789abcd","name":"P","childOrder":[]}"#,
            ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure),
        ),
    ];
    for (label, bytes, expected) in cases {
        let (_temp, root) = project_copy();
        fs::write(root.join("project.json"), bytes).unwrap();
        let error = open_project(&mut ProjectSessions::default(), &root).unwrap_err();
        assert_eq!(error.kind, expected, "{label}");
    }
}

#[test]
fn a_missing_project_file_is_file_not_found() {
    let temp = TempDir::new();
    let error = open_project(&mut ProjectSessions::default(), temp.path()).unwrap_err();
    assert_eq!(
        error.kind,
        ErrorKind::Persistence(PersistenceErrorKind::FileNotFound)
    );
    let error =
        open_project(&mut ProjectSessions::default(), &temp.path().join("absent")).unwrap_err();
    assert_eq!(
        error.kind,
        ErrorKind::Persistence(PersistenceErrorKind::FileNotFound)
    );
}

#[test]
fn a_block_whose_content_file_is_gone_is_kept_and_reported() {
    let (_temp, root) = project_copy();
    fs::remove_file(sheet_dir(&root, "overview").join("blocks/mermaid-1.mmd")).unwrap();
    let (_sessions, _snapshot, document) = open_and_load(&root);

    let missing = issues_of_kind(&document.issues, LoadIssueKind::MissingContent);
    assert_eq!(missing.len(), 1);
    assert_eq!(
        missing[0].path.as_deref(),
        Some("documents/system-design/sheets/overview/blocks/mermaid-1.mmd")
    );
    let overview = document
        .sheets
        .iter()
        .find(|s| s.sheet_id == OVERVIEW_SHEET_ID)
        .unwrap();
    assert_eq!(overview.sheet.as_ref().unwrap().blocks.len(), 3);
}

#[test]
fn unreferenced_files_in_blocks_are_reported_and_left_alone() {
    let (_temp, root) = project_copy();
    let stray = sheet_dir(&root, "overview").join("blocks/stray.md");
    write_text(&stray, "orphan");
    let (_sessions, _snapshot, document) = open_and_load(&root);

    let orphans = issues_of_kind(&document.issues, LoadIssueKind::OrphanContent);
    assert_eq!(orphans.len(), 1);
    assert_eq!(
        orphans[0].path.as_deref(),
        Some("documents/system-design/sheets/overview/blocks/stray.md")
    );
    assert!(stray.exists());
}

#[test]
fn leftover_temp_files_are_reported_where_they_are() {
    let (_temp, root) = project_copy();
    write_text(&root.join(".project.json.dawn-tmp"), "partial");
    write_text(
        &document_dir(&root).join(".document.json.dawn-tmp"),
        "partial",
    );
    write_text(
        &sheet_dir(&root, "details").join(".sheet.json.dawn-tmp"),
        "partial",
    );
    write_text(
        &sheet_dir(&root, "details").join("blocks/.markdown-1.md.dawn-tmp"),
        "partial",
    );
    write_text(
        &document_dir(&root).join("assets/.pixel.png.dawn-tmp"),
        "partial",
    );
    let (_sessions, snapshot, document) = open_and_load(&root);

    let project_level = issues_of_kind(&snapshot.issues, LoadIssueKind::LeftoverTempFile);
    assert_eq!(project_level.len(), 1);
    assert_eq!(
        project_level[0].path.as_deref(),
        Some(".project.json.dawn-tmp")
    );

    let mut paths: Vec<&str> = issues_of_kind(&document.issues, LoadIssueKind::LeftoverTempFile)
        .iter()
        .filter_map(|issue| issue.path.as_deref())
        .collect();
    paths.sort_unstable();
    assert_eq!(
        paths,
        [
            "documents/system-design/.document.json.dawn-tmp",
            "documents/system-design/assets/.pixel.png.dawn-tmp",
            "documents/system-design/sheets/details/.sheet.json.dawn-tmp",
            "documents/system-design/sheets/details/blocks/.markdown-1.md.dawn-tmp",
        ]
    );
    // A temp file is not also reported as orphan content.
    assert!(issues_of_kind(&document.issues, LoadIssueKind::OrphanContent).is_empty());
}

#[test]
fn directories_without_metadata_are_reported_as_unrecognized() {
    let (_temp, root) = project_copy();
    fs::create_dir(root.join("documents/not-a-document")).unwrap();
    fs::create_dir(document_dir(&root).join("sheets/not-a-sheet")).unwrap();
    let (_sessions, snapshot, document) = open_and_load(&root);

    let unrecognized = issues_of_kind(&snapshot.issues, LoadIssueKind::UnrecognizedDirectory);
    assert_eq!(unrecognized.len(), 1);
    assert_eq!(
        unrecognized[0].path.as_deref(),
        Some("documents/not-a-document")
    );
    let unrecognized = issues_of_kind(&document.issues, LoadIssueKind::UnrecognizedDirectory);
    assert_eq!(unrecognized.len(), 1);
    assert_eq!(
        unrecognized[0].path.as_deref(),
        Some("documents/system-design/sheets/not-a-sheet")
    );
    assert_eq!(snapshot.documents.len(), 1);
    assert_eq!(document.sheets.len(), 2);
}

#[test]
fn unrecognized_directories_are_ignored_by_name_generation_and_never_reused() {
    let (_temp, root) = project_copy();
    fs::create_dir(document_dir(&root).join("sheets/scratch")).unwrap();
    let (mut sessions, _snapshot, _document) = open_and_load(&root);
    create_sheet(
        &mut sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        UNKNOWN_ID,
        "Scratch",
    )
    .unwrap();
    assert!(document_dir(&root)
        .join("sheets/scratch-2/sheet.json")
        .exists());
}
