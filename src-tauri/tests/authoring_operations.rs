//! The compound write operations used by the MCP server: a write based on state that changed
//! on disk afterwards is refused as a conflict, and a failed compound operation leaves no
//! half-created files behind.

mod support;

use design_dawn_lib::application::authoring::{
    create_listed_document, create_listed_sheet, create_text_block, delete_block, move_block,
    rename_document, rename_sheet, AuthoringError, BlockGeometry,
};
use design_dawn_lib::application::document_operations::load_document;
use support::*;

const EDITED_ELSEWHERE: &str = "{\"edited\": \"elsewhere\"}\n";

fn geometry() -> BlockGeometry {
    BlockGeometry {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
    }
}

#[test]
fn sheet_writes_based_on_a_stale_sheet_are_conflicts_and_change_nothing() {
    let mut opened = open_copy();
    let project_id = opened.snapshot.project.project_id.clone();
    let document = load_document(&mut opened.sessions, &project_id, DOCUMENT_ID).unwrap();
    let sheet = document.sheets[0].sheet.clone().unwrap();
    let sheet_file = sheet_dir(&opened.root, "overview").join("sheet.json");
    // The app (or git) rewrites sheet.json after this process read it.
    write_text(&sheet_file, EDITED_ELSEWHERE);
    let before = tree_snapshot(&opened.root);

    let sessions = &mut opened.sessions;
    let results = [
        move_block(
            sessions,
            &project_id,
            DOCUMENT_ID,
            &sheet,
            OVERVIEW_MARKDOWN_BLOCK_ID,
            (1, 1),
            None,
        )
        .map(drop),
        delete_block(
            sessions,
            &project_id,
            DOCUMENT_ID,
            &sheet,
            OVERVIEW_MARKDOWN_BLOCK_ID,
        )
        .map(drop),
        rename_sheet(sessions, &project_id, DOCUMENT_ID, &sheet, "Other").map(drop),
        create_text_block(
            sessions,
            &project_id,
            DOCUMENT_ID,
            &sheet,
            "markdown",
            "x",
            geometry(),
        )
        .map(drop),
    ];
    for result in results {
        assert_eq!(result.unwrap_err(), AuthoringError::Conflict);
    }
    // Nothing was overwritten, and the block creation removed the content file it had made.
    assert_eq!(tree_snapshot(&opened.root), before);
    assert_eq!(read_text(&sheet_file), EDITED_ELSEWHERE);
}

#[test]
fn a_document_listing_based_on_a_stale_project_file_is_a_conflict_and_leaves_no_document() {
    let mut opened = open_copy();
    let project_id = opened.snapshot.project.project_id.clone();
    write_text(&opened.root.join("project.json"), EDITED_ELSEWHERE);
    let before = tree_snapshot(&opened.root);

    let result = create_listed_document(
        &mut opened.sessions,
        &project_id,
        &opened.snapshot,
        "New",
        None,
    );
    assert_eq!(result.unwrap_err(), AuthoringError::Conflict);
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn a_sheet_listing_based_on_a_stale_document_file_is_a_conflict_and_leaves_no_sheet() {
    let mut opened = open_copy();
    let project_id = opened.snapshot.project.project_id.clone();
    let document = load_document(&mut opened.sessions, &project_id, DOCUMENT_ID).unwrap();
    let document_file = document_dir(&opened.root).join("document.json");
    write_text(&document_file, EDITED_ELSEWHERE);
    let before = tree_snapshot(&opened.root);

    let result = create_listed_sheet(&mut opened.sessions, &project_id, &document.document, "New");
    assert_eq!(result.unwrap_err(), AuthoringError::Conflict);
    assert_eq!(tree_snapshot(&opened.root), before);

    let renamed = rename_document(
        &mut opened.sessions,
        &project_id,
        &document.document,
        "Other",
    );
    assert_eq!(renamed.unwrap_err(), AuthoringError::Conflict);
    assert_eq!(read_text(&document_file), EDITED_ELSEWHERE);
}
