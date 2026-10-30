//! External change detection and the write-before-check guard:
//! `check_external_changes` compares the files with what the session last read or wrote, and a
//! save refuses to overwrite a file that changed behind the app's back.

mod support;

use std::collections::BTreeSet;
use std::fs;

use design_dawn_lib::application::block_content_operations::{
    delete_block_content, read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::{close_document, load_document};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::external_change::{
    accept_disk_state, check_external_changes, detect, ExternalChanges, FileChange, Scope,
};
use design_dawn_lib::application::project_operations::{open_project, save_project};
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::sheet_operations::save_sheet;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::{ProjectDto, SheetDto};
use support::*;

const EXTERNAL_TEXT: &str = "# edited elsewhere\n";
const OTHER_EXTERNAL_TEXT: &str = "# edited elsewhere, again\n";

fn opened_with_document() -> OpenedProject {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).expect("load document");
    // Block text is read when a Block is shown, and only then does the session record it.
    for content_path in [OVERVIEW_MARKDOWN_PATH, DETAILS_MARKDOWN_PATH] {
        read_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, content_path)
            .expect("read block content");
    }
    opened
}

fn check(opened: &mut OpenedProject) -> ExternalChanges {
    check_external_changes(&mut opened.sessions, PROJECT_ID).expect("check")
}

fn markdown_file(opened: &OpenedProject) -> std::path::PathBuf {
    document_dir(&opened.root).join(OVERVIEW_MARKDOWN_PATH)
}

fn externally_modified(error: design_dawn_lib::application::error::ApplicationError) -> bool {
    error.kind == ErrorKind::Persistence(PersistenceErrorKind::ExternallyModified)
}

fn overview_sheet(opened: &OpenedProject) -> SheetDto {
    serde_json::from_value(read_json(
        &sheet_dir(&opened.root, "overview").join("sheet.json"),
    ))
    .expect("sheet")
}

#[test]
fn nothing_changed_right_after_opening_and_after_the_apps_own_saves() {
    let mut opened = opened_with_document();
    assert!(check(&mut opened).is_empty());

    write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "# saved by the app\n",
    )
    .unwrap();
    let sheet = overview_sheet(&opened);
    save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &sheet).unwrap();
    assert!(check(&mut opened).is_empty());
}

#[test]
fn an_external_edit_is_reported_with_a_document_relative_path_and_the_session_generation() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);

    let changes = check(&mut opened);

    assert_eq!(
        changes.session_generation,
        opened.snapshot.session_generation
    );
    assert!(changes.rescan);
    assert!(changes.project.files.is_empty() && !changes.project.structure);
    assert_eq!(changes.documents.len(), 1);
    assert_eq!(changes.documents[0].document_id, DOCUMENT_ID);
    assert_eq!(changes.documents[0].files.len(), 1);
    let file = &changes.documents[0].files[0];
    assert_eq!(file.path, OVERVIEW_MARKDOWN_PATH);
    assert_eq!(file.change, FileChange::Modified);
    assert!(file.readable);
}

#[test]
fn rewriting_the_same_content_is_not_a_change() {
    let mut opened = opened_with_document();
    let before = read_text(&markdown_file(&opened));
    write_text(&markdown_file(&opened), "# something else\n");
    write_text(&markdown_file(&opened), &before);
    assert!(check(&mut opened).is_empty());
}

#[test]
fn a_removed_file_is_reported_as_removed_and_not_readable() {
    let mut opened = opened_with_document();
    fs::remove_file(markdown_file(&opened)).unwrap();

    let changes = check(&mut opened);

    let file = &changes.documents[0].files[0];
    assert_eq!(file.path, OVERVIEW_MARKDOWN_PATH);
    assert_eq!(file.change, FileChange::Removed);
    assert!(!file.readable);
}

#[test]
fn invalid_json_and_text_that_is_not_utf8_are_not_readable() {
    let mut opened = opened_with_document();
    write_text(
        &sheet_dir(&opened.root, "overview").join("sheet.json"),
        "{ not json",
    );
    fs::write(markdown_file(&opened), [0xFF, 0xFE, 0x41]).unwrap();

    let changes = check(&mut opened);

    let files = &changes.documents[0].files;
    assert_eq!(files.len(), 2);
    assert!(files.iter().all(|file| file.change == FileChange::Modified));
    assert!(files.iter().all(|file| !file.readable));
}

#[test]
fn a_file_the_session_never_read_is_not_reported() {
    let mut opened = opened_with_document();
    // The details sheet was read when the document loaded, but a file added next to it was not.
    write_text(
        &sheet_dir(&opened.root, "details")
            .join("blocks")
            .join("added-by-hand.md"),
        "# new\n",
    );
    assert!(check(&mut opened).is_empty());
}

#[test]
fn only_open_documents_are_reported() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);
    close_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    assert!(check(&mut opened).is_empty());
}

#[test]
fn project_level_files_are_reported_relative_to_the_project_root() {
    let mut opened = opened_with_document();
    replace_in_file(
        &opened.root.join("project.json"),
        "Basic Project",
        "Renamed Project",
    );

    let changes = check(&mut opened);

    assert_eq!(changes.project.files.len(), 1);
    assert_eq!(changes.project.files[0].path, "project.json");
    assert_eq!(changes.project.files[0].change, FileChange::Modified);
    assert!(changes.project.files[0].readable);
    assert!(changes.documents.is_empty());
}

#[test]
fn a_folder_file_belongs_to_the_project_level() {
    let (temp, root) = folders_project_copy();
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).unwrap();
    let folder_file = root
        .join("documents")
        .join("architecture")
        .join("folder.json");
    let text = read_text(&folder_file);
    write_text(
        &folder_file,
        &text.replace("Architecture", "Architecture 2"),
    );

    let changes = check_external_changes(&mut sessions, FOLDERS_PROJECT_ID).unwrap();

    assert_eq!(changes.project.files.len(), 1);
    assert_eq!(
        changes.project.files[0].path,
        "documents/architecture/folder.json"
    );
    drop(temp);
}

#[test]
fn a_new_or_removed_document_directory_is_a_structure_change() {
    let mut opened = opened_with_document();
    assert!(!check(&mut opened).project.structure);

    let added = opened.root.join("documents").join("added");
    fs::create_dir(&added).unwrap();
    write_json(
        &added.join("document.json"),
        &serde_json::json!({
            "schemaVersion": 1,
            "documentId": "01928f3a-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
            "name": "Added",
            "sheetOrder": []
        }),
    );
    assert!(check(&mut opened).project.structure);
    fs::remove_dir_all(&added).unwrap();
    assert!(!check(&mut opened).project.structure);

    fs::remove_dir_all(document_dir(&opened.root)).unwrap();
    let changes = check(&mut opened);
    assert!(changes.project.structure);
    // The files of the vanished document are reported as removed as well.
    assert!(changes.documents[0]
        .files
        .iter()
        .all(|file| file.change == FileChange::Removed));
}

#[test]
fn a_directory_without_metadata_is_not_an_entry() {
    let mut opened = opened_with_document();
    fs::create_dir(opened.root.join("documents").join("scratch")).unwrap();
    assert!(!check(&mut opened).project.structure);
}

#[test]
fn a_save_over_an_externally_edited_file_is_refused_and_the_external_content_stays() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);

    let error = write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "# the app's version\n",
    )
    .unwrap_err();

    assert!(externally_modified(error));
    assert_eq!(read_text(&markdown_file(&opened)), EXTERNAL_TEXT);
}

#[test]
fn saving_metadata_over_an_external_edit_is_refused_for_every_kind_of_file() {
    let mut opened = opened_with_document();
    let sheet_file = sheet_dir(&opened.root, "overview").join("sheet.json");
    let sheet = overview_sheet(&opened);
    replace_in_file(&sheet_file, "Overview", "Overview (external)");
    let error = save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &sheet).unwrap_err();
    assert!(externally_modified(error));
    assert!(read_text(&sheet_file).contains("Overview (external)"));

    replace_in_file(&opened.root.join("project.json"), "Basic Project", "Other");
    let project: ProjectDto = opened.snapshot.project.clone();
    let error = save_project(&mut opened.sessions, PROJECT_ID, &project).unwrap_err();
    assert!(externally_modified(error));
    assert!(read_text(&opened.root.join("project.json")).contains("Other"));
}

#[test]
fn saving_onto_an_externally_removed_file_does_not_recreate_it() {
    let mut opened = opened_with_document();
    fs::remove_file(markdown_file(&opened)).unwrap();
    let error = write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "# the app's version\n",
    )
    .unwrap_err();
    assert!(externally_modified(error));
    assert!(!markdown_file(&opened).exists());

    let sheet_file = sheet_dir(&opened.root, "overview").join("sheet.json");
    let sheet = overview_sheet(&opened);
    fs::remove_file(&sheet_file).unwrap();
    let error = save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &sheet).unwrap_err();
    assert!(externally_modified(error));
    assert!(!sheet_file.exists());
}

#[test]
fn deleting_an_externally_edited_content_file_is_refused() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);
    let error = delete_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
    )
    .unwrap_err();
    assert!(externally_modified(error));
    assert_eq!(read_text(&markdown_file(&opened)), EXTERNAL_TEXT);
}

#[test]
fn accepting_the_disk_state_allows_the_next_save_and_only_for_that_document() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);
    replace_in_file(&opened.root.join("project.json"), "Basic Project", "Other");

    accept_disk_state(&mut opened.sessions, PROJECT_ID, Some(DOCUMENT_ID)).unwrap();

    // The document's file is accepted: no longer reported, and a save overwrites it.
    let changes = check(&mut opened);
    assert!(changes.documents.is_empty());
    // The Project-level file was not part of the accepted scope.
    assert_eq!(changes.project.files.len(), 1);
    write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "# the app's version\n",
    )
    .unwrap();
    assert_eq!(read_text(&markdown_file(&opened)), "# the app's version\n");

    accept_disk_state(&mut opened.sessions, PROJECT_ID, None).unwrap();
    assert!(check(&mut opened).is_empty());
}

#[test]
fn accepting_after_an_external_removal_lets_a_metadata_save_recreate_the_file() {
    let mut opened = opened_with_document();
    let sheet_file = sheet_dir(&opened.root, "overview").join("sheet.json");
    let sheet = overview_sheet(&opened);
    fs::remove_file(&sheet_file).unwrap();

    accept_disk_state(&mut opened.sessions, PROJECT_ID, Some(DOCUMENT_ID)).unwrap();
    save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &sheet).unwrap();

    assert!(sheet_file.exists());
    assert!(check(&mut opened).is_empty());
}

#[test]
fn accepting_for_an_unknown_document_is_entity_not_found() {
    let mut opened = opened_with_document();
    let error = accept_disk_state(&mut opened.sessions, PROJECT_ID, Some(UNKNOWN_ID)).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
}

#[test]
fn checking_a_project_that_is_not_open_is_project_not_open() {
    let mut sessions = ProjectSessions::default();
    let error = check_external_changes(&mut sessions, PROJECT_ID).unwrap_err();
    assert_eq!(error.kind, ErrorKind::ProjectNotOpen);
}

#[test]
fn a_scoped_check_looks_only_at_the_named_paths() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);
    write_text(
        &document_dir(&opened.root).join(DETAILS_MARKDOWN_PATH),
        OTHER_EXTERNAL_TEXT,
    );
    let named: BTreeSet<String> =
        BTreeSet::from([format!("documents/system-design/{DETAILS_MARKDOWN_PATH}")]);

    let session = opened.sessions.session_mut(PROJECT_ID).unwrap();
    let changes = detect(session, &Scope::Paths(&named), false);

    assert!(!changes.rescan);
    assert_eq!(changes.documents.len(), 1);
    assert_eq!(changes.documents[0].files.len(), 1);
    assert_eq!(changes.documents[0].files[0].path, DETAILS_MARKDOWN_PATH);
}

#[test]
fn a_reopened_project_has_a_new_session_generation() {
    let mut opened = open_copy();
    let first = opened.snapshot.session_generation;
    let second = open_project(&mut opened.sessions, &opened.root)
        .unwrap()
        .session_generation;
    assert!(second > first);
}

#[test]
fn the_result_never_contains_an_absolute_path() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);
    write_text(&opened.root.join("project.json"), "{ nope");
    let serialized = serde_json::to_string(&check(&mut opened)).unwrap();
    let root = opened.root.to_string_lossy().into_owned();
    assert!(!serialized.contains(&root), "{serialized}");
    assert!(!serialized.contains(&opened.temp.path().to_string_lossy().into_owned()));
}

// ---- compare_block_content ----

use design_dawn_lib::application::block_content_operations::{
    compare_block_content, BlockContentComparison, COMPARE_MAX_BYTES,
};

fn compare(opened: &mut OpenedProject, text: &str) -> BlockContentComparison {
    compare_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        text,
    )
    .expect("compare")
}

#[test]
fn comparing_equal_text_is_identical() {
    let mut opened = opened_with_document();
    let disk = read_text(&markdown_file(&opened));
    assert_eq!(
        compare(&mut opened, &disk),
        BlockContentComparison::Identical
    );
}

#[test]
fn comparing_memory_with_an_externally_edited_file_gives_a_diff_from_disk_to_memory() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), "# edited elsewhere\nsecond\n");

    let BlockContentComparison::Text { diff } = compare(&mut opened, "# in memory\nsecond\n")
    else {
        panic!("expected a text diff");
    };

    assert!(diff.starts_with("--- disk\n+++ memory\n@@ "), "{diff}");
    assert!(diff.contains("-# edited elsewhere\n"));
    assert!(diff.contains("+# in memory\n"));
    assert!(diff.contains(" second\n"));
}

#[test]
fn comparing_never_touches_the_record_so_the_change_stays_reported_and_saves_stay_refused() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);
    compare(&mut opened, "# in memory\n");

    assert_eq!(check(&mut opened).documents[0].files.len(), 1);
    let error = write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "# in memory\n",
    )
    .unwrap_err();
    assert!(externally_modified(error));
    assert_eq!(read_text(&markdown_file(&opened)), EXTERNAL_TEXT);
}

#[test]
fn a_file_removed_from_disk_is_reported_as_such() {
    let mut opened = opened_with_document();
    fs::remove_file(markdown_file(&opened)).unwrap();
    assert_eq!(
        compare(&mut opened, "# in memory\n"),
        BlockContentComparison::RemovedOnDisk
    );
}

#[test]
fn a_file_that_is_not_utf8_or_too_large_has_its_own_outcome() {
    let mut opened = opened_with_document();
    fs::write(markdown_file(&opened), [0xFF, 0xFE, 0x41]).unwrap();
    assert_eq!(compare(&mut opened, "x"), BlockContentComparison::NotUtf8);

    let oversized = vec![b'a'; usize::try_from(COMPARE_MAX_BYTES).unwrap() + 1];
    fs::write(markdown_file(&opened), oversized).unwrap();
    assert_eq!(
        compare(&mut opened, "x"),
        BlockContentComparison::TooLarge {
            limit_bytes: COMPARE_MAX_BYTES
        }
    );
}

#[test]
fn comparison_rejects_paths_that_are_not_text_content_of_the_document() {
    let mut opened = opened_with_document();
    for path in [
        "../../project.json",
        "assets/pixel.png",
        "sheets/overview/sheet.json",
    ] {
        let result =
            compare_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, path, "x");
        assert!(result.is_err(), "{path} must be refused");
    }
    let unknown = compare_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        UNKNOWN_ID,
        OVERVIEW_MARKDOWN_PATH,
        "x",
    )
    .unwrap_err();
    assert_eq!(unknown.kind, ErrorKind::EntityNotFound);
}

#[test]
fn the_comparison_result_contains_no_absolute_path() {
    let mut opened = opened_with_document();
    write_text(&markdown_file(&opened), EXTERNAL_TEXT);
    let serialized = serde_json::to_string(&compare(&mut opened, "x")).unwrap();
    assert!(!serialized.contains(&opened.root.to_string_lossy().into_owned()));
}
