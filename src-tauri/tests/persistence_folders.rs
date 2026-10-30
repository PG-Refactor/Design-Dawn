//! Folders in the Project tree: recursive
//! load, per-parent order normalization, the project.json v1 / v2 formats, and Documents that
//! live inside Folders. Like the other load tests, loading must never write.

mod support;

use std::fs;
use std::path::Path;

use design_dawn_lib::application::block_content_operations::{
    read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::{
    delete_document, load_document, save_document,
};
use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::load_issue::{LoadIssue, LoadIssueKind};
use design_dawn_lib::application::project_operations::{
    open_entry_point, open_project, save_project, EntryPointResolution,
};
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::snapshot::{EntityState, ProjectSnapshot};
use design_dawn_lib::domain::entity_id::{DocumentId, FolderId};
use design_dawn_lib::domain::error::DomainErrorKind;
use serde_json::json;
use support::*;

const NEW_DOCUMENT_ID: &str = "01928f3a-3000-7000-8000-0000000000aa";
const NEW_FOLDER_ID: &str = "01928f3a-2000-7000-8000-0000000000aa";

fn open_folders() -> (
    TempDir,
    std::path::PathBuf,
    ProjectSessions,
    ProjectSnapshot,
) {
    let (temp, root) = folders_project_copy();
    let before = tree_snapshot(&root);
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, &root).expect("open folders project");
    assert_eq!(tree_snapshot(&root), before, "loading must not write");
    (temp, root, sessions, snapshot)
}

fn write_document_json(directory: &Path, document_id: &str, name: &str) {
    fs::create_dir_all(directory).unwrap();
    write_json(
        &directory.join("document.json"),
        &json!({
            "schemaVersion": 1,
            "documentId": document_id,
            "name": name,
            "sheetOrder": []
        }),
    );
}

fn write_folder_json(directory: &Path, folder_id: &str, name: &str, child_order: &[&str]) {
    fs::create_dir_all(directory).unwrap();
    write_json(
        &directory.join("folder.json"),
        &json!({
            "schemaVersion": 1,
            "folderId": folder_id,
            "name": name,
            "childOrder": child_order
        }),
    );
}

fn issue_path<'a>(issues: &'a [LoadIssue], kind: LoadIssueKind, path: &str) -> Vec<&'a LoadIssue> {
    issues
        .iter()
        .filter(|issue| issue.kind == kind && issue.path.as_deref() == Some(path))
        .collect()
}

fn document_ids(snapshot: &ProjectSnapshot) -> Vec<&str> {
    snapshot
        .documents
        .iter()
        .map(|entry| entry.document_id.as_str())
        .collect()
}

fn folder_ids(snapshot: &ProjectSnapshot) -> Vec<&str> {
    snapshot
        .folders
        .iter()
        .map(|entry| entry.folder_id.as_str())
        .collect()
}

mod recursive_load {
    use super::*;

    #[test]
    fn the_sample_tree_loads_with_parents_effective_orders_and_no_issues() {
        let (_temp, _root, sessions, snapshot) = open_folders();
        assert!(snapshot.issues.is_empty(), "{:?}", snapshot.issues);
        assert_eq!(
            snapshot.project.child_order,
            [
                ARCHITECTURE_FOLDER_ID,
                GLOSSARY_DOCUMENT_ID,
                ARCHIVE_FOLDER_ID
            ]
        );
        // Depth-first in display order.
        assert_eq!(
            folder_ids(&snapshot),
            [ARCHITECTURE_FOLDER_ID, BACKEND_FOLDER_ID, ARCHIVE_FOLDER_ID]
        );
        assert_eq!(
            document_ids(&snapshot),
            [
                API_DESIGN_DOCUMENT_ID,
                OVERVIEW_DOCUMENT_ID,
                GLOSSARY_DOCUMENT_ID
            ]
        );

        let architecture = &snapshot.folders[0];
        assert_eq!(architecture.name.as_deref(), Some("Architecture"));
        assert_eq!(architecture.parent_folder_id, None);
        assert_eq!(
            architecture.child_order,
            [BACKEND_FOLDER_ID, OVERVIEW_DOCUMENT_ID]
        );
        assert_eq!(architecture.state, EntityState::Loaded);
        let backend = &snapshot.folders[1];
        assert_eq!(
            backend.parent_folder_id.as_deref(),
            Some(ARCHITECTURE_FOLDER_ID)
        );
        assert_eq!(backend.child_order, [API_DESIGN_DOCUMENT_ID]);
        assert!(snapshot.folders[2].child_order.is_empty());

        assert_eq!(
            snapshot.documents[0].parent_folder_id.as_deref(),
            Some(BACKEND_FOLDER_ID)
        );
        assert_eq!(snapshot.documents[2].parent_folder_id, None);

        let session = sessions
            .get(&design_dawn_lib::domain::entity_id::ProjectId::parse(FOLDERS_PROJECT_ID).unwrap())
            .unwrap();
        let record = session
            .document(&DocumentId::parse(API_DESIGN_DOCUMENT_ID).unwrap())
            .unwrap();
        assert_eq!(record.relative_path, API_DESIGN_RELATIVE_PATH);
        let folder = session
            .folder(&FolderId::parse(BACKEND_FOLDER_ID).unwrap())
            .unwrap();
        assert_eq!(folder.relative_path, "architecture/backend");
        assert!(folder.writable);
    }

    #[test]
    fn unlisted_entries_are_appended_per_parent_and_reported() {
        let (_temp, root, mut sessions, _) = open_folders();
        let architecture = root.join("documents/architecture");
        write_document_json(&architecture.join("extra"), NEW_DOCUMENT_ID, "Extra");
        write_folder_json(
            &root.join("documents/zz-folder"),
            NEW_FOLDER_ID,
            "Late",
            &[],
        );
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert_eq!(
            snapshot.project.child_order,
            [
                ARCHITECTURE_FOLDER_ID,
                GLOSSARY_DOCUMENT_ID,
                ARCHIVE_FOLDER_ID,
                NEW_FOLDER_ID
            ]
        );
        assert_eq!(
            snapshot.folders[0].child_order,
            [BACKEND_FOLDER_ID, OVERVIEW_DOCUMENT_ID, NEW_DOCUMENT_ID]
        );
        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::UnlistedEntity,
                "documents/architecture/extra"
            )
            .len(),
            1
        );
        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::UnlistedEntity,
                "documents/zz-folder"
            )
            .len(),
            1
        );
    }

    #[test]
    fn listed_but_missing_entries_are_ignored_in_the_project_and_in_a_folder() {
        let (_temp, root, mut sessions, _) = open_folders();
        let mut project = read_json(&root.join("project.json"));
        project["childOrder"] = json!([UNKNOWN_ID, ARCHITECTURE_FOLDER_ID]);
        write_json(&root.join("project.json"), &project);
        write_folder_json(
            &root.join("documents/architecture"),
            ARCHITECTURE_FOLDER_ID,
            "Architecture",
            &[BACKEND_FOLDER_ID, NEW_DOCUMENT_ID, OVERVIEW_DOCUMENT_ID],
        );
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::MissingEntity,
                "project.json"
            )
            .len(),
            1
        );
        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::MissingEntity,
                "documents/architecture/folder.json"
            )
            .len(),
            1
        );
        assert_eq!(
            snapshot.folders[0].child_order,
            [BACKEND_FOLDER_ID, OVERVIEW_DOCUMENT_ID]
        );
        // The unlisted root entries follow the listed one.
        assert_eq!(
            snapshot.project.child_order,
            [
                ARCHITECTURE_FOLDER_ID,
                ARCHIVE_FOLDER_ID,
                GLOSSARY_DOCUMENT_ID
            ]
        );
    }

    #[test]
    fn a_directory_with_both_metadata_files_is_not_entered() {
        let (_temp, root, mut sessions, _) = open_folders();
        let both = root.join("documents/both");
        write_folder_json(&both, NEW_FOLDER_ID, "Both", &[]);
        write_document_json(&both, NEW_DOCUMENT_ID, "Both");
        write_document_json(
            &both.join("child"),
            "01928f3a-3000-7000-8000-0000000000bb",
            "Child",
        );
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::UnrecognizedDirectory,
                "documents/both"
            )
            .len(),
            1
        );
        assert_eq!(document_ids(&snapshot).len(), 3);
        assert_eq!(folder_ids(&snapshot).len(), 3);
        assert!(issues_of_kind(&snapshot.issues, LoadIssueKind::UnlistedEntity).is_empty());
    }

    #[test]
    fn a_directory_with_neither_metadata_file_is_not_entered() {
        let (_temp, root, mut sessions, _) = open_folders();
        let plain = root.join("documents/architecture/notes");
        write_document_json(
            &plain.join("hidden"),
            "01928f3a-3000-7000-8000-0000000000bb",
            "Hidden",
        );
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::UnrecognizedDirectory,
                "documents/architecture/notes"
            )
            .len(),
            1
        );
        assert_eq!(document_ids(&snapshot).len(), 3);
    }

    #[test]
    fn leftover_temp_files_are_reported_in_the_project_root_as_before() {
        let (_temp, root, mut sessions, _) = open_folders();
        write_text(&root.join(".project.json.dawn-tmp"), "x");
        let snapshot = open_project(&mut sessions, &root).unwrap();
        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::LeftoverTempFile,
                ".project.json.dawn-tmp"
            )
            .len(),
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_directory_is_reported_and_never_followed() {
        use std::os::unix::fs::symlink;
        let (_temp, root, mut sessions, _) = open_folders();
        // A link to a directory inside the project would otherwise list its content twice;
        // a link to an ancestor would be an endless tree.
        symlink(
            root.join("documents/architecture"),
            root.join("documents/alias"),
        )
        .unwrap();
        symlink(
            root.join("documents"),
            root.join("documents/architecture/loop"),
        )
        .unwrap();
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert_eq!(document_ids(&snapshot).len(), 3);
        assert_eq!(folder_ids(&snapshot).len(), 3);
        for path in ["documents/alias", "documents/architecture/loop"] {
            let found = issue_path(&snapshot.issues, LoadIssueKind::UnrecognizedDirectory, path);
            assert_eq!(found.len(), 1, "{path}");
        }
        assert!(issues_of_kind(&snapshot.issues, LoadIssueKind::DuplicateEntityId).is_empty());
    }
}

mod duplicate_ids {
    use super::*;

    #[test]
    fn a_document_reusing_a_folder_id_is_excluded() {
        let (_temp, root, mut sessions, _) = open_folders();
        // "zz" sorts after "architecture", so the Folder keeps the ID.
        write_document_json(
            &root.join("documents/zz"),
            ARCHITECTURE_FOLDER_ID,
            "Impostor",
        );
        let snapshot = open_project(&mut sessions, &root).unwrap();

        let duplicates = issues_of_kind(&snapshot.issues, LoadIssueKind::DuplicateEntityId);
        assert_eq!(duplicates.len(), 1);
        assert_eq!(duplicates[0].path.as_deref(), Some("documents/zz"));
        assert_eq!(document_ids(&snapshot).len(), 3);
        assert_eq!(folder_ids(&snapshot).len(), 3);
    }

    #[test]
    fn a_folder_reusing_a_nested_document_id_is_excluded_with_its_children() {
        let (_temp, root, mut sessions, _) = open_folders();
        // "architecture" is scanned (depth-first) before "zz", so the nested Document wins.
        let clone = root.join("documents/zz");
        write_folder_json(&clone, API_DESIGN_DOCUMENT_ID, "Impostor", &[]);
        write_document_json(
            &clone.join("child"),
            "01928f3a-3000-7000-8000-0000000000bb",
            "Child",
        );
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::DuplicateEntityId,
                "documents/zz"
            )
            .len(),
            1
        );
        assert_eq!(folder_ids(&snapshot).len(), 3);
        assert_eq!(document_ids(&snapshot).len(), 3);
    }
}

mod failed_folders {
    use super::*;

    fn break_backend_folder_schema(root: &Path) {
        let path = root.join("documents/architecture/backend/folder.json");
        let mut value = read_json(&path);
        value["schemaVersion"] = json!(99);
        write_json(&path, &value);
    }

    #[test]
    fn a_folder_that_fails_to_load_is_listed_failed_and_its_children_are_not_scanned() {
        let (_temp, root, mut sessions, _) = open_folders();
        break_backend_folder_schema(&root);
        let before = tree_snapshot(&root);
        let snapshot = open_project(&mut sessions, &root).unwrap();
        assert_eq!(tree_snapshot(&root), before);

        let backend = snapshot
            .folders
            .iter()
            .find(|entry| entry.folder_id == BACKEND_FOLDER_ID)
            .expect("listed by its readable id");
        assert_eq!(backend.state, EntityState::LoadFailed);
        assert_eq!(backend.name.as_deref(), Some("Backend"));
        assert_eq!(
            backend.parent_folder_id.as_deref(),
            Some(ARCHITECTURE_FOLDER_ID)
        );
        assert!(backend.child_order.is_empty());

        // The Document below the failed Folder is not known to the session.
        assert!(!document_ids(&snapshot).contains(&API_DESIGN_DOCUMENT_ID));
        let failures = issue_path(
            &snapshot.issues,
            LoadIssueKind::EntityLoadFailed,
            "documents/architecture/backend",
        );
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].entity_id.as_deref(), Some(BACKEND_FOLDER_ID));
        // Its parent still lists it, so nothing is "missing" or "unlisted".
        assert!(issues_of_kind(&snapshot.issues, LoadIssueKind::MissingEntity).is_empty());
        assert!(issues_of_kind(&snapshot.issues, LoadIssueKind::UnlistedEntity).is_empty());

        let error =
            load_document(&mut sessions, FOLDERS_PROJECT_ID, API_DESIGN_DOCUMENT_ID).unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
    }

    #[test]
    fn a_folder_whose_id_cannot_be_read_is_reported_but_not_listed() {
        let (_temp, root, mut sessions, _) = open_folders();
        write_text(
            &root.join("documents/architecture/backend/folder.json"),
            "{ broken",
        );
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert!(!folder_ids(&snapshot).contains(&BACKEND_FOLDER_ID));
        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::EntityLoadFailed,
                "documents/architecture/backend"
            )
            .len(),
            1
        );
        // The parent's order entry now names nothing on disk.
        assert_eq!(
            issue_path(
                &snapshot.issues,
                LoadIssueKind::MissingEntity,
                "documents/architecture/folder.json"
            )
            .len(),
            1
        );
    }
}

mod project_formats {
    use super::*;

    #[test]
    fn a_version_1_project_is_read_as_child_order_and_loading_leaves_the_file_alone() {
        let (_temp, root) = legacy_project_copy();
        let before = tree_snapshot(&root);
        let mut sessions = ProjectSessions::default();
        let snapshot = open_project(&mut sessions, &root).unwrap();

        assert_eq!(tree_snapshot(&root), before);
        assert!(read_text(&root.join("project.json")).contains("\"documentOrder\""));
        assert_eq!(snapshot.project.schema_version, 2.into());
        assert_eq!(snapshot.project.child_order, [DOCUMENT_ID]);
        assert!(snapshot.folders.is_empty());
        assert_eq!(snapshot.documents[0].parent_folder_id, None);
    }

    #[test]
    fn saving_always_writes_version_2_with_the_documented_key_order() {
        let (_temp, root) = legacy_project_copy();
        let mut sessions = ProjectSessions::default();
        let snapshot = open_project(&mut sessions, &root).unwrap();
        let saved = save_project(&mut sessions, PROJECT_ID, &snapshot.project).unwrap();
        assert!(saved.written);

        assert_eq!(
            read_text(&root.join("project.json")),
            format!(
                "{{\n  \"schemaVersion\": 2,\n  \"projectId\": \"{PROJECT_ID}\",\n  \"name\": \"Basic Project\",\n  \"childOrder\": [\n    \"{DOCUMENT_ID}\"\n  ]\n}}\n"
            )
        );
        // And the saved file reads back, unchanged by a further save.
        let reopened = open_project(&mut sessions, &root).unwrap();
        assert_eq!(reopened.project, snapshot.project);
        let again = save_project(&mut sessions, PROJECT_ID, &reopened.project).unwrap();
        assert!(!again.written);
    }

    #[test]
    fn a_client_that_still_sends_schema_version_1_is_written_as_version_2() {
        let (_temp, root) = project_copy();
        let mut sessions = ProjectSessions::default();
        let mut project = open_project(&mut sessions, &root).unwrap().project;
        project.schema_version = 1.into();
        save_project(&mut sessions, PROJECT_ID, &project).unwrap();
        assert!(read_text(&root.join("project.json")).contains("\"schemaVersion\": 2"));
    }

    #[test]
    fn a_version_2_project_round_trips_byte_for_byte_with_child_order_of_both_kinds() {
        let (_temp, root, mut sessions, snapshot) = open_folders();
        let before = tree_snapshot(&root);
        let saved = save_project(&mut sessions, FOLDERS_PROJECT_ID, &snapshot.project).unwrap();
        assert!(!saved.written);
        assert_eq!(tree_snapshot(&root), before);
    }

    #[test]
    fn a_reordered_project_child_order_may_interleave_folders_and_documents() {
        let (_temp, root, mut sessions, snapshot) = open_folders();
        let mut project = snapshot.project.clone();
        project.child_order = vec![
            GLOSSARY_DOCUMENT_ID.to_owned(),
            ARCHIVE_FOLDER_ID.to_owned(),
            ARCHITECTURE_FOLDER_ID.to_owned(),
        ];
        save_project(&mut sessions, FOLDERS_PROJECT_ID, &project).unwrap();
        let reopened = open_project(&mut sessions, &root).unwrap();
        assert_eq!(reopened.project.child_order, project.child_order);
    }
}

mod nested_documents {
    use super::*;

    #[test]
    fn a_nested_document_loads_reads_and_saves_without_changing_content_paths() {
        let (_temp, root, mut sessions, _) = open_folders();
        let before = tree_snapshot(&root);
        let document =
            load_document(&mut sessions, FOLDERS_PROJECT_ID, API_DESIGN_DOCUMENT_ID).unwrap();
        assert!(document.issues.is_empty(), "{:?}", document.issues);
        assert_eq!(tree_snapshot(&root), before, "loading must not write");

        let sheet = document.sheets[0].sheet.as_ref().expect("sheet loaded");
        assert_eq!(
            sheet.blocks[0].content_path,
            "sheets/main/blocks/markdown-1.md"
        );
        let text = read_block_content(
            &mut sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
            &sheet.blocks[0].content_path,
        )
        .unwrap();
        assert_eq!(text, "## API\n");

        let saved = write_block_content(
            &mut sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
            &sheet.blocks[0].content_path,
            "## API v2\n",
        )
        .unwrap();
        assert!(saved.written);
        assert_eq!(
            read_text(
                &root
                    .join("documents")
                    .join(API_DESIGN_RELATIVE_PATH)
                    .join("sheets/main/blocks/markdown-1.md")
            ),
            "## API v2\n"
        );
        let unchanged =
            save_document(&mut sessions, FOLDERS_PROJECT_ID, &document.document).unwrap();
        assert!(!unchanged.written);
    }

    #[test]
    fn deleting_a_nested_document_removes_only_its_directory() {
        let (_temp, root, mut sessions, _) = open_folders();
        delete_document(&mut sessions, FOLDERS_PROJECT_ID, API_DESIGN_DOCUMENT_ID).unwrap();

        assert!(!root
            .join("documents")
            .join(API_DESIGN_RELATIVE_PATH)
            .exists());
        assert!(root
            .join("documents/architecture/backend/folder.json")
            .is_file());
        let error =
            load_document(&mut sessions, FOLDERS_PROJECT_ID, API_DESIGN_DOCUMENT_ID).unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
    }

    #[test]
    fn a_nested_document_cannot_reach_files_outside_its_own_directory() {
        let (_temp, _root, mut sessions, _) = open_folders();
        let error = read_block_content(
            &mut sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
            "sheets/../../folder.json",
        )
        .unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::Domain(DomainErrorKind::InvalidContentPath)
        );
    }
}

mod entry_points {
    use super::*;

    #[test]
    fn the_path_hit_check_works_for_a_nested_document_directory() {
        let (_temp, root) = folders_project_copy();
        let mut sessions = ProjectSessions::default();
        let opened = open_entry_point(&mut sessions, &root.join("api-design.dawn")).unwrap();
        assert_eq!(opened.resolution, EntryPointResolution::Path);
        assert_eq!(opened.snapshot.document_id, API_DESIGN_DOCUMENT_ID);
    }

    #[test]
    fn the_id_fallback_finds_a_nested_document_when_the_path_is_stale() {
        let (_temp, root) = folders_project_copy();
        for stale in ["documents/moved-away", "documents/architecture/overview"] {
            write_json(
                &root.join("api-design.dawn"),
                &json!({
                    "schemaVersion": 1,
                    "documentId": API_DESIGN_DOCUMENT_ID,
                    "path": stale
                }),
            );
            let mut sessions = ProjectSessions::default();
            let opened = open_entry_point(&mut sessions, &root.join("api-design.dawn")).unwrap();
            assert_eq!(opened.resolution, EntryPointResolution::IdScan, "{stale}");
            assert_eq!(opened.snapshot.document_id, API_DESIGN_DOCUMENT_ID);
        }
    }

    #[test]
    fn a_document_below_a_failed_folder_cannot_be_found_by_id() {
        let (_temp, root) = folders_project_copy();
        let path = root.join("documents/architecture/folder.json");
        let mut value = read_json(&path);
        value["schemaVersion"] = json!(99);
        write_json(&path, &value);
        let mut sessions = ProjectSessions::default();
        let error = open_entry_point(&mut sessions, &root.join("api-design.dawn")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
    }
}
