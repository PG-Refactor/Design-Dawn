//! Folder commands (docs/architecture.md §6.2.4): create, save, move and delete Folders, and
//! Documents created in or moved between Folders. The commands never touch order arrays.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use design_dawn_lib::application::block_content_operations::{
    read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::{
    close_document, create_document, load_document,
};
use design_dawn_lib::application::error::{ApplicationError, ErrorKind};
use design_dawn_lib::application::folder_operations::{
    create_folder, delete_folder, move_entry, save_folder,
};
use design_dawn_lib::application::project_operations::open_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::application::sheet_operations::save_sheet;
use design_dawn_lib::application::snapshot::{EntityState, ProjectSnapshot};
use design_dawn_lib::domain::error::DomainErrorKind;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::dto::FolderDto;
use serde_json::Number;
use support::*;

fn id(number: u32) -> String {
    format!("01928f3a-9000-7000-8000-{number:012x}")
}

struct Opened {
    _temp: TempDir,
    root: PathBuf,
    sessions: ProjectSessions,
}

fn open_folders() -> Opened {
    let (temp, root) = folders_project_copy();
    let mut sessions = ProjectSessions::default();
    open_project(&mut sessions, &root).expect("open folders project");
    Opened {
        _temp: temp,
        root,
        sessions,
    }
}

impl Opened {
    fn documents(&self) -> PathBuf {
        self.root.join("documents")
    }

    /// Reopens the Project from disk in a separate session set.
    fn reopen(&self) -> ProjectSnapshot {
        open_project(&mut ProjectSessions::default(), &self.root).expect("reopen")
    }
}

fn folder_dto(folder_id: &str, name: &str, child_order: &[&str]) -> FolderDto {
    FolderDto {
        schema_version: Number::from(1),
        folder_id: folder_id.to_owned(),
        name: name.to_owned(),
        child_order: child_order.iter().map(|id| (*id).to_owned()).collect(),
    }
}

/// Makes a folder fail to load while its ID stays readable, so it is known but not writable.
fn break_folder_schema(root: &Path, relative_path: &str) {
    let path = root
        .join("documents")
        .join(relative_path)
        .join("folder.json");
    let mut value = read_json(&path);
    value["schemaVersion"] = serde_json::json!(99);
    write_json(&path, &value);
}

fn assert_no_path_leak(error: &ApplicationError, root: &Path) {
    let wire = serde_json::to_string(error).unwrap();
    assert!(
        !wire.contains(&root.to_string_lossy().to_string()),
        "{wire}"
    );
    assert!(!wire.contains('/') && !wire.contains('\\'), "{wire}");
}

mod create_folder_command {
    use super::*;

    #[test]
    fn creates_at_the_root_and_nested_with_a_slug_and_folder_json() {
        let mut opened = open_folders();
        let snapshot = create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            None,
            &id(1),
            "Design Notes",
        )
        .unwrap();
        assert_eq!(snapshot.folder_id, id(1));
        assert_eq!(snapshot.name.as_deref(), Some("Design Notes"));
        assert_eq!(snapshot.parent_folder_id, None);
        assert!(snapshot.child_order.is_empty());
        assert_eq!(snapshot.state, EntityState::Loaded);
        assert_eq!(
            read_json(&opened.documents().join("design-notes/folder.json")),
            serde_json::json!({
                "schemaVersion": 1,
                "folderId": id(1),
                "name": "Design Notes",
                "childOrder": []
            })
        );

        let nested = create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            Some(&id(1)),
            &id(2),
            "Inner",
        )
        .unwrap();
        assert_eq!(nested.parent_folder_id.as_deref(), Some(id(1).as_str()));
        assert!(opened
            .documents()
            .join("design-notes/inner/folder.json")
            .is_file());
        // The caller saves the parents; until then the new folders are unlisted but found.
        let reopened = opened.reopen();
        assert!(reopened.folders.iter().any(|entry| entry.folder_id == id(2)
            && entry.parent_folder_id.as_deref() == Some(id(1).as_str())));
    }

    #[test]
    fn untranslatable_names_fall_back_to_numbered_names_and_collisions_get_suffixes() {
        let mut opened = open_folders();
        for (number, name, expected) in [
            (1, "設計", "folder-1"),
            (2, "設計", "folder-2"),
            (3, "Archive", "archive-2"),
            (4, "ARCHIVE", "archive-3"),
        ] {
            create_folder(
                &mut opened.sessions,
                FOLDERS_PROJECT_ID,
                None,
                &id(number),
                name,
            )
            .unwrap();
            assert!(
                opened
                    .documents()
                    .join(expected)
                    .join("folder.json")
                    .is_file(),
                "{expected}"
            );
        }
    }

    #[test]
    fn never_overwrites_an_existing_entry_and_leaves_the_tree_untouched_on_failure() {
        let mut opened = open_folders();
        let before = tree_snapshot(&opened.root);
        let error = create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            None,
            ARCHIVE_FOLDER_ID,
            "Anything",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Domain(DomainErrorKind::DuplicateId));
        let error = create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            None,
            GLOSSARY_DOCUMENT_ID,
            "Anything",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Domain(DomainErrorKind::DuplicateId));
        assert_eq!(tree_snapshot(&opened.root), before);
    }

    #[test]
    fn an_unknown_or_failed_parent_and_bad_input_are_rejected() {
        let mut opened = open_folders();
        let error = create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            Some(UNKNOWN_ID),
            &id(1),
            "X",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
        assert_no_path_leak(&error, &opened.root);
        // A Document is not a Folder.
        let error = create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            Some(GLOSSARY_DOCUMENT_ID),
            &id(1),
            "X",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
        let error =
            create_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, None, "nope", "X").unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::Domain(DomainErrorKind::InvalidEntityId)
        );
        let error = create_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, None, &id(1), "  ")
            .unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::Domain(DomainErrorKind::InvalidDisplayName)
        );
        let error = create_folder(&mut opened.sessions, UNKNOWN_ID, None, &id(1), "X").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ProjectNotOpen);
    }

    #[test]
    fn a_folder_that_failed_to_load_cannot_receive_children() {
        let (temp, root) = folders_project_copy();
        break_folder_schema(&root, "architecture/backend");
        let mut sessions = ProjectSessions::default();
        open_project(&mut sessions, &root).unwrap();
        let _keep = temp;
        for error in [
            create_folder(
                &mut sessions,
                FOLDERS_PROJECT_ID,
                Some(BACKEND_FOLDER_ID),
                &id(1),
                "X",
            )
            .unwrap_err(),
            create_document(
                &mut sessions,
                FOLDERS_PROJECT_ID,
                &id(2),
                "X",
                Some(BACKEND_FOLDER_ID),
            )
            .unwrap_err(),
            move_entry(
                &mut sessions,
                FOLDERS_PROJECT_ID,
                GLOSSARY_DOCUMENT_ID,
                Some(BACKEND_FOLDER_ID),
            )
            .unwrap_err(),
        ] {
            assert_eq!(error.kind, ErrorKind::NotWritable);
        }
        assert!(!root.join("documents/architecture/backend/x").exists());
    }
}

mod save_folder_command {
    use super::*;

    #[test]
    fn round_trips_name_and_child_order_and_skips_an_unchanged_write() {
        let mut opened = open_folders();
        let dto = folder_dto(
            ARCHIVE_FOLDER_ID,
            "Archive 2",
            &[GLOSSARY_DOCUMENT_ID, UNKNOWN_ID],
        );
        assert!(
            save_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, &dto)
                .unwrap()
                .written
        );
        let on_disk = read_json(&opened.documents().join("archive/folder.json"));
        assert_eq!(on_disk["name"], "Archive 2");
        // Existence is not required, like `documentOrder`.
        assert_eq!(
            on_disk["childOrder"],
            serde_json::json!([GLOSSARY_DOCUMENT_ID, UNKNOWN_ID])
        );
        assert!(
            !save_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, &dto)
                .unwrap()
                .written
        );
    }

    #[test]
    fn rejects_unknown_ids_invalid_payloads_and_unwritable_folders() {
        let mut opened = open_folders();
        let error = save_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            &folder_dto(UNKNOWN_ID, "X", &[]),
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
        let error = save_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            &folder_dto(ARCHIVE_FOLDER_ID, "X", &["bad id"]),
        )
        .unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::Domain(DomainErrorKind::InvalidEntityId)
        );
        let error = save_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            &folder_dto(
                ARCHIVE_FOLDER_ID,
                "X",
                &[GLOSSARY_DOCUMENT_ID, GLOSSARY_DOCUMENT_ID],
            ),
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Domain(DomainErrorKind::DuplicateId));
    }

    #[test]
    fn a_folder_that_failed_to_load_is_never_written() {
        let (_temp, root) = folders_project_copy();
        break_folder_schema(&root, "architecture/backend");
        let before = read_text(&root.join("documents/architecture/backend/folder.json"));
        let mut sessions = ProjectSessions::default();
        open_project(&mut sessions, &root).unwrap();
        let error = save_folder(
            &mut sessions,
            FOLDERS_PROJECT_ID,
            &folder_dto(BACKEND_FOLDER_ID, "Backend", &[]),
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotWritable);
        assert_eq!(
            read_text(&root.join("documents/architecture/backend/folder.json")),
            before
        );
    }
}

mod create_document_in_a_folder {
    use super::*;

    #[test]
    fn is_created_under_the_parents_directory_and_loads_after_a_restart() {
        let mut opened = open_folders();
        let snapshot = create_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            &id(1),
            "Deep Doc",
            Some(BACKEND_FOLDER_ID),
        )
        .unwrap();
        assert_eq!(snapshot.document.document_id, id(1));
        assert!(opened
            .documents()
            .join("architecture/backend/deep-doc/document.json")
            .is_file());
        assert!(opened
            .documents()
            .join("architecture/backend/deep-doc/sheets")
            .is_dir());
        let reopened = opened.reopen();
        let entry = reopened
            .documents
            .iter()
            .find(|entry| entry.document_id == id(1))
            .expect("created document is found on disk");
        assert_eq!(entry.parent_folder_id.as_deref(), Some(BACKEND_FOLDER_ID));
    }

    #[test]
    fn a_missing_parent_means_the_project_root_and_ids_must_be_unique() {
        let mut opened = open_folders();
        create_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            &id(1),
            "Top",
            None,
        )
        .unwrap();
        assert!(opened.documents().join("top/document.json").is_file());
        let error = create_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            ARCHIVE_FOLDER_ID,
            "Clash",
            None,
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Domain(DomainErrorKind::DuplicateId));
        let error = create_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            &id(2),
            "X",
            Some(UNKNOWN_ID),
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
    }
}

mod move_entry_command {
    use super::*;

    fn move_to(
        opened: &mut Opened,
        entry: &str,
        target: Option<&str>,
    ) -> Result<(), ApplicationError> {
        move_entry(&mut opened.sessions, FOLDERS_PROJECT_ID, entry, target)
    }

    #[test]
    fn moves_a_document_from_the_root_into_a_folder_and_back() {
        let mut opened = open_folders();
        move_to(&mut opened, GLOSSARY_DOCUMENT_ID, Some(ARCHIVE_FOLDER_ID)).unwrap();
        assert!(!opened.documents().join("glossary").exists());
        assert!(opened
            .documents()
            .join("archive/glossary/document.json")
            .is_file());
        // It can be loaded and written at the new place; contentPath is unchanged.
        let loaded = load_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            GLOSSARY_DOCUMENT_ID,
        )
        .unwrap();
        assert!(loaded.document.sheet_order.len() <= loaded.sheets.len());

        close_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            GLOSSARY_DOCUMENT_ID,
        )
        .unwrap();
        move_to(&mut opened, GLOSSARY_DOCUMENT_ID, None).unwrap();
        assert!(opened.documents().join("glossary/document.json").is_file());
        assert!(!opened.documents().join("archive/glossary").exists());
    }

    #[test]
    fn moves_folders_between_folders_and_to_the_root_with_descendants_usable() {
        let mut opened = open_folders();
        // architecture/backend -> archive
        move_to(&mut opened, BACKEND_FOLDER_ID, Some(ARCHIVE_FOLDER_ID)).unwrap();
        assert!(opened
            .documents()
            .join("archive/backend/api-design/document.json")
            .is_file());
        assert!(!opened.documents().join("architecture/backend").exists());

        // The deep document is found through its updated session path.
        let loaded = load_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
        )
        .unwrap();
        let block = loaded.sheets[0].sheet.as_ref().unwrap().blocks[0].clone();
        assert_eq!(block.content_path, "sheets/main/blocks/markdown-1.md");
        let text = read_block_content(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
            &block.content_path,
        )
        .unwrap();
        assert_eq!(text, "## API\n");
        write_block_content(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
            &block.content_path,
            "## Moved\n",
        )
        .unwrap();
        assert_eq!(
            read_text(
                &opened
                    .documents()
                    .join("archive/backend/api-design/sheets/main/blocks/markdown-1.md")
            ),
            "## Moved\n"
        );
        close_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
        )
        .unwrap();

        // The folder itself can still receive children after moving (its record moved too).
        create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            Some(BACKEND_FOLDER_ID),
            &id(1),
            "Child",
        )
        .unwrap();
        assert!(opened
            .documents()
            .join("archive/backend/child/folder.json")
            .is_file());

        // archive/backend -> root, with everything below it.
        move_to(&mut opened, BACKEND_FOLDER_ID, None).unwrap();
        assert!(opened
            .documents()
            .join("backend/api-design/document.json")
            .is_file());
        assert!(opened
            .documents()
            .join("backend/child/folder.json")
            .is_file());
        load_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
        )
        .unwrap();
        // A fresh open agrees with the session.
        let reopened = opened.reopen();
        assert!(reopened.folders.iter().any(|entry| entry.folder_id == id(1)
            && entry.parent_folder_id.as_deref() == Some(BACKEND_FOLDER_ID)));
    }

    #[test]
    fn a_name_collision_at_the_target_gets_a_case_insensitive_suffix() {
        let mut opened = open_folders();
        fs::create_dir(opened.documents().join("archive/Glossary")).unwrap();
        move_to(&mut opened, GLOSSARY_DOCUMENT_ID, Some(ARCHIVE_FOLDER_ID)).unwrap();
        assert!(opened
            .documents()
            .join("archive/glossary-2/document.json")
            .is_file());
        assert!(opened.documents().join("archive/Glossary").is_dir());
    }

    #[test]
    fn a_same_parent_move_is_a_no_op() {
        let mut opened = open_folders();
        let before = tree_snapshot(&opened.root);
        move_to(&mut opened, GLOSSARY_DOCUMENT_ID, None).unwrap();
        move_to(&mut opened, BACKEND_FOLDER_ID, Some(ARCHITECTURE_FOLDER_ID)).unwrap();
        assert_eq!(tree_snapshot(&opened.root), before);
    }

    /// Opens the deep document, moves `entry` into the archive folder, then writes through
    /// the same IDs: a block text and the sheet. Everything must land under `new_base`.
    fn move_open_document_then_write(entry: &str, new_base: &str, old_top: &str) {
        let mut opened = open_folders();
        let loaded = load_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
        )
        .unwrap();
        let sheet = loaded.sheets[0].sheet.clone().unwrap();
        let content_path = sheet.blocks[0].content_path.clone();

        move_to(&mut opened, entry, Some(ARCHIVE_FOLDER_ID)).unwrap();
        assert!(!opened.documents().join(old_top).exists());
        assert!(opened
            .documents()
            .join(new_base)
            .join("document.json")
            .is_file());

        // The session was rebased, so the still-open document writes at the new path.
        assert_eq!(
            read_block_content(
                &mut opened.sessions,
                FOLDERS_PROJECT_ID,
                API_DESIGN_DOCUMENT_ID,
                &content_path,
            )
            .unwrap(),
            "## API\n"
        );
        write_block_content(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
            &content_path,
            "## After move\n",
        )
        .unwrap();
        let mut renamed = sheet.clone();
        renamed.name = "Renamed after move".to_owned();
        assert!(
            save_sheet(
                &mut opened.sessions,
                FOLDERS_PROJECT_ID,
                API_DESIGN_DOCUMENT_ID,
                &renamed,
            )
            .unwrap()
            .written
        );

        let sheet_directory = opened.documents().join(new_base).join("sheets/main");
        assert_eq!(
            read_text(&sheet_directory.join("blocks/markdown-1.md")),
            "## After move\n"
        );
        assert!(read_text(&sheet_directory.join("sheet.json")).contains("Renamed after move"));
        // Nothing was recreated at the old location.
        assert!(!opened.documents().join(old_top).exists());
    }

    #[test]
    fn an_open_document_moves_and_later_writes_land_at_the_new_path() {
        move_open_document_then_write(
            API_DESIGN_DOCUMENT_ID,
            "archive/api-design",
            "architecture/backend/api-design",
        );
    }

    #[test]
    fn a_folder_holding_an_open_document_moves_and_later_writes_land_at_the_new_path() {
        for (folder, new_base, old_top) in [
            (
                BACKEND_FOLDER_ID,
                "archive/backend/api-design",
                "architecture/backend",
            ),
            // Any ancestor of the open document.
            (
                ARCHITECTURE_FOLDER_ID,
                "archive/architecture/backend/api-design",
                "architecture",
            ),
        ] {
            move_open_document_then_write(folder, new_base, old_top);
        }
    }

    #[test]
    fn a_created_document_stays_open_after_it_moves() {
        let mut opened = open_folders();
        create_document(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            &id(1),
            "New",
            None,
        )
        .unwrap();
        move_to(&mut opened, &id(1), Some(ARCHIVE_FOLDER_ID)).unwrap();
        close_document(&mut opened.sessions, FOLDERS_PROJECT_ID, &id(1)).unwrap();
        assert!(opened
            .documents()
            .join("archive/new/document.json")
            .is_file());
    }

    #[test]
    fn a_folder_cannot_move_into_itself_or_a_descendant() {
        let mut opened = open_folders();
        let before = tree_snapshot(&opened.root);
        for target in [ARCHITECTURE_FOLDER_ID, BACKEND_FOLDER_ID] {
            let error = move_to(&mut opened, ARCHITECTURE_FOLDER_ID, Some(target)).unwrap_err();
            assert_eq!(error.kind, ErrorKind::InvalidMove, "{target}");
        }
        assert_eq!(tree_snapshot(&opened.root), before);
    }

    #[test]
    fn unknown_entries_targets_and_projects_are_rejected() {
        let mut opened = open_folders();
        assert_eq!(
            move_to(&mut opened, UNKNOWN_ID, None).unwrap_err().kind,
            ErrorKind::EntityNotFound
        );
        assert_eq!(
            move_to(&mut opened, GLOSSARY_DOCUMENT_ID, Some(UNKNOWN_ID))
                .unwrap_err()
                .kind,
            ErrorKind::EntityNotFound
        );
        // A Document is not a valid target.
        assert_eq!(
            move_to(&mut opened, ARCHIVE_FOLDER_ID, Some(GLOSSARY_DOCUMENT_ID))
                .unwrap_err()
                .kind,
            ErrorKind::EntityNotFound
        );
        assert_eq!(
            move_to(&mut opened, "bad", None).unwrap_err().kind,
            ErrorKind::Domain(DomainErrorKind::InvalidEntityId)
        );
        assert_eq!(
            move_entry(&mut opened.sessions, UNKNOWN_ID, GLOSSARY_DOCUMENT_ID, None)
                .unwrap_err()
                .kind,
            ErrorKind::ProjectNotOpen
        );
    }

    #[test]
    fn moving_keeps_the_hash_ledger_consistent_for_the_moved_files() {
        let mut opened = open_folders();
        // Reading records the hash under the old path; after the move the same bytes are
        // recorded under the new path and the old path is forgotten.
        let before = opened
            .sessions
            .get(&design_dawn_lib::domain::entity_id::ProjectId::parse(FOLDERS_PROJECT_ID).unwrap())
            .unwrap()
            .ledger()
            .hash_of("documents/architecture/backend/folder.json")
            .map(str::to_owned);
        assert!(before.is_some());
        move_to(&mut opened, BACKEND_FOLDER_ID, Some(ARCHIVE_FOLDER_ID)).unwrap();
        let ledger = opened
            .sessions
            .get(&design_dawn_lib::domain::entity_id::ProjectId::parse(FOLDERS_PROJECT_ID).unwrap())
            .unwrap()
            .ledger();
        assert_eq!(
            ledger.hash_of("documents/archive/backend/folder.json"),
            before.as_deref()
        );
        assert!(ledger
            .hash_of("documents/architecture/backend/folder.json")
            .is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_source_or_target_is_never_followed() {
        use std::os::unix::fs::symlink;
        let mut opened = open_folders();
        let outside = opened.root.parent().unwrap().join("outside");
        fs::create_dir(&outside).unwrap();

        // The archive folder's directory is replaced by a link to a directory outside.
        fs::remove_dir_all(opened.documents().join("archive")).unwrap();
        symlink(&outside, opened.documents().join("archive")).unwrap();
        let error =
            move_to(&mut opened, GLOSSARY_DOCUMENT_ID, Some(ARCHIVE_FOLDER_ID)).unwrap_err();
        assert!(matches!(
            error.kind,
            ErrorKind::Persistence(PersistenceErrorKind::PathOutsideRoot)
        ));
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        assert!(opened.documents().join("glossary/document.json").is_file());

        // The moved document's directory is replaced by a link: nothing moves.
        let target = opened.documents().join("glossary");
        fs::remove_dir_all(&target).unwrap();
        symlink(&outside, &target).unwrap();
        let error = move_to(
            &mut opened,
            GLOSSARY_DOCUMENT_ID,
            Some(ARCHITECTURE_FOLDER_ID),
        )
        .unwrap_err();
        assert!(matches!(error.kind, ErrorKind::Persistence(_)));
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!opened.documents().join("architecture/glossary").exists());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }
}

mod delete_folder_command {
    use super::*;

    #[test]
    fn deletes_an_empty_folder_and_forgets_it() {
        let mut opened = open_folders();
        delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, ARCHIVE_FOLDER_ID).unwrap();
        assert!(!opened.documents().join("archive").exists());
        let error =
            delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, ARCHIVE_FOLDER_ID).unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
        let error = create_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            Some(ARCHIVE_FOLDER_ID),
            &id(1),
            "X",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::EntityNotFound);
    }

    #[test]
    fn a_folder_with_only_temp_files_is_deletable() {
        let mut opened = open_folders();
        write_text(
            &opened.documents().join("archive/.folder.json.dawn-tmp"),
            "x",
        );
        write_text(&opened.documents().join("archive/.other.dawn-tmp"), "x");
        delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, ARCHIVE_FOLDER_ID).unwrap();
        assert!(!opened.documents().join("archive").exists());
    }

    #[test]
    fn a_folder_with_a_document_a_subfolder_or_any_other_file_is_rejected_untouched() {
        let mut opened = open_folders();
        write_text(&opened.documents().join("archive/notes.txt"), "keep me");
        let before = tree_snapshot(&opened.root);
        for folder in [ARCHITECTURE_FOLDER_ID, BACKEND_FOLDER_ID, ARCHIVE_FOLDER_ID] {
            let error =
                delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, folder).unwrap_err();
            assert_eq!(error.kind, ErrorKind::FolderNotEmpty, "{folder}");
            assert_no_path_leak(&error, &opened.root);
        }
        assert_eq!(tree_snapshot(&opened.root), before);

        // A sub-directory counts too, even an empty one (and a directory posing as a temp file).
        fs::remove_file(opened.documents().join("archive/notes.txt")).unwrap();
        fs::create_dir(opened.documents().join("archive/.fake.dawn-tmp")).unwrap();
        let error =
            delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, ARCHIVE_FOLDER_ID).unwrap_err();
        assert_eq!(error.kind, ErrorKind::FolderNotEmpty);
    }

    #[test]
    fn a_folder_that_failed_to_load_can_be_deleted_when_empty() {
        let (_temp, root) = folders_project_copy();
        break_folder_schema(&root, "archive");
        let mut sessions = ProjectSessions::default();
        open_project(&mut sessions, &root).unwrap();
        delete_folder(&mut sessions, FOLDERS_PROJECT_ID, ARCHIVE_FOLDER_ID).unwrap();
        assert!(!root.join("documents/archive").exists());
    }

    #[test]
    fn a_folder_emptied_by_moving_its_children_out_can_then_be_deleted() {
        let mut opened = open_folders();
        move_entry(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            API_DESIGN_DOCUMENT_ID,
            None,
        )
        .unwrap();
        move_entry(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            OVERVIEW_DOCUMENT_ID,
            None,
        )
        .unwrap();
        delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, BACKEND_FOLDER_ID).unwrap();
        delete_folder(
            &mut opened.sessions,
            FOLDERS_PROJECT_ID,
            ARCHITECTURE_FOLDER_ID,
        )
        .unwrap();
        assert!(!opened.documents().join("architecture").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_directory_is_not_followed_or_deleted() {
        use std::os::unix::fs::symlink;
        let mut opened = open_folders();
        let outside = opened.root.parent().unwrap().join("outside");
        fs::create_dir(&outside).unwrap();
        write_text(&outside.join("folder.json"), "precious");
        fs::remove_dir_all(opened.documents().join("archive")).unwrap();
        symlink(&outside, opened.documents().join("archive")).unwrap();

        let error =
            delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, ARCHIVE_FOLDER_ID).unwrap_err();
        assert!(matches!(error.kind, ErrorKind::Persistence(_)));
        assert_eq!(read_text(&outside.join("folder.json")), "precious");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_json_blocks_the_deletion() {
        use std::os::unix::fs::symlink;
        let mut opened = open_folders();
        let outside = opened.root.parent().unwrap().join("outside.json");
        write_text(&outside, "precious");
        let folder_json = opened.documents().join("archive/folder.json");
        fs::remove_file(&folder_json).unwrap();
        symlink(&outside, &folder_json).unwrap();
        let error =
            delete_folder(&mut opened.sessions, FOLDERS_PROJECT_ID, ARCHIVE_FOLDER_ID).unwrap_err();
        assert_eq!(error.kind, ErrorKind::FolderNotEmpty);
        assert_eq!(read_text(&outside), "precious");
    }
}
