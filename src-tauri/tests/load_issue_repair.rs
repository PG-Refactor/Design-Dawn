//! The explicit repair of Load Issues: each kind's actions, the
//! dry run that writes nothing, the refusals (stale issue, wrong action, external change,
//! unsafe reference), and that no result contains an absolute path.

mod support;

use std::fs;
use std::path::Path;

use design_dawn_lib::application::document_operations::load_document;
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::load_issue::{LoadIssue, LoadIssueKind};
use design_dawn_lib::application::load_issue_repair::{
    repair_load_issue, RepairAction, RepairIssueRef, RepairOutcome, RepairUnavailable,
};
use design_dawn_lib::application::project_operations::open_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use serde_json::json;
use support::*;

struct Setup {
    _temp: TempDir,
    root: std::path::PathBuf,
    sessions: ProjectSessions,
    project_issues: Vec<LoadIssue>,
    document_issues: Vec<LoadIssue>,
}

/// Opens the project in `root` and loads the sample document, as the app does.
fn open(temp: TempDir, root: std::path::PathBuf) -> Setup {
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, &root).expect("open");
    let document = load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).expect("load document");
    Setup {
        _temp: temp,
        root,
        sessions,
        project_issues: snapshot.issues,
        document_issues: document.issues,
    }
}

fn setup_with(prepare: impl FnOnce(&Path)) -> Setup {
    let (temp, root) = project_copy();
    prepare(&root);
    open(temp, root)
}

fn reference(issue: &LoadIssue) -> RepairIssueRef {
    RepairIssueRef {
        kind: issue.kind,
        path: issue.path.clone(),
        entity_id: issue.entity_id.clone(),
    }
}

fn first_of(issues: &[LoadIssue], kind: LoadIssueKind) -> RepairIssueRef {
    reference(
        issues
            .iter()
            .find(|issue| issue.kind == kind)
            .unwrap_or_else(|| panic!("no {kind:?} issue in {issues:?}")),
    )
}

impl Setup {
    fn repair(
        &mut self,
        document: bool,
        issue: &RepairIssueRef,
        action: RepairAction,
        dry_run: bool,
    ) -> RepairOutcome {
        let outcome = repair_load_issue(
            &mut self.sessions,
            PROJECT_ID,
            document.then_some(DOCUMENT_ID),
            issue,
            action,
            dry_run,
        )
        .expect("repair");
        let text = serde_json::to_string(&outcome).unwrap();
        assert!(
            !text.contains(self.root.to_str().unwrap()),
            "no absolute path in {text}"
        );
        outcome
    }

    fn project_repair(&mut self, kind: LoadIssueKind, action: RepairAction) -> RepairOutcome {
        let issue = first_of(&self.project_issues, kind);
        self.repair(false, &issue, action, false)
    }

    fn document_repair(&mut self, kind: LoadIssueKind, action: RepairAction) -> RepairOutcome {
        let issue = first_of(&self.document_issues, kind);
        self.repair(true, &issue, action, false)
    }

    /// Reads the Project and the Document again, like the Frontend does after a repair.
    fn reload(&mut self) -> (Vec<LoadIssue>, Vec<LoadIssue>) {
        let project = open_project(&mut self.sessions, &self.root).unwrap().issues;
        let document = load_document(&mut self.sessions, PROJECT_ID, DOCUMENT_ID)
            .unwrap()
            .issues;
        (project, document)
    }
}

fn set_json(path: &Path, key: &str, value: serde_json::Value) {
    let mut json = read_json(path);
    json[key] = value;
    write_json(path, &json);
}

#[test]
fn an_unlisted_document_is_added_to_the_project_list() {
    let mut setup =
        setup_with(|root| set_json(&root.join("project.json"), "childOrder", json!([])));
    let issue = first_of(&setup.project_issues, LoadIssueKind::UnlistedEntity);
    let before = tree_snapshot(&setup.root);

    let plan = setup.repair(false, &issue, RepairAction::AddToList, true);
    assert!(!plan.applied);
    assert_eq!(plan.files, ["project.json"]);
    assert_eq!(
        tree_snapshot(&setup.root),
        before,
        "a dry run writes nothing"
    );

    let outcome = setup.repair(false, &issue, RepairAction::AddToList, false);
    assert!(outcome.applied);
    assert!(outcome.issues.is_empty(), "{:?}", outcome.issues);
    assert_eq!(
        read_json(&setup.root.join("project.json"))["childOrder"],
        json!([DOCUMENT_ID])
    );
    assert!(setup.reload().0.is_empty());
}

#[test]
fn an_unlisted_sheet_is_added_to_the_document_list() {
    let mut setup = setup_with(|root| {
        set_json(
            &document_dir(root).join("document.json"),
            "sheetOrder",
            json!([OVERVIEW_SHEET_ID]),
        )
    });
    let outcome = setup.document_repair(LoadIssueKind::UnlistedEntity, RepairAction::AddToList);
    assert_eq!(outcome.files, ["documents/system-design/document.json"]);
    assert_eq!(
        read_json(&document_dir(&setup.root).join("document.json"))["sheetOrder"],
        json!([OVERVIEW_SHEET_ID, DETAILS_SHEET_ID])
    );
    assert!(setup.reload().1.is_empty());
}

#[test]
fn a_listed_entry_that_does_not_exist_is_removed_from_the_list() {
    let mut setup = setup_with(|root| {
        set_json(
            &root.join("project.json"),
            "childOrder",
            json!([UNKNOWN_ID, DOCUMENT_ID]),
        );
        set_json(
            &document_dir(root).join("document.json"),
            "sheetOrder",
            json!([DETAILS_SHEET_ID, UNKNOWN_ID, OVERVIEW_SHEET_ID]),
        );
    });
    setup.project_repair(LoadIssueKind::MissingEntity, RepairAction::RemoveFromList);
    setup.document_repair(LoadIssueKind::MissingEntity, RepairAction::RemoveFromList);

    assert_eq!(
        read_json(&setup.root.join("project.json"))["childOrder"],
        json!([DOCUMENT_ID])
    );
    // The order of the entries that remain is kept.
    assert_eq!(
        read_json(&document_dir(&setup.root).join("document.json"))["sheetOrder"],
        json!([DETAILS_SHEET_ID, OVERVIEW_SHEET_ID])
    );
    let (project, document) = setup.reload();
    assert!(project.is_empty() && document.is_empty());
}

#[test]
fn invalid_and_repeated_order_entries_are_removed() {
    let mut setup = setup_with(|root| {
        set_json(
            &root.join("project.json"),
            "childOrder",
            json!([DOCUMENT_ID, "not-an-id", DOCUMENT_ID]),
        )
    });
    let outcome = setup.project_repair(
        LoadIssueKind::InvalidOrderEntry,
        RepairAction::RemoveFromList,
    );
    assert!(outcome.issues.is_empty(), "{:?}", outcome.issues);
    assert_eq!(
        read_json(&setup.root.join("project.json"))["childOrder"],
        json!([DOCUMENT_ID])
    );
}

/// A second copy of the Document directory, so its ID is used twice. `system-design-copy`
/// sorts after `system-design`, so the copy is the one the loader ignores.
fn duplicate_document(root: &Path) {
    copy_dir_all(
        &document_dir(root),
        &root.join("documents/system-design-copy"),
    );
}

#[test]
fn the_ignored_copy_of_a_document_gets_a_new_id_and_its_entry_point_follows() {
    let mut setup = setup_with(|root| {
        duplicate_document(root);
        write_json(
            &root.join("copy.dawn"),
            &json!({
                "schemaVersion": 1,
                "documentId": DOCUMENT_ID,
                "path": "documents/system-design-copy"
            }),
        );
    });
    let issue = first_of(&setup.project_issues, LoadIssueKind::DuplicateEntityId);
    assert_eq!(issue.path.as_deref(), Some("documents/system-design-copy"));
    let kept_entry_point = read_text(&setup.root.join("system-design.dawn"));

    let plan = setup.repair(false, &issue, RepairAction::GiveNewId, true);
    assert_eq!(
        plan.files,
        ["documents/system-design-copy/document.json", "copy.dawn"]
    );
    setup.repair(false, &issue, RepairAction::GiveNewId, false);

    let copy_document = read_json(
        &setup
            .root
            .join("documents/system-design-copy/document.json"),
    );
    let new_id = copy_document["documentId"].as_str().unwrap().to_owned();
    assert_ne!(new_id, DOCUMENT_ID);
    assert_eq!(
        read_json(&setup.root.join("copy.dawn"))["documentId"],
        new_id
    );
    assert_eq!(
        read_text(&setup.root.join("system-design.dawn")),
        kept_entry_point,
        "the entry point of the kept copy is untouched"
    );
    assert_eq!(
        read_json(&document_dir(&setup.root).join("document.json"))["documentId"],
        DOCUMENT_ID
    );
    let (project, _) = setup.reload();
    assert!(
        issues_of_kind(&project, LoadIssueKind::DuplicateEntityId).is_empty(),
        "{project:?}"
    );
    // The copy was never listed, so it now shows up as an unlisted item the user can add.
    assert_eq!(
        issues_of_kind(&project, LoadIssueKind::UnlistedEntity).len(),
        1
    );
}

#[test]
fn a_new_id_is_not_offered_when_an_entry_point_cannot_be_told_apart() {
    let mut setup = setup_with(|root| {
        duplicate_document(root);
        write_json(
            &root.join("lost.dawn"),
            &json!({
                "schemaVersion": 1,
                "documentId": DOCUMENT_ID,
                "path": "documents/somewhere-else"
            }),
        );
    });
    let issue = first_of(&setup.project_issues, LoadIssueKind::DuplicateEntityId);
    let before = tree_snapshot(&setup.root);

    let outcome = setup.repair(false, &issue, RepairAction::GiveNewId, false);

    assert!(!outcome.applied);
    assert_eq!(
        outcome.unavailable,
        Some(RepairUnavailable::AmbiguousReference)
    );
    assert_eq!(tree_snapshot(&setup.root), before);
}

#[test]
fn a_block_id_used_in_two_sheets_is_changed_in_the_later_sheet_only() {
    let mut setup = setup_with(|root| {
        let details = sheet_dir(root, "details").join("sheet.json");
        let mut sheet = read_json(&details);
        sheet["blocks"][0]["blockId"] = json!(OVERVIEW_MARKDOWN_BLOCK_ID);
        write_json(&details, &sheet);
    });
    let overview_before = read_text(&sheet_dir(&setup.root, "overview").join("sheet.json"));

    let issue = first_of(&setup.document_issues, LoadIssueKind::DuplicateEntityId);
    setup.repair(true, &issue, RepairAction::GiveNewId, false);

    let details = read_json(&sheet_dir(&setup.root, "details").join("sheet.json"));
    assert_ne!(details["blocks"][0]["blockId"], OVERVIEW_MARKDOWN_BLOCK_ID);
    assert_eq!(
        read_text(&sheet_dir(&setup.root, "overview").join("sheet.json")),
        overview_before
    );
    assert!(setup.reload().1.is_empty());
}

#[test]
fn the_ignored_copy_of_a_sheet_gets_a_new_id() {
    let mut setup = setup_with(|root| {
        let blocks = sheet_dir(root, "overview");
        copy_dir_all(&blocks, &sheet_dir(root, "overview-copy"));
    });
    let issues = issues_of_kind(&setup.document_issues, LoadIssueKind::DuplicateEntityId);
    assert_eq!(issues.len(), 1);
    assert!(issues[0]
        .path
        .as_deref()
        .unwrap()
        .ends_with("sheets/overview-copy"));

    setup.document_repair(LoadIssueKind::DuplicateEntityId, RepairAction::GiveNewId);

    let copy = read_json(&sheet_dir(&setup.root, "overview-copy").join("sheet.json"));
    assert_ne!(copy["sheetId"], OVERVIEW_SHEET_ID);
    // The copy's Blocks still repeat the original's Block IDs; only the Sheet ID is resolved.
    let (_, document) = setup.reload();
    assert!(issues_of_kind(&document, LoadIssueKind::DuplicateEntityId)
        .iter()
        .all(|issue| issue.entity_id.as_deref() != Some(OVERVIEW_SHEET_ID)));
}

fn remove_overview_markdown(root: &Path) {
    fs::remove_file(sheet_dir(root, "overview").join("blocks/markdown-1.md")).unwrap();
}

#[test]
fn a_block_without_its_file_can_be_removed() {
    let mut setup = setup_with(remove_overview_markdown);
    let outcome = setup.document_repair(LoadIssueKind::MissingContent, RepairAction::RemoveBlock);
    assert!(outcome.issues.is_empty(), "{:?}", outcome.issues);
    let sheet = read_json(&sheet_dir(&setup.root, "overview").join("sheet.json"));
    let ids: Vec<&str> = sheet["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|block| block["blockId"].as_str().unwrap())
        .collect();
    assert!(!ids.contains(&OVERVIEW_MARKDOWN_BLOCK_ID));
    assert_eq!(ids.len(), 2, "the other Blocks stay, in order");
}

#[test]
fn a_missing_text_file_can_be_created_empty() {
    let mut setup = setup_with(remove_overview_markdown);
    setup.document_repair(
        LoadIssueKind::MissingContent,
        RepairAction::CreateEmptyContent,
    );
    let file = sheet_dir(&setup.root, "overview").join("blocks/markdown-1.md");
    assert_eq!(read_text(&file), "");
    assert!(setup.reload().1.is_empty());
}

#[test]
fn a_missing_image_cannot_be_created_but_its_block_can_be_removed() {
    let mut setup = setup_with(|root| {
        fs::remove_file(document_dir(root).join("assets/pixel.png")).unwrap();
    });
    let issue = first_of(&setup.document_issues, LoadIssueKind::MissingContent);
    let outcome = setup.repair(true, &issue, RepairAction::CreateEmptyContent, false);
    assert_eq!(
        outcome.unavailable,
        Some(RepairUnavailable::UnsupportedContentType)
    );
    let outcome = setup.repair(true, &issue, RepairAction::RemoveBlock, false);
    assert!(outcome.applied);
}

fn add_orphan(root: &Path) {
    write_text(
        &sheet_dir(root, "overview").join("blocks/notes.md"),
        "# Notes\n",
    );
}

#[test]
fn an_orphan_text_file_is_added_below_the_lowest_block() {
    let mut setup = setup_with(add_orphan);
    setup.document_repair(LoadIssueKind::OrphanContent, RepairAction::AddAsBlock);

    let sheet = read_json(&sheet_dir(&setup.root, "overview").join("sheet.json"));
    let blocks = sheet["blocks"].as_array().unwrap();
    assert_eq!(blocks.len(), 4);
    let added = blocks.last().unwrap();
    assert_eq!(added["blockType"], "markdown");
    assert_eq!(added["contentPath"], "sheets/overview/blocks/notes.md");
    // The lowest existing block ends at y = 200 + 1 (the image).. 200 + 320 (markdown).
    assert_eq!(added["position"]["y"], 520 + 24);
    assert_eq!(added["size"]["width"], 480);
    assert_eq!(
        read_text(&sheet_dir(&setup.root, "overview").join("blocks/notes.md")),
        "# Notes\n",
        "the file itself is not touched"
    );
    assert!(setup.reload().1.is_empty());
}

#[test]
fn an_orphan_file_can_be_deleted_and_only_that_file() {
    let mut setup = setup_with(add_orphan);
    let before = tree_snapshot(&setup.root);
    setup.document_repair(LoadIssueKind::OrphanContent, RepairAction::DeleteFile);

    let mut expected = before;
    expected.remove("documents/system-design/sheets/overview/blocks/notes.md");
    assert_eq!(tree_snapshot(&setup.root), expected);
}

#[test]
fn an_orphan_that_another_sheet_uses_is_neither_deleted_nor_adopted() {
    let mut setup = setup_with(|root| {
        add_orphan(root);
        let details = sheet_dir(root, "details").join("sheet.json");
        let mut sheet = read_json(&details);
        sheet["blocks"][0]["contentPath"] = json!("sheets/overview/blocks/notes.md");
        write_json(&details, &sheet);
    });
    let issue = first_of(&setup.document_issues, LoadIssueKind::OrphanContent);
    // The overview sheet's own list does not use it, but the details sheet does.
    for action in [RepairAction::DeleteFile, RepairAction::AddAsBlock] {
        let outcome = setup.repair(true, &issue, action, false);
        assert_eq!(
            outcome.unavailable,
            Some(RepairUnavailable::ReferencedElsewhere),
            "{action:?}"
        );
    }
    assert!(sheet_dir(&setup.root, "overview")
        .join("blocks/notes.md")
        .exists());
}

#[test]
fn a_non_text_orphan_can_only_be_deleted() {
    let mut setup = setup_with(|root| {
        fs::write(
            sheet_dir(root, "overview").join("blocks/picture.png"),
            png_bytes(2, 2),
        )
        .unwrap();
    });
    let issue = first_of(&setup.document_issues, LoadIssueKind::OrphanContent);
    let outcome = setup.repair(true, &issue, RepairAction::AddAsBlock, false);
    assert_eq!(
        outcome.unavailable,
        Some(RepairUnavailable::UnsupportedContentType)
    );
}

#[test]
fn leftover_temporary_files_are_deleted() {
    let mut setup = setup_with(|root| {
        write_text(&root.join(".project.json.dawn-tmp"), "x");
        write_text(
            &sheet_dir(root, "overview").join(".sheet.json.dawn-tmp"),
            "x",
        );
    });
    setup.project_repair(
        LoadIssueKind::LeftoverTempFile,
        RepairAction::DeleteTempFile,
    );
    setup.document_repair(
        LoadIssueKind::LeftoverTempFile,
        RepairAction::DeleteTempFile,
    );
    assert!(!setup.root.join(".project.json.dawn-tmp").exists());
    assert!(!sheet_dir(&setup.root, "overview")
        .join(".sheet.json.dawn-tmp")
        .exists());
    let (project, document) = setup.reload();
    assert!(project.is_empty() && document.is_empty());
}

#[test]
fn a_repair_never_overwrites_a_file_that_changed_outside_the_app() {
    let mut setup =
        setup_with(|root| set_json(&root.join("project.json"), "childOrder", json!([])));
    let issue = first_of(&setup.project_issues, LoadIssueKind::UnlistedEntity);
    replace_in_file(
        &setup.root.join("project.json"),
        "Basic Project",
        "Edited elsewhere",
    );
    let before = tree_snapshot(&setup.root);

    let error = repair_load_issue(
        &mut setup.sessions,
        PROJECT_ID,
        None,
        &issue,
        RepairAction::AddToList,
        false,
    )
    .unwrap_err();

    assert_eq!(
        error.kind,
        ErrorKind::Persistence(PersistenceErrorKind::ExternallyModified)
    );
    assert_eq!(tree_snapshot(&setup.root), before);
}

#[test]
fn an_issue_that_is_no_longer_reported_changes_nothing() {
    let mut setup =
        setup_with(|root| set_json(&root.join("project.json"), "childOrder", json!([])));
    let issue = first_of(&setup.project_issues, LoadIssueKind::UnlistedEntity);
    // Someone fixed the list before the user confirmed.
    set_json(
        &setup.root.join("project.json"),
        "childOrder",
        json!([DOCUMENT_ID]),
    );
    let before = tree_snapshot(&setup.root);

    let outcome = setup.repair(false, &issue, RepairAction::AddToList, false);

    assert_eq!(outcome.unavailable, Some(RepairUnavailable::IssueGone));
    assert!(!outcome.applied);
    assert_eq!(tree_snapshot(&setup.root), before);
}

#[test]
fn an_action_that_does_not_fit_the_issue_is_refused() {
    let mut setup = setup_with(add_orphan);
    let issue = first_of(&setup.document_issues, LoadIssueKind::OrphanContent);
    let before = tree_snapshot(&setup.root);
    for action in [
        RepairAction::AddToList,
        RepairAction::RemoveFromList,
        RepairAction::GiveNewId,
        RepairAction::RemoveBlock,
        RepairAction::CreateEmptyContent,
        RepairAction::DeleteTempFile,
    ] {
        let outcome = setup.repair(true, &issue, action, false);
        assert_eq!(
            outcome.unavailable,
            Some(RepairUnavailable::NotApplicable),
            "{action:?}"
        );
    }
    assert_eq!(tree_snapshot(&setup.root), before);
}

#[test]
fn a_load_failure_has_no_automatic_repair() {
    let mut setup = setup_with(|root| {
        write_text(&sheet_dir(root, "details").join("sheet.json"), "{ broken");
    });
    let issue = first_of(&setup.document_issues, LoadIssueKind::EntityLoadFailed);
    let before = tree_snapshot(&setup.root);
    for action in [
        RepairAction::AddToList,
        RepairAction::RemoveFromList,
        RepairAction::GiveNewId,
        RepairAction::RemoveBlock,
        RepairAction::CreateEmptyContent,
        RepairAction::DeleteFile,
        RepairAction::AddAsBlock,
        RepairAction::DeleteTempFile,
    ] {
        let outcome = setup.repair(true, &issue, action, false);
        assert_eq!(
            outcome.unavailable,
            Some(RepairUnavailable::NotApplicable),
            "{action:?}"
        );
    }
    assert_eq!(tree_snapshot(&setup.root), before);
}

#[test]
fn a_document_that_was_not_loaded_cannot_be_repaired_through_a_guessed_id() {
    let mut setup = setup_with(|_| {});
    let issue = RepairIssueRef {
        kind: LoadIssueKind::OrphanContent,
        path: Some("documents/system-design/sheets/overview/blocks/x.md".to_owned()),
        entity_id: None,
    };
    let error = repair_load_issue(
        &mut setup.sessions,
        PROJECT_ID,
        Some(UNKNOWN_ID),
        &issue,
        RepairAction::DeleteFile,
        false,
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::EntityNotFound);
}
