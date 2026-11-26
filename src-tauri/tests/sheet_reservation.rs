//! Sheets reserved while Auto Save is off: nothing is written until the first write into
//! them, and closing the Document forgets them.

mod support;

use std::fs;

use design_dawn_lib::application::block_content_operations::{
    create_block_content, reserve_block_content, restore_block_content,
};
use design_dawn_lib::application::document_operations::{close_document, load_document};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::sheet_operations::{delete_sheet, reserve_sheet, save_sheet};
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::SheetDto;
use serde_json::json;
use support::*;

const RESERVED_SHEET_ID: &str = "01928f3a-7d90-7f90-b123-456789abcdef";
const OTHER_RESERVED_SHEET_ID: &str = "01928f3a-7d91-7f90-b123-456789abcdef";
const RESERVED_NAME: &str = "Later";
const MARKDOWN: &str = "markdown";

fn opened_document() -> OpenedProject {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    opened
}

fn reserve(opened: &mut OpenedProject, sheet_id: &str, name: &str) {
    reserve_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        sheet_id,
        name,
    )
    .unwrap();
}

fn sheet_payload(sheet_id: &str, name: &str) -> SheetDto {
    serde_json::from_value(json!({
        "schemaVersion": 1, "sheetId": sheet_id, "name": name, "blocks": []
    }))
    .unwrap()
}

fn saved_order(opened: &OpenedProject) -> Vec<String> {
    let document = read_json(&document_dir(&opened.root).join("document.json"));
    document["sheetOrder"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_reserved_sheet_writes_nothing() {
    let mut opened = opened_document();
    let before = tree_snapshot(&opened.root);

    let snapshot = reserve_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
        RESERVED_NAME,
    )
    .unwrap();

    assert_eq!(snapshot.sheet_id, RESERVED_SHEET_ID);
    assert_eq!(snapshot.name.as_deref(), Some(RESERVED_NAME));
    assert!(snapshot.sheet.unwrap().blocks.is_empty());
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn a_reservation_is_refused_like_a_creation() {
    let mut opened = opened_document();

    let duplicate = reserve_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_SHEET_ID,
        RESERVED_NAME,
    )
    .unwrap_err();
    let blank = reserve_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
        " ",
    )
    .unwrap_err();

    assert_eq!(
        duplicate.kind,
        ErrorKind::Domain(DomainErrorKind::DuplicateId)
    );
    assert_eq!(
        blank.kind,
        ErrorKind::Domain(DomainErrorKind::InvalidDisplayName)
    );
}

#[test]
fn saving_a_reserved_sheet_puts_it_on_disk_and_in_the_order() {
    let mut opened = opened_document();
    reserve(&mut opened, RESERVED_SHEET_ID, RESERVED_NAME);

    save_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        &sheet_payload(RESERVED_SHEET_ID, "Renamed before the save"),
    )
    .unwrap();

    let directory = sheet_dir(&opened.root, "later");
    assert_eq!(
        read_json(&directory.join("sheet.json"))["name"],
        "Renamed before the save"
    );
    assert!(directory.join("blocks").is_dir());
    assert_eq!(saved_order(&opened).last().unwrap(), RESERVED_SHEET_ID);
    // On disk now: a second save only rewrites its sheet.json.
    save_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        &sheet_payload(RESERVED_SHEET_ID, "Again"),
    )
    .unwrap();
    assert_eq!(read_json(&directory.join("sheet.json"))["name"], "Again");
}

#[test]
fn reservations_never_share_a_directory() {
    let mut opened = opened_document();
    reserve(&mut opened, RESERVED_SHEET_ID, "Overview");
    reserve(&mut opened, OTHER_RESERVED_SHEET_ID, "Overview");

    for (sheet_id, name) in [
        (RESERVED_SHEET_ID, "first"),
        (OTHER_RESERVED_SHEET_ID, "second"),
    ] {
        save_sheet(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            &sheet_payload(sheet_id, name),
        )
        .unwrap();
    }

    // "overview" is the sheet already on disk.
    assert_eq!(
        read_json(&sheet_dir(&opened.root, "overview-2").join("sheet.json"))["name"],
        "first"
    );
    assert_eq!(
        read_json(&sheet_dir(&opened.root, "overview-3").join("sheet.json"))["name"],
        "second"
    );
}

#[test]
fn a_block_name_reserved_in_a_reserved_sheet_writes_nothing() {
    let mut opened = opened_document();
    reserve(&mut opened, RESERVED_SHEET_ID, RESERVED_NAME);
    let before = tree_snapshot(&opened.root);

    let first = reserve_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
        MARKDOWN,
        "",
    )
    .unwrap();
    let second = reserve_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
        MARKDOWN,
        "",
    )
    .unwrap();

    assert_eq!(first, "sheets/later/blocks/markdown-1.md");
    assert_eq!(second, "sheets/later/blocks/markdown-2.md");
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn the_first_block_written_puts_a_reserved_sheet_on_disk_empty() {
    let mut opened = opened_document();
    reserve(&mut opened, RESERVED_SHEET_ID, RESERVED_NAME);
    let content_path = reserve_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
        MARKDOWN,
        "",
    )
    .unwrap();

    restore_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        MARKDOWN,
        &content_path,
        "# kept",
    )
    .unwrap();

    let directory = sheet_dir(&opened.root, "later");
    let sheet = read_json(&directory.join("sheet.json"));
    assert_eq!(sheet["name"], RESERVED_NAME);
    assert_eq!(sheet["blocks"], json!([]));
    assert_eq!(
        read_text(&document_dir(&opened.root).join(&content_path)),
        "# kept"
    );
    assert_eq!(saved_order(&opened).last().unwrap(), RESERVED_SHEET_ID);
}

#[test]
fn a_block_created_now_puts_a_reserved_sheet_on_disk() {
    let mut opened = opened_document();
    reserve(&mut opened, RESERVED_SHEET_ID, RESERVED_NAME);

    let content_path = create_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
        MARKDOWN,
        "now",
    )
    .unwrap();

    assert!(sheet_dir(&opened.root, "later")
        .join("sheet.json")
        .is_file());
    assert_eq!(
        read_text(&document_dir(&opened.root).join(&content_path)),
        "now"
    );
}

#[test]
fn deleting_a_reserved_sheet_only_forgets_it() {
    let mut opened = opened_document();
    reserve(&mut opened, RESERVED_SHEET_ID, RESERVED_NAME);
    let before = tree_snapshot(&opened.root);

    delete_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
    )
    .unwrap();

    assert_eq!(tree_snapshot(&opened.root), before);
    let forgotten = save_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        &sheet_payload(RESERVED_SHEET_ID, RESERVED_NAME),
    )
    .unwrap_err();
    assert_eq!(forgotten.kind, ErrorKind::EntityNotFound);
}

#[test]
fn closing_the_document_forgets_its_reserved_sheets() {
    let mut opened = opened_document();
    reserve(&mut opened, RESERVED_SHEET_ID, RESERVED_NAME);
    reserve_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        RESERVED_SHEET_ID,
        MARKDOWN,
        "",
    )
    .unwrap();
    let before = tree_snapshot(&opened.root);

    close_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();

    assert_eq!(tree_snapshot(&opened.root), before);
    let forgotten = save_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        &sheet_payload(RESERVED_SHEET_ID, RESERVED_NAME),
    )
    .unwrap_err();
    assert_eq!(forgotten.kind, ErrorKind::EntityNotFound);
    // Its directory name and block numbers are free again.
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    reserve(&mut opened, OTHER_RESERVED_SHEET_ID, RESERVED_NAME);
    let content_path = reserve_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OTHER_RESERVED_SHEET_ID,
        MARKDOWN,
        "",
    )
    .unwrap();
    assert_eq!(content_path, "sheets/later/blocks/markdown-1.md");
}

#[test]
fn a_document_without_a_sheets_directory_gets_one_with_its_first_sheet() {
    let mut opened = opened_document();
    let sheets = document_dir(&opened.root).join("sheets");
    for sheet_id in [OVERVIEW_SHEET_ID, DETAILS_SHEET_ID] {
        delete_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, sheet_id).unwrap();
    }
    fs::remove_dir_all(&sheets).unwrap();
    reserve(&mut opened, RESERVED_SHEET_ID, RESERVED_NAME);

    save_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        &sheet_payload(RESERVED_SHEET_ID, RESERVED_NAME),
    )
    .unwrap();

    assert!(sheets.join("later").join("sheet.json").is_file());
}
