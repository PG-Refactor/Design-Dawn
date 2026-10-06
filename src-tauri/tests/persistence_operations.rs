//! Create / read / write / delete operations, naming, path safety, `.dawn` resolution and the
//! hash ledger.

mod support;

use std::fs;
use std::path::Path;

use design_dawn_lib::application::asset_import::import_asset;
use design_dawn_lib::application::block_content_operations::{
    create_block_content, delete_block_content, read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::{create_document, load_document};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::project_operations::{
    create_project, open_entry_point, open_project, save_project, EntryPointResolution,
};
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::sheet_operations::{create_sheet, save_sheet};
use design_dawn_lib::domain::entity_id::ProjectId;
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::{ProjectDto, SheetDto};
use design_dawn_lib::infrastructure::filesystem::hashing::sha256_hex;
use serde_json::json;
use support::*;

fn domain(kind: DomainErrorKind) -> ErrorKind {
    ErrorKind::Domain(kind)
}

fn persistence(kind: PersistenceErrorKind) -> ErrorKind {
    ErrorKind::Persistence(kind)
}

fn new_id(suffix: u32) -> String {
    format!("01928f3a-{suffix:04x}-7aaa-8bbb-0123456789ab")
}

fn sheet_payload(sheet_id: &str, name: &str, schema_version: u32) -> SheetDto {
    serde_json::from_value(json!({
        "schemaVersion": schema_version, "sheetId": sheet_id, "name": name, "blocks": []
    }))
    .unwrap()
}

// ---- create_project ----

#[test]
fn create_project_writes_the_layout_and_opens_the_session() {
    let temp = TempDir::new();
    let root = temp.path().join("fresh").join("nested");
    let mut sessions = ProjectSessions::default();
    let snapshot = create_project(&mut sessions, &root, "Brand New").unwrap();

    assert_eq!(snapshot.project.name, "Brand New");
    assert!(snapshot.project.child_order.is_empty());
    let project_text = read_text(&root.join("project.json"));
    assert!(project_text.ends_with("}\n"));
    assert!(project_text.contains("\"childOrder\": []"));
    assert!(root.join("documents").is_dir());
    assert_eq!(
        read_text(&root.join(".gitattributes")),
        "* text=auto eol=lf\n*.png binary\n*.jpg binary\n*.jpeg binary\n*.webp binary\n*.gif binary\n"
    );

    // The created session is immediately usable, and a fresh open agrees with it.
    create_document(
        &mut sessions,
        &snapshot.project.project_id,
        &new_id(1),
        "First",
        None,
    )
    .unwrap();
    let reopened = open_project(&mut ProjectSessions::default(), &root).unwrap();
    assert_eq!(reopened.project.project_id, snapshot.project.project_id);
    assert_eq!(reopened.project.name, "Brand New");
    // The Document exists on disk but is unlisted until the TS layer saves the project.
    assert_eq!(reopened.documents.len(), 1);
    assert_eq!(reopened.issues.len(), 1);
}

#[test]
fn create_project_accepts_an_existing_git_repository_and_keeps_its_files() {
    let temp = TempDir::new();
    let root = temp.path().join("repo");
    fs::create_dir_all(root.join(".git")).unwrap();
    write_text(&root.join(".git").join("HEAD"), "ref: refs/heads/main\n");
    write_text(&root.join("README.md"), "# Existing\n");
    write_text(&root.join(".gitattributes"), "* text=auto\n");

    create_project(&mut ProjectSessions::default(), &root, "In Repo").unwrap();

    assert!(root.join("project.json").is_file());
    assert!(root.join("documents").is_dir());
    assert_eq!(read_text(&root.join("README.md")), "# Existing\n");
    assert_eq!(
        read_text(&root.join(".git").join("HEAD")),
        "ref: refs/heads/main\n"
    );
    // The user's .gitattributes is never modified.
    assert_eq!(read_text(&root.join(".gitattributes")), "* text=auto\n");
}

#[test]
fn create_project_refuses_an_existing_documents_directory_and_changes_nothing() {
    let temp = TempDir::new();
    let root = temp.path().join("half");
    fs::create_dir_all(root.join("documents")).unwrap();
    let before = tree_snapshot(&root);
    let error = create_project(&mut ProjectSessions::default(), &root, "Half").unwrap_err();
    assert_eq!(error.kind, persistence(PersistenceErrorKind::AlreadyExists));
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn create_project_refuses_an_existing_project_and_changes_nothing() {
    let (_temp, root) = project_copy();
    let before = tree_snapshot(&root);
    let error = create_project(&mut ProjectSessions::default(), &root, "Overwrite").unwrap_err();
    assert_eq!(error.kind, persistence(PersistenceErrorKind::AlreadyExists));
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn create_project_validates_the_name_before_touching_the_disk() {
    let temp = TempDir::new();
    let error = create_project(
        &mut ProjectSessions::default(),
        &temp.path().join("p"),
        "  ",
    )
    .unwrap_err();
    assert_eq!(error.kind, domain(DomainErrorKind::InvalidDisplayName));
    assert!(!temp.path().join("p").exists());
}

// ---- create_document / create_sheet and naming ----

#[test]
fn documents_get_slug_directories_with_fallbacks_and_collision_suffixes() {
    let mut opened = open_copy();
    let names = [
        // The fixture already owns `system-design`.
        ("System Design", "system-design-2"),
        ("SYSTEM DESIGN", "system-design-3"),
        ("設計書", "document-1"),
        ("設計書", "document-2"),
        ("CON", "document-3"),
        ("Plan v2!", "plan-v2"),
    ];
    for (index, (name, expected_directory)) in names.iter().enumerate() {
        let document_id = new_id(index as u32 + 10);
        let snapshot =
            create_document(&mut opened.sessions, PROJECT_ID, &document_id, name, None).unwrap();
        assert_eq!(snapshot.document.name, *name);
        assert_eq!(snapshot.document.document_id, document_id);
        let directory = opened.root.join("documents").join(expected_directory);
        assert!(
            directory.join("document.json").is_file(),
            "{expected_directory}"
        );
        assert!(directory.join("sheets").is_dir());
        assert!(directory.join("assets").is_dir());
    }
    // Creation does not touch project.json; adding to childOrder is a separate save.
    assert!(!read_text(&opened.root.join("project.json")).contains(&new_id(10)));
}

#[test]
fn creating_a_document_with_a_known_id_or_a_bad_name_is_rejected() {
    let mut opened = open_copy();
    let before = tree_snapshot(&opened.root);
    let error =
        create_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, "Again", None).unwrap_err();
    assert_eq!(error.kind, domain(DomainErrorKind::DuplicateId));
    let error =
        create_document(&mut opened.sessions, PROJECT_ID, "nope", "Name", None).unwrap_err();
    assert_eq!(error.kind, domain(DomainErrorKind::InvalidEntityId));
    let error =
        create_document(&mut opened.sessions, PROJECT_ID, &new_id(2), "", None).unwrap_err();
    assert_eq!(error.kind, domain(DomainErrorKind::InvalidDisplayName));
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn sheets_never_overwrite_existing_directories() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let before_overview = read_text(&sheet_dir(&opened.root, "overview").join("sheet.json"));
    let created = [
        ("Overview", "overview-2"),
        ("OVERVIEW", "overview-3"),
        ("概要", "sheet-1"),
    ];
    for (index, (name, expected_directory)) in created.iter().enumerate() {
        let sheet_id = new_id(index as u32 + 100);
        let snapshot = create_sheet(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            &sheet_id,
            name,
        )
        .unwrap();
        assert_eq!(snapshot.sheet.unwrap().blocks.len(), 0);
        let directory = sheet_dir(&opened.root, expected_directory);
        assert!(directory.join("sheet.json").is_file());
        assert!(directory.join("blocks").is_dir());
    }
    assert_eq!(
        read_text(&sheet_dir(&opened.root, "overview").join("sheet.json")),
        before_overview
    );
    let duplicate = create_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_SHEET_ID,
        "Dup",
    )
    .unwrap_err();
    assert_eq!(duplicate.kind, domain(DomainErrorKind::DuplicateId));
    let unknown_document = create_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        UNKNOWN_ID,
        &new_id(300),
        "X",
    )
    .unwrap_err();
    assert_eq!(unknown_document.kind, ErrorKind::EntityNotFound);
}

#[test]
fn created_sheets_can_be_saved_and_survive_a_reload() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let sheet_id = new_id(400);
    create_sheet(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        &sheet_id,
        "Fresh",
    )
    .unwrap();
    let payload = sheet_payload(&sheet_id, "Fresh renamed", 1);
    assert!(
        save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &payload)
            .unwrap()
            .written
    );

    let reloaded = load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let fresh = reloaded
        .sheets
        .iter()
        .find(|s| s.sheet_id == sheet_id)
        .unwrap();
    assert_eq!(fresh.name.as_deref(), Some("Fresh renamed"));
    // Unlisted in document.sheetOrder until the Document is saved with the effective order.
    assert_eq!(reloaded.document.sheet_order.last().unwrap(), &sheet_id);
}

// ---- block content ----

#[test]
fn block_content_files_are_numbered_without_collisions() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let mut create = |block_type: &str, text: &str| {
        create_block_content(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            OVERVIEW_SHEET_ID,
            block_type,
            text,
        )
    };
    assert_eq!(
        create("markdown", "a\r\nb").unwrap(),
        "sheets/overview/blocks/markdown-2.md"
    );
    assert_eq!(
        create("markdown", "").unwrap(),
        "sheets/overview/blocks/markdown-3.md"
    );
    assert_eq!(
        create("mermaid", "graph LR").unwrap(),
        "sheets/overview/blocks/mermaid-2.mmd"
    );
    assert_eq!(
        create("image", "").unwrap_err().kind,
        domain(DomainErrorKind::UnsupportedBlockType)
    );
    assert_eq!(
        create("bogus", "").unwrap_err().kind,
        domain(DomainErrorKind::UnsupportedBlockType)
    );

    let blocks = sheet_dir(&opened.root, "overview").join("blocks");
    assert!(read_text(&blocks.join("markdown-1.md")).starts_with("# Overview"));
    assert_eq!(fs::read(blocks.join("markdown-2.md")).unwrap(), b"a\nb");
}

#[test]
fn block_text_round_trips_and_follows_the_encoding_rules() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let file = sheet_dir(&opened.root, "overview").join("blocks/markdown-1.md");

    let saved = write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "日本語\r\nline2\r\nno newline",
    )
    .unwrap();
    assert!(saved.written);
    assert_eq!(
        fs::read(&file).unwrap(),
        "日本語\nline2\nno newline".as_bytes()
    );

    // Externally created BOM + CRLF file: BOM is dropped on read, CRLF is kept as is.
    fs::write(&file, b"\xEF\xBB\xBFcrlf\r\nfile").unwrap();
    let text = read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
    )
    .unwrap();
    assert_eq!(text, "crlf\r\nfile");

    fs::write(&file, [0x61, 0xFF, 0x62]).unwrap();
    let error = read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
    )
    .unwrap_err();
    assert_eq!(
        error.kind,
        persistence(PersistenceErrorKind::InvalidEncoding)
    );
}

#[test]
fn writing_a_missing_content_file_fails_instead_of_creating_it() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let error = write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        "sheets/overview/blocks/absent.md",
        "x",
    )
    .unwrap_err();
    assert_eq!(error.kind, persistence(PersistenceErrorKind::FileNotFound));
    assert!(!sheet_dir(&opened.root, "overview")
        .join("blocks/absent.md")
        .exists());
}

#[test]
fn delete_block_content_removes_only_that_file_and_forgets_its_hash() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MERMAID_PATH,
    )
    .unwrap();
    let key = format!("documents/system-design/{OVERVIEW_MERMAID_PATH}");
    assert!(ledger_hash(&opened.sessions, &key).is_some());

    delete_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MERMAID_PATH,
    )
    .unwrap();
    assert!(!sheet_dir(&opened.root, "overview")
        .join("blocks/mermaid-1.mmd")
        .exists());
    assert!(sheet_dir(&opened.root, "overview")
        .join("blocks/markdown-1.md")
        .exists());
    assert!(ledger_hash(&opened.sessions, &key).is_none());
    let error = delete_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MERMAID_PATH,
    )
    .unwrap_err();
    assert_eq!(error.kind, persistence(PersistenceErrorKind::FileNotFound));
}

#[test]
fn content_paths_are_validated_by_the_domain_rules() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let cases = [
        ("../project.json", DomainErrorKind::InvalidContentPath),
        ("/etc/passwd", DomainErrorKind::InvalidContentPath),
        (
            "sheets\\overview\\blocks\\markdown-1.md",
            DomainErrorKind::InvalidContentPath,
        ),
        ("assets/pixel.png", DomainErrorKind::InvalidContentPath),
        (
            "sheets/overview/blocks/markdown-1.txt",
            DomainErrorKind::InvalidContentExtension,
        ),
        ("", DomainErrorKind::InvalidContentPath),
    ];
    for (path, expected) in cases {
        let error =
            read_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, path).unwrap_err();
        assert_eq!(error.kind, domain(expected), "{path:?}");
        let error = write_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, path, "x")
            .unwrap_err();
        assert_eq!(error.kind, domain(expected), "{path:?}");
    }
}

#[cfg(unix)]
mod symlink_escape {
    use super::*;
    use design_dawn_lib::application::load_issue::LoadIssueKind;
    use std::os::unix::fs::symlink;

    #[test]
    fn a_content_file_that_is_a_symlink_out_of_the_document_is_refused() {
        let mut opened = open_copy();
        let outside = opened.temp.path().join("secret.md");
        write_text(&outside, "secret");
        symlink(
            &outside,
            sheet_dir(&opened.root, "overview").join("blocks/link.md"),
        )
        .unwrap();
        let path = "sheets/overview/blocks/link.md";

        let error =
            read_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, path).unwrap_err();
        assert_eq!(
            error.kind,
            persistence(PersistenceErrorKind::PathOutsideRoot)
        );
        load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
        let error =
            write_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, path, "pwned")
                .unwrap_err();
        assert_eq!(
            error.kind,
            persistence(PersistenceErrorKind::PathOutsideRoot)
        );
        let error =
            delete_block_content(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, path).unwrap_err();
        assert_eq!(
            error.kind,
            persistence(PersistenceErrorKind::PathOutsideRoot)
        );
        assert_eq!(read_text(&outside), "secret");
    }

    #[test]
    fn deleting_content_that_is_a_symlink_removes_the_link_not_its_target() {
        let mut opened = open_copy();
        let blocks = sheet_dir(&opened.root, "overview").join("blocks");
        let target = blocks.join("markdown-1.md");
        let original = read_text(&target);
        symlink(&target, blocks.join("link.md")).unwrap();
        load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();

        delete_block_content(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            "sheets/overview/blocks/link.md",
        )
        .unwrap();

        assert!(fs::symlink_metadata(blocks.join("link.md")).is_err());
        assert_eq!(read_text(&target), original);
    }

    #[test]
    fn a_block_pointing_through_an_escaping_link_is_reported_as_missing_content() {
        let mut opened = open_copy();
        let outside = opened.temp.path().join("secret.md");
        write_text(&outside, "secret");
        symlink(
            &outside,
            sheet_dir(&opened.root, "details").join("blocks/link.md"),
        )
        .unwrap();
        replace_in_file(
            &sheet_dir(&opened.root, "details").join("sheet.json"),
            "markdown-1.md",
            "link.md",
        );
        let document = load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
        let missing = issues_of_kind(&document.issues, LoadIssueKind::MissingContent);
        assert_eq!(missing.len(), 1);
        assert!(
            missing[0].detail.contains("pathOutsideRoot"),
            "{}",
            missing[0].detail
        );
    }

    #[test]
    fn a_blocks_directory_that_is_a_symlink_outside_is_never_written_through() {
        let mut opened = open_copy();
        load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
        let outside = opened.temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        let blocks = sheet_dir(&opened.root, "details").join("blocks");
        fs::remove_dir_all(&blocks).unwrap();
        symlink(&outside, &blocks).unwrap();

        let error = create_block_content(
            &mut opened.sessions,
            PROJECT_ID,
            DOCUMENT_ID,
            DETAILS_SHEET_ID,
            "markdown",
            "x",
        )
        .unwrap_err();
        assert_eq!(
            error.kind,
            persistence(PersistenceErrorKind::PathOutsideRoot)
        );
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }

    #[test]
    fn a_symlinked_document_directory_leaving_the_project_is_not_followed() {
        let mut opened = open_copy();
        let outside = opened.temp.path().join("elsewhere");
        copy_dir_all(&document_dir(&opened.root), &outside);
        symlink(&outside, opened.root.join("documents/linked")).unwrap();
        let snapshot = open_project(&mut opened.sessions, &opened.root).unwrap();
        assert_eq!(snapshot.documents.len(), 1);
        let failed: Vec<_> = snapshot
            .issues
            .iter()
            .filter(|issue| issue.path.as_deref() == Some("documents/linked"))
            .collect();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].kind, LoadIssueKind::UnrecognizedDirectory);
        assert!(
            failed[0].detail.contains("symbolic link"),
            "{}",
            failed[0].detail
        );
    }

    #[test]
    fn an_asset_import_does_not_follow_a_symlinked_assets_directory_out() {
        let mut opened = open_copy();
        let outside = opened.temp.path().join("outside-assets");
        fs::create_dir(&outside).unwrap();
        let assets = document_dir(&opened.root).join("assets");
        fs::remove_dir_all(&assets).unwrap();
        symlink(&outside, &assets).unwrap();
        let source = opened.temp.path().join("pic.png");
        fs::write(&source, png_bytes(1, 1)).unwrap();
        let error =
            import_asset(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &source).unwrap_err();
        assert_eq!(
            error.kind,
            persistence(PersistenceErrorKind::PathOutsideRoot)
        );
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }
}

// ---- asset import ----

#[test]
fn imported_assets_get_sanitized_unique_names_and_never_overwrite() {
    let mut opened = open_copy();
    let source = opened.temp.path().join("My Pic (1).PNG");
    let first_bytes = png_bytes(1, 1);
    let second_bytes = png_bytes(2, 2);
    fs::write(&source, &first_bytes).unwrap();
    let first = import_asset(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &source)
        .unwrap()
        .content_path;
    assert_eq!(first, "assets/my-pic-1.png");
    fs::write(&source, &second_bytes).unwrap();
    let second = import_asset(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &source)
        .unwrap()
        .content_path;
    assert_eq!(second, "assets/my-pic-1-2.png");

    let assets = document_dir(&opened.root).join("assets");
    assert_eq!(fs::read(assets.join("my-pic-1.png")).unwrap(), first_bytes);
    assert_eq!(
        fs::read(assets.join("my-pic-1-2.png")).unwrap(),
        second_bytes
    );
    assert_eq!(fs::read(&source).unwrap(), second_bytes);

    let unsupported = opened.temp.path().join("tool.exe");
    fs::write(&unsupported, b"x").unwrap();
    let error =
        import_asset(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &unsupported).unwrap_err();
    assert_eq!(error.kind, domain(DomainErrorKind::InvalidContentExtension));
    let absent = opened.temp.path().join("absent.png");
    let error = import_asset(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &absent).unwrap_err();
    assert_eq!(error.kind, persistence(PersistenceErrorKind::FileNotFound));
}

// ---- session errors and payload validation ----

#[test]
fn unknown_projects_and_entities_have_distinct_errors() {
    let mut opened = open_copy();
    let error = load_document(&mut opened.sessions, UNKNOWN_ID, DOCUMENT_ID).unwrap_err();
    assert_eq!(error.kind, ErrorKind::ProjectNotOpen);
    let error = load_document(&mut opened.sessions, "bad", DOCUMENT_ID).unwrap_err();
    assert_eq!(error.kind, domain(DomainErrorKind::InvalidEntityId));
    let error = load_document(&mut opened.sessions, PROJECT_ID, UNKNOWN_ID).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);

    // Sheets are only known after load_document.
    let payload = sheet_payload(OVERVIEW_SHEET_ID, "X", 1);
    let error = save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &payload).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    assert!(save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &payload).is_ok());
    let error = write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        "sheets/ghost/blocks/a.md",
        "x",
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
}

#[test]
fn saves_revalidate_payloads_through_the_domain() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    let before = tree_snapshot(&opened.root);
    let block = |x: serde_json::Value, path: &str| {
        json!({
            "blockId": new_id(900), "blockType": "markdown",
            "position": {"x": x, "y": 0}, "size": {"width": 10, "height": 10}, "contentPath": path
        })
    };
    let sheet = |schema: u32, blocks: Vec<serde_json::Value>| -> SheetDto {
        serde_json::from_value(json!({
            "schemaVersion": schema, "sheetId": OVERVIEW_SHEET_ID, "name": "Overview", "blocks": blocks
        }))
        .unwrap()
    };
    let cases = [
        (
            sheet(
                1,
                vec![block(json!(1.5), "sheets/overview/blocks/markdown-1.md")],
            ),
            DomainErrorKind::InvalidPosition,
        ),
        (
            sheet(1, vec![block(json!(0), "../escape.md")]),
            DomainErrorKind::InvalidContentPath,
        ),
        (
            sheet(
                1,
                vec![block(json!(0), "sheets/overview/blocks/markdown-1.mmd")],
            ),
            DomainErrorKind::InvalidContentExtension,
        ),
        (sheet(2, vec![]), DomainErrorKind::UnsupportedSchemaVersion),
        (
            sheet(
                1,
                vec![block(
                    json!(3_000_000_000_i64),
                    "sheets/overview/blocks/markdown-1.md",
                )],
            ),
            DomainErrorKind::InvalidPosition,
        ),
    ];
    for (payload, expected) in cases {
        let error =
            save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &payload).unwrap_err();
        assert_eq!(error.kind, domain(expected));
    }
    let mut project: ProjectDto = opened.snapshot.project.clone();
    project.project_id = UNKNOWN_ID.to_owned();
    let error = save_project(&mut opened.sessions, PROJECT_ID, &project).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
    assert_eq!(tree_snapshot(&opened.root), before);
}

#[test]
fn reopening_a_project_replaces_its_session() {
    let mut opened = open_copy();
    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    open_project(&mut opened.sessions, &opened.root).unwrap();
    // Sheets are unknown again until the next load_document.
    let payload = sheet_payload(OVERVIEW_SHEET_ID, "X", 1);
    let error = save_sheet(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID, &payload).unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
}

// ---- .dawn ----

fn open_dawn(
    root: &Path,
    file: &str,
) -> Result<
    design_dawn_lib::application::project_operations::OpenedEntryPoint,
    design_dawn_lib::application::error::ApplicationError,
> {
    open_entry_point(&mut ProjectSessions::default(), &root.join(file))
}

#[test]
fn entry_point_opens_the_document_named_by_its_path() {
    let (_temp, root) = project_copy();
    let opened = open_dawn(&root, "system-design.dawn").unwrap();
    assert_eq!(opened.resolution, EntryPointResolution::Path);
    assert_eq!(opened.snapshot.document_id, DOCUMENT_ID);
    assert_eq!(opened.snapshot.snapshot.project.project_id, PROJECT_ID);
}

#[test]
fn entry_point_falls_back_to_scanning_by_document_id() {
    let (_temp, root) = project_copy();
    write_json(
        &root.join("system-design.dawn"),
        &json!({"schemaVersion": 1, "documentId": DOCUMENT_ID, "path": "documents/renamed-by-hand"}),
    );
    let opened = open_dawn(&root, "system-design.dawn").unwrap();
    assert_eq!(opened.resolution, EntryPointResolution::IdScan);
    assert_eq!(opened.snapshot.document_id, DOCUMENT_ID);

    // A hostile path is just a miss: it is never followed.
    write_json(
        &root.join("system-design.dawn"),
        &json!({"schemaVersion": 1, "documentId": DOCUMENT_ID, "path": "../../etc"}),
    );
    let opened = open_dawn(&root, "system-design.dawn").unwrap();
    assert_eq!(opened.resolution, EntryPointResolution::IdScan);
}

#[test]
fn entry_point_errors_when_the_document_is_nowhere() {
    let (_temp, root) = project_copy();
    write_json(
        &root.join("system-design.dawn"),
        &json!({"schemaVersion": 1, "documentId": UNKNOWN_ID, "path": "documents/system-design"}),
    );
    let error = open_dawn(&root, "system-design.dawn").unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
}

#[test]
fn entry_point_finds_the_project_above_it() {
    let (temp, root) = project_copy();
    fs::create_dir_all(root.join("shortcuts/deep")).unwrap();
    fs::copy(
        root.join("system-design.dawn"),
        root.join("shortcuts/deep/link.dawn"),
    )
    .unwrap();
    let opened = open_dawn(&root, "shortcuts/deep/link.dawn").unwrap();
    // The stored path is relative to the .dawn directory, which is not the project root here.
    assert_eq!(opened.resolution, EntryPointResolution::IdScan);
    assert_eq!(opened.snapshot.document_id, DOCUMENT_ID);

    let orphan = temp.path().join("orphan.dawn");
    fs::copy(root.join("system-design.dawn"), &orphan).unwrap();
    let error = open_entry_point(&mut ProjectSessions::default(), &orphan).unwrap_err();
    assert_eq!(error.kind, persistence(PersistenceErrorKind::FileNotFound));
}

#[test]
fn entry_point_rejects_malformed_files() {
    let (_temp, root) = project_copy();
    let valid_path = "documents/system-design";
    let cases = [
        (
            "unknown key",
            json!({"schemaVersion": 1, "documentId": DOCUMENT_ID, "path": valid_path, "x": 1}),
            persistence(PersistenceErrorKind::InvalidFileStructure),
        ),
        (
            "newer schema",
            json!({"schemaVersion": 2, "documentId": DOCUMENT_ID, "path": valid_path}),
            domain(DomainErrorKind::UnsupportedSchemaVersion),
        ),
        (
            "bad id",
            json!({"schemaVersion": 1, "documentId": "nope", "path": valid_path}),
            domain(DomainErrorKind::InvalidEntityId),
        ),
    ];
    for (label, value, expected) in cases {
        write_json(&root.join("system-design.dawn"), &value);
        let error = open_dawn(&root, "system-design.dawn").unwrap_err();
        assert_eq!(error.kind, expected, "{label}");
    }
    let error = open_dawn(&root, "absent.dawn").unwrap_err();
    assert_eq!(error.kind, persistence(PersistenceErrorKind::FileNotFound));
}

// ---- hash ledger ----

fn ledger_hash(sessions: &ProjectSessions, key: &str) -> Option<String> {
    let project_id = ProjectId::parse(PROJECT_ID).unwrap();
    sessions
        .get(&project_id)
        .unwrap()
        .ledger()
        .hash_of(key)
        .map(str::to_owned)
}

fn file_hash(path: &Path) -> String {
    sha256_hex(&fs::read(path).unwrap())
}

#[test]
fn the_ledger_records_every_read_and_write_with_the_sha256_of_the_bytes() {
    let mut opened = open_copy();
    let root = opened.root.clone();
    assert_eq!(
        ledger_hash(&opened.sessions, "project.json"),
        Some(file_hash(&root.join("project.json")))
    );
    assert_eq!(
        ledger_hash(&opened.sessions, "documents/system-design/document.json"),
        Some(file_hash(&document_dir(&root).join("document.json")))
    );

    load_document(&mut opened.sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    assert_eq!(
        ledger_hash(
            &opened.sessions,
            "documents/system-design/sheets/details/sheet.json"
        ),
        Some(file_hash(&sheet_dir(&root, "details").join("sheet.json")))
    );

    // Reads hash the raw bytes on disk (BOM included), not the decoded text.
    let markdown = sheet_dir(&root, "overview").join("blocks/markdown-1.md");
    fs::write(&markdown, b"\xEF\xBB\xBFbom").unwrap();
    read_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
    )
    .unwrap();
    let key = format!("documents/system-design/{OVERVIEW_MARKDOWN_PATH}");
    assert_eq!(
        ledger_hash(&opened.sessions, &key),
        Some(file_hash(&markdown))
    );

    write_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "new\r\ntext",
    )
    .unwrap();
    assert_eq!(fs::read(&markdown).unwrap(), b"new\ntext");
    assert_eq!(
        ledger_hash(&opened.sessions, &key),
        Some(file_hash(&markdown))
    );

    let created = create_block_content(
        &mut opened.sessions,
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_SHEET_ID,
        "mermaid",
        "graph TD",
    )
    .unwrap();
    assert_eq!(
        ledger_hash(
            &opened.sessions,
            &format!("documents/system-design/{created}")
        ),
        Some(file_hash(&document_dir(&root).join(&created)))
    );

    let mut project = opened.snapshot.project.clone();
    project.name = "Changed".to_owned();
    save_project(&mut opened.sessions, PROJECT_ID, &project).unwrap();
    assert_eq!(
        ledger_hash(&opened.sessions, "project.json"),
        Some(file_hash(&root.join("project.json")))
    );
}

#[test]
fn opening_through_an_entry_point_records_the_dawn_file_too() {
    let (_temp, root) = project_copy();
    let mut sessions = ProjectSessions::default();
    open_entry_point(&mut sessions, &root.join("system-design.dawn")).unwrap();
    assert_eq!(
        ledger_hash(&sessions, "system-design.dawn"),
        Some(file_hash(&root.join("system-design.dawn")))
    );
}
