//! Block content numbering ("largest number + 1"),
//! `restore_block_content`, `delete_sheet` and `delete_document`.
// Some tests here need Unix (permissions, symlinks, shell scripts as a fake git) and are
// compiled only there; on other platforms their helpers are unused.
#![cfg_attr(
    not(unix),
    allow(dead_code, unused_imports, unused_variables, unused_mut)
)]

mod support;

use std::fs;
use std::path::Path;

use design_dawn_lib::application::block_content_operations::{
    create_block_content, delete_block_content, read_block_content, restore_block_content,
};
use design_dawn_lib::application::document_operations::{
    delete_document, load_document, save_document,
};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::load_issue::LoadIssueKind;
use design_dawn_lib::application::project_operations::open_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::sheet_operations::{delete_sheet, save_sheet};
use design_dawn_lib::domain::constants::CURRENT_SHEET_SCHEMA_VERSION;
use design_dawn_lib::domain::entity_id::ProjectId;
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::{DocumentDto, SheetDto};
use design_dawn_lib::infrastructure::filesystem::hashing::sha256_hex;
use serde_json::json;
use support::*;

const BLOCKS: &str = "sheets/overview/blocks";
const DOCUMENT_PREFIX: &str = "documents/system-design";

fn domain(kind: DomainErrorKind) -> ErrorKind {
    ErrorKind::Domain(kind)
}

fn persistence(kind: PersistenceErrorKind) -> ErrorKind {
    ErrorKind::Persistence(kind)
}

fn opened_and_loaded() -> OpenedProject {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    opened
}

fn create(opened: &mut OpenedProject, sheet_id: &str, block_type: &str) -> String {
    create_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        sheet_id,
        block_type,
        "",
    )
    .unwrap()
}

fn delete(opened: &mut OpenedProject, content_path: &str) {
    delete_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, content_path).unwrap();
}

fn restore(
    opened: &mut OpenedProject,
    block_type: &str,
    content_path: &str,
    text: &str,
) -> Result<(), ErrorKind> {
    restore_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        block_type,
        content_path,
        text,
    )
    .map_err(|error| error.kind)
}

fn ledger_hash(sessions: &ProjectSessions, key: &str) -> Option<String> {
    let project_id = ProjectId::parse(PROJECT_ID).unwrap();
    sessions
        .get(&project_id)
        .unwrap()
        .ledger()
        .hash_of(key)
        .map(str::to_owned)
}

// A sheet written by a newer app version: it fails to load.
fn break_sheet(root: &Path, directory: &str) {
    replace_in_file(
        &sheet_dir(root, directory).join("sheet.json"),
        &format!("\"schemaVersion\": {CURRENT_SHEET_SCHEMA_VERSION}"),
        &format!("\"schemaVersion\": {}", CURRENT_SHEET_SCHEMA_VERSION + 1),
    );
}

// ---- numbering ----

#[test]
fn a_gap_on_disk_is_not_filled() {
    let (_temp, root) = project_copy();
    let blocks = sheet_dir(&root, "overview").join("blocks");
    write_text(&blocks.join("markdown-2.md"), "two");
    write_text(&blocks.join("markdown-3.md"), "three");
    fs::remove_file(blocks.join("markdown-2.md")).unwrap();
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).unwrap();
    load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let path = create_block_content(
        &mut sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_SHEET_ID,
        "markdown",
        "",
    )
    .unwrap();
    assert_eq!(path, format!("{BLOCKS}/markdown-4.md"));
}

#[test]
fn deleting_the_highest_number_in_a_session_never_reuses_it() {
    let mut opened = opened_and_loaded();
    let created = create(&mut opened, OVERVIEW_SHEET_ID, "markdown");
    assert_eq!(created, format!("{BLOCKS}/markdown-2.md"));
    delete(&mut opened, &created);
    assert_eq!(
        create(&mut opened, OVERVIEW_SHEET_ID, "markdown"),
        format!("{BLOCKS}/markdown-3.md")
    );
}

#[test]
fn deleting_a_file_that_was_never_issued_by_the_session_also_raises_the_mark() {
    let mut opened = opened_and_loaded();
    write_text(
        &sheet_dir(&opened.root, "overview").join("blocks/markdown-7.md"),
        "external",
    );
    delete(&mut opened, &format!("{BLOCKS}/markdown-7.md"));
    assert_eq!(
        create(&mut opened, OVERVIEW_SHEET_ID, "markdown"),
        format!("{BLOCKS}/markdown-8.md")
    );
}

#[test]
fn restoring_a_higher_number_moves_the_next_number_above_it() {
    let mut opened = opened_and_loaded();
    let restored = format!("{BLOCKS}/markdown-9.md");
    restore(&mut opened, "markdown", &restored, "back").unwrap();
    delete(&mut opened, &restored);
    assert_eq!(
        create(&mut opened, OVERVIEW_SHEET_ID, "markdown"),
        format!("{BLOCKS}/markdown-10.md")
    );
}

#[test]
fn numbering_is_independent_per_block_type_and_per_sheet() {
    let mut opened = opened_and_loaded();
    restore(
        &mut opened,
        "markdown",
        &format!("{BLOCKS}/markdown-9.md"),
        "",
    )
    .unwrap();
    assert_eq!(
        create(&mut opened, OVERVIEW_SHEET_ID, "mermaid"),
        format!("{BLOCKS}/mermaid-2.mmd")
    );
    assert_eq!(
        create(&mut opened, DETAILS_SHEET_ID, "markdown"),
        "sheets/details/blocks/markdown-2.md"
    );
}

#[test]
fn names_outside_the_pattern_do_not_affect_numbering() {
    let mut opened = opened_and_loaded();
    let blocks = sheet_dir(&opened.root, "overview").join("blocks");
    for name in [
        "markdown-x.md",
        "markdown-50.txt",
        "notes-50.md",
        "mermaid-50.mmd",
        "markdown-99999999999999999999999.md",
    ] {
        write_text(&blocks.join(name), "stray");
    }
    assert_eq!(
        create(&mut opened, OVERVIEW_SHEET_ID, "markdown"),
        format!("{BLOCKS}/markdown-2.md")
    );
}

#[test]
fn a_fresh_session_may_reuse_a_deleted_highest_number() {
    // Documented limit: the high-water mark lives in the session only.
    let mut opened = opened_and_loaded();
    let created = create(&mut opened, OVERVIEW_SHEET_ID, "markdown");
    assert_eq!(created, format!("{BLOCKS}/markdown-2.md"));
    delete(&mut opened, &created);
    assert_eq!(
        create(&mut opened, OVERVIEW_SHEET_ID, "markdown"),
        format!("{BLOCKS}/markdown-3.md")
    );
    delete(&mut opened, &format!("{BLOCKS}/markdown-3.md"));

    let mut restarted = ProjectSessions::default();
    open_project(&mut restarted, &opened.root).unwrap();
    load_document(&mut restarted, PROJECT_ID, DOCUMENT_ID).unwrap();
    let path = create_block_content(
        &mut restarted,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_SHEET_ID,
        "markdown",
        "",
    )
    .unwrap();
    assert_eq!(path, format!("{BLOCKS}/markdown-2.md"));
}

#[test]
fn create_delete_restore_create_never_collides() {
    let mut opened = opened_and_loaded();
    let first = create(&mut opened, OVERVIEW_SHEET_ID, "markdown");
    delete(&mut opened, &first);
    restore(&mut opened, "markdown", &first, "undo").unwrap();
    let second = create(&mut opened, OVERVIEW_SHEET_ID, "markdown");
    assert_eq!(first, format!("{BLOCKS}/markdown-2.md"));
    assert_eq!(second, format!("{BLOCKS}/markdown-3.md"));
    let text = read_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &first).unwrap();
    assert_eq!(text, "undo");
}

// ---- restore_block_content ----

#[test]
fn restore_puts_the_exact_text_back_and_records_the_hash() {
    let mut opened = opened_and_loaded();
    delete(&mut opened, OVERVIEW_MERMAID_PATH);
    let key = format!("{DOCUMENT_PREFIX}/{OVERVIEW_MERMAID_PATH}");
    assert!(ledger_hash(&opened.sessions, &key).is_none());

    restore(
        &mut opened,
        "mermaid",
        OVERVIEW_MERMAID_PATH,
        "graph LR\r\n  A-->B",
    )
    .unwrap();

    let file = sheet_dir(&opened.root, "overview").join("blocks/mermaid-1.mmd");
    let bytes = fs::read(&file).unwrap();
    assert_eq!(bytes, b"graph LR\n  A-->B");
    assert_eq!(
        ledger_hash(&opened.sessions, &key),
        Some(sha256_hex(&bytes))
    );
}

// Git drops empty directories, so `blocks/` can be missing after a clone.
#[test]
fn restore_recreates_a_missing_blocks_directory() {
    let mut opened = opened_and_loaded();
    let blocks = sheet_dir(&opened.root, "overview").join("blocks");
    fs::remove_dir_all(&blocks).unwrap();

    restore(&mut opened, "markdown", OVERVIEW_MARKDOWN_PATH, "# back").unwrap();

    assert_eq!(read_text(&blocks.join("markdown-1.md")), "# back");
}

#[test]
fn restore_never_overwrites_anything_at_the_target() {
    let mut opened = opened_and_loaded();
    let blocks = sheet_dir(&opened.root, "overview").join("blocks");
    fs::create_dir(blocks.join("folder.md")).unwrap();
    let mut targets = vec![
        format!("{BLOCKS}/markdown-1.md"),
        format!("{BLOCKS}/folder.md"),
    ];
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink(blocks.join("markdown-1.md"), blocks.join("live-link.md")).unwrap();
        symlink(
            opened.temp.path().join("does-not-exist"),
            blocks.join("dangling-link.md"),
        )
        .unwrap();
        targets.push(format!("{BLOCKS}/live-link.md"));
        targets.push(format!("{BLOCKS}/dangling-link.md"));
    }
    let before = tree_snapshot(&opened.root);
    for target in targets {
        assert_eq!(
            restore(&mut opened, "markdown", &target, "overwritten"),
            Err(persistence(PersistenceErrorKind::AlreadyExists)),
            "{target}"
        );
        assert_eq!(tree_snapshot(&opened.root), before, "{target}");
    }
}

#[test]
fn restore_validates_the_path_and_type_through_the_domain() {
    let mut opened = opened_and_loaded();
    let before = tree_snapshot(&opened.root);
    let cases = [
        (
            "markdown",
            format!("{BLOCKS}/markdown-5.mmd"),
            domain(DomainErrorKind::InvalidContentExtension),
        ),
        (
            "mermaid",
            format!("{BLOCKS}/mermaid-5.md"),
            domain(DomainErrorKind::InvalidContentExtension),
        ),
        (
            "markdown",
            format!("{BLOCKS}/markdown-5"),
            domain(DomainErrorKind::InvalidContentExtension),
        ),
        (
            "markdown",
            "../outside.md".to_owned(),
            domain(DomainErrorKind::InvalidContentPath),
        ),
        (
            "markdown",
            format!("{BLOCKS}/../markdown-5.md"),
            domain(DomainErrorKind::InvalidContentPath),
        ),
        (
            "markdown",
            "/etc/markdown-5.md".to_owned(),
            domain(DomainErrorKind::InvalidContentPath),
        ),
        (
            "markdown",
            "assets/markdown-5.md".to_owned(),
            domain(DomainErrorKind::InvalidContentPath),
        ),
        (
            "markdown",
            String::new(),
            domain(DomainErrorKind::InvalidContentPath),
        ),
        (
            "image",
            "assets/pixel-2.png".to_owned(),
            domain(DomainErrorKind::UnsupportedBlockType),
        ),
        (
            "bogus",
            format!("{BLOCKS}/markdown-5.md"),
            domain(DomainErrorKind::UnsupportedBlockType),
        ),
    ];
    for (block_type, path, expected) in cases {
        assert_eq!(
            restore(&mut opened, block_type, &path, "x"),
            Err(expected),
            "{block_type} {path:?}"
        );
    }
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn restore_needs_a_known_writable_sheet_and_an_open_project() {
    let (_temp, root) = project_copy();
    break_sheet(&root, "details");
    let mut opened = {
        let mut sessions = ProjectSessions::default();
        let snapshot = open_project(&mut sessions, &root).unwrap();
        load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
        OpenedProject {
            temp: TempDir::new(),
            root: root.clone(),
            sessions,
            snapshot,
        }
    };
    let before = tree_snapshot(&root);
    assert_eq!(
        restore(
            &mut opened,
            "markdown",
            "sheets/ghost/blocks/markdown-1.md",
            "x"
        ),
        Err(ErrorKind::EntityNotFound)
    );
    assert_eq!(
        restore(
            &mut opened,
            "markdown",
            "sheets/details/blocks/markdown-2.md",
            "x"
        ),
        Err(ErrorKind::NotWritable)
    );
    let error = restore_block_content(
        &mut opened.sessions,
        UNKNOWN_ID,
        DOCUMENT_ID,
        "markdown",
        &format!("{BLOCKS}/markdown-5.md"),
        "x",
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::ProjectNotOpen);
    let error = restore_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        UNKNOWN_ID,
        "markdown",
        &format!("{BLOCKS}/markdown-5.md"),
        "x",
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    assert_eq!(tree_snapshot(&root), before);
}

#[cfg(unix)]
#[test]
fn restore_does_not_write_through_a_symlinked_blocks_directory() {
    use std::os::unix::fs::symlink;
    let mut opened = opened_and_loaded();
    let outside = opened.temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let blocks = sheet_dir(&opened.root, "details").join("blocks");
    fs::remove_dir_all(&blocks).unwrap();
    symlink(&outside, &blocks).unwrap();

    assert_eq!(
        restore(
            &mut opened,
            "markdown",
            "sheets/details/blocks/markdown-1.md",
            "x"
        ),
        Err(persistence(PersistenceErrorKind::PathOutsideRoot))
    );
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
}

// ---- delete_sheet / delete_document ----

fn without_prefix(
    snapshot: &std::collections::BTreeMap<String, Option<Vec<u8>>>,
    prefix: &str,
) -> std::collections::BTreeMap<String, Option<Vec<u8>>> {
    let nested = format!("{prefix}/");
    snapshot
        .iter()
        .filter(|(path, _)| path.as_str() != prefix && !path.starts_with(&nested))
        .map(|(path, value)| (path.clone(), value.clone()))
        .collect()
}

#[test]
fn delete_sheet_removes_only_that_directory_and_the_session_forgets_it() {
    let mut opened = opened_and_loaded();
    read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        DETAILS_MARKDOWN_PATH,
    )
    .unwrap();
    read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
    )
    .unwrap();
    let details_key = format!("{DOCUMENT_PREFIX}/{DETAILS_MARKDOWN_PATH}");
    let overview_key = format!("{DOCUMENT_PREFIX}/{OVERVIEW_MARKDOWN_PATH}");
    assert!(ledger_hash(&opened.sessions, &details_key).is_some());
    let before = tree_snapshot(&opened.root);

    delete_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        DETAILS_SHEET_ID,
    )
    .unwrap();

    let after = tree_snapshot(&opened.root);
    assert!(!sheet_dir(&opened.root, "details").exists());
    assert_eq!(
        after,
        without_prefix(&before, "documents/system-design/sheets/details")
    );
    assert!(ledger_hash(&opened.sessions, &details_key).is_none());
    assert!(ledger_hash(&opened.sessions, &overview_key).is_some());

    let payload: SheetDto = serde_json::from_value(json!({
        "schemaVersion": 1, "sheetId": DETAILS_SHEET_ID, "name": "Details", "blocks": []
    }))
    .unwrap();
    let error = save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &payload).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    let error = delete_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        DETAILS_SHEET_ID,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);

    // document.json is untouched, so a fresh open reports the stale order entry.
    let mut fresh = ProjectSessions::default();
    open_project(&mut fresh, &opened.root).unwrap();
    let document = load_document(&mut fresh, PROJECT_ID, DOCUMENT_ID).unwrap();
    let missing = issues_of_kind(&document.issues, LoadIssueKind::MissingEntity);
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].entity_id.as_deref(), Some(DETAILS_SHEET_ID));
    assert_eq!(document.sheets.len(), 1);
}

#[test]
fn delete_document_removes_only_that_directory_and_the_session_forgets_it() {
    let mut opened = opened_and_loaded();
    let before = tree_snapshot(&opened.root);

    delete_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();

    assert!(!document_dir(&opened.root).exists());
    assert!(opened.root.join("documents").is_dir());
    assert_eq!(
        tree_snapshot(&opened.root),
        without_prefix(&before, DOCUMENT_PREFIX)
    );
    let error = load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    let payload: DocumentDto = serde_json::from_value(json!({
        "schemaVersion": 1, "documentId": DOCUMENT_ID, "name": "x", "sheetOrder": []
    }))
    .unwrap();
    let error = save_document(&mut opened.sessions, PROJECT_ID, &payload).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    let error = delete_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    let error = delete_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_SHEET_ID,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);

    let mut fresh = ProjectSessions::default();
    let snapshot = open_project(&mut fresh, &opened.root).unwrap();
    assert!(snapshot.documents.is_empty());
    assert_eq!(
        issues_of_kind(&snapshot.issues, LoadIssueKind::MissingEntity).len(),
        1
    );
}

#[test]
fn deleting_unknown_entities_or_in_unopened_projects_fails_cleanly() {
    let mut opened = open_copy();
    let before = tree_snapshot(&opened.root);
    // Sheets are only known after load_document.
    let error = delete_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_SHEET_ID,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();

    let sessions = &mut opened.sessions;
    let kind = |result: Result<(), design_dawn_lib::application::error::ApplicationError>| {
        result.unwrap_err().kind
    };
    assert_eq!(
        kind(delete_sheet(sessions, PROJECT_ID, DOCUMENT_ID, UNKNOWN_ID)),
        ErrorKind::EntityNotFound
    );
    assert_eq!(
        kind(delete_sheet(
            sessions,
            PROJECT_ID,
            UNKNOWN_ID,
            OVERVIEW_SHEET_ID
        )),
        ErrorKind::EntityNotFound
    );
    assert_eq!(
        kind(delete_document(sessions, PROJECT_ID, UNKNOWN_ID)),
        ErrorKind::EntityNotFound
    );
    assert_eq!(
        kind(delete_sheet(
            sessions,
            UNKNOWN_ID,
            DOCUMENT_ID,
            OVERVIEW_SHEET_ID
        )),
        ErrorKind::ProjectNotOpen
    );
    assert_eq!(
        kind(delete_document(sessions, UNKNOWN_ID, DOCUMENT_ID)),
        ErrorKind::ProjectNotOpen
    );
    assert_eq!(
        kind(delete_document(sessions, PROJECT_ID, "not-an-id")),
        domain(DomainErrorKind::InvalidEntityId)
    );
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn entities_that_failed_to_load_can_still_be_deleted() {
    let (_temp, root) = project_copy();
    break_sheet(&root, "details");
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).unwrap();
    load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    delete_sheet(&mut sessions, PROJECT_ID, DOCUMENT_ID, DETAILS_SHEET_ID).unwrap();
    assert!(!sheet_dir(&root, "details").exists());
    assert!(sheet_dir(&root, "overview").exists());

    replace_in_file(
        &document_dir(&root).join("document.json"),
        "\"schemaVersion\": 1",
        "\"schemaVersion\": 2",
    );
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).unwrap();
    assert!(load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).is_err());
    delete_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    assert!(!document_dir(&root).exists());
}

#[cfg(unix)]
mod symlink_safety {
    use super::*;
    use std::os::unix::fs::symlink;

    fn assert_refused(result: Result<(), design_dawn_lib::application::error::ApplicationError>) {
        assert_eq!(
            result.unwrap_err().kind,
            persistence(PersistenceErrorKind::PathOutsideRoot)
        );
    }

    #[test]
    fn a_target_directory_that_is_a_symlink_is_refused_and_left_alone() {
        let mut opened = opened_and_loaded();
        let outside = opened.temp.path().join("outside-sheet");
        copy_dir_all(&sheet_dir(&opened.root, "details"), &outside);
        let outside_before = tree_snapshot(&outside);
        let link = sheet_dir(&opened.root, "details");
        fs::remove_dir_all(&link).unwrap();
        symlink(&outside, &link).unwrap();
        let before = tree_snapshot(&opened.root);

        assert_refused(delete_sheet(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            DETAILS_SHEET_ID,
        ));
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(tree_snapshot(&opened.root), before);
        assert_eq!(tree_snapshot(&outside), outside_before);

        let document_link = document_dir(&opened.root);
        let outside_document = opened.temp.path().join("outside-document");
        fs::rename(&document_link, &outside_document).unwrap();
        symlink(&outside_document, &document_link).unwrap();
        let outside_document_before = tree_snapshot(&outside_document);
        assert_refused(delete_document(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
        ));
        assert!(fs::symlink_metadata(&document_link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(tree_snapshot(&outside_document), outside_document_before);
    }

    #[test]
    fn a_symlinked_ancestor_leaving_the_project_is_refused() {
        let mut opened = opened_and_loaded();
        let sheets = document_dir(&opened.root).join("sheets");
        let outside_sheets = opened.temp.path().join("outside-sheets");
        fs::rename(&sheets, &outside_sheets).unwrap();
        symlink(&outside_sheets, &sheets).unwrap();
        let outside_before = tree_snapshot(&outside_sheets);
        assert_refused(delete_sheet(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            OVERVIEW_SHEET_ID,
        ));
        assert_eq!(tree_snapshot(&outside_sheets), outside_before);

        let documents = opened.root.join("documents");
        let outside_documents = opened.temp.path().join("outside-documents");
        fs::rename(&documents, &outside_documents).unwrap();
        symlink(&outside_documents, &documents).unwrap();
        let outside_before = tree_snapshot(&outside_documents);
        assert_refused(delete_document(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
        ));
        assert_eq!(tree_snapshot(&outside_documents), outside_before);
    }

    /// Links to an outside file and an outside directory, placed inside `directory`.
    fn plant_outside_links(
        directory: &Path,
        temp: &Path,
    ) -> (std::path::PathBuf, std::path::PathBuf) {
        let outside_file = temp.join("precious.txt");
        write_text(&outside_file, "keep me");
        let outside_directory = temp.join("precious-dir");
        fs::create_dir(&outside_directory).unwrap();
        write_text(&outside_directory.join("inner.txt"), "keep me too");
        symlink(&outside_file, directory.join("link-to-file")).unwrap();
        symlink(&outside_directory, directory.join("link-to-dir")).unwrap();
        (outside_file, outside_directory)
    }

    fn assert_untouched(outside_file: &Path, outside_directory: &Path) {
        assert_eq!(read_text(outside_file), "keep me");
        assert_eq!(
            read_text(&outside_directory.join("inner.txt")),
            "keep me too"
        );
    }

    #[test]
    fn links_inside_a_deleted_sheet_are_removed_without_touching_their_targets() {
        let mut opened = opened_and_loaded();
        let sheet = sheet_dir(&opened.root, "details");
        let (file, directory) = plant_outside_links(&sheet.join("blocks"), opened.temp.path());
        delete_sheet(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            DETAILS_SHEET_ID,
        )
        .unwrap();
        assert!(!sheet.exists());
        assert_untouched(&file, &directory);
    }

    #[test]
    fn links_inside_a_deleted_document_are_removed_without_touching_their_targets() {
        let mut opened = opened_and_loaded();
        let (file, directory) = plant_outside_links(
            &document_dir(&opened.root).join("assets"),
            opened.temp.path(),
        );
        delete_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
        assert!(!document_dir(&opened.root).exists());
        assert_untouched(&file, &directory);
    }
}
