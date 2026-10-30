//! Folder selection with a fake picker (the real OS dialog cannot be driven headlessly), and
//! the select -> open / create flow built on it.

mod support;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::folder_selection::{
    resolve_selection, select_project_folder, FolderPicker, FolderPickerError, FolderSelection,
    FolderSelectionState,
};
use design_dawn_lib::application::project_operations::{create_project, open_project};
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use serde_json::json;
use support::*;

const UUID_VERSION_7: usize = 7;
const PROJECT_NAME: &str = "Created Here";

type PickerOutcome = Result<Option<PathBuf>, FolderPickerError>;

/// Replays prepared dialog outcomes in order (`Mutex` because `FolderPicker` is `Send + Sync`).
struct FakePicker {
    outcomes: Mutex<VecDeque<PickerOutcome>>,
}

impl FakePicker {
    fn new(outcomes: Vec<PickerOutcome>) -> Self {
        Self {
            outcomes: Mutex::new(outcomes.into()),
        }
    }

    fn choosing(path: &Path) -> Self {
        Self::new(vec![Ok(Some(path.to_path_buf()))])
    }
}

impl FolderPicker for FakePicker {
    fn pick_folder(&self) -> PickerOutcome {
        self.outcomes
            .lock()
            .unwrap()
            .pop_front()
            .expect("fake picker has no outcome left")
    }
}

const WINDOW_LABEL: &str = "main";

fn select(picker: &FakePicker, state: &Mutex<FolderSelectionState>) -> FolderSelection {
    select_project_folder(picker, state, WINDOW_LABEL).expect("selection result")
}

fn selected_id(selection: &FolderSelection) -> String {
    match selection {
        FolderSelection::Selected { selection_id, .. } => selection_id.clone(),
        FolderSelection::Cancelled => panic!("expected a selection"),
    }
}

fn state() -> Mutex<FolderSelectionState> {
    Mutex::new(FolderSelectionState::default())
}

#[test]
fn selected_folder_is_held_with_a_uuid_v7_id_and_display_path() {
    let state = state();
    let path = PathBuf::from("/some/chosen/folder");
    let selection = select(&FakePicker::choosing(&path), &state);

    let FolderSelection::Selected {
        selection_id,
        display_path,
    } = &selection
    else {
        panic!("expected a selection");
    };
    assert_eq!(display_path, &path.display().to_string());
    let parsed = uuid::Uuid::parse_str(selection_id).expect("selection id is a UUID");
    assert_eq!(parsed.get_version_num(), UUID_VERSION_7);
    assert_eq!(
        resolve_selection(&state, WINDOW_LABEL, selection_id).unwrap(),
        path
    );
}

#[test]
fn cancelling_is_a_normal_result_and_keeps_the_previous_selection() {
    let state = state();
    let path = PathBuf::from("/kept");
    let first = selected_id(&select(&FakePicker::choosing(&path), &state));

    let cancelled = select(&FakePicker::new(vec![Ok(None)]), &state);
    assert_eq!(cancelled, FolderSelection::Cancelled);
    assert_eq!(
        resolve_selection(&state, WINDOW_LABEL, &first).unwrap(),
        path
    );
}

#[test]
fn a_picker_failure_is_dialog_failed_and_keeps_the_previous_selection() {
    let state = state();
    let path = PathBuf::from("/kept");
    let first = selected_id(&select(&FakePicker::choosing(&path), &state));

    let failing = FakePicker::new(vec![Err(FolderPickerError::new("no display"))]);
    let error = select_project_folder(&failing, &state, WINDOW_LABEL).unwrap_err();
    assert_eq!(error.kind, ErrorKind::DialogFailed);
    assert_eq!(error.detail, "no display");
    assert_eq!(
        resolve_selection(&state, WINDOW_LABEL, &first).unwrap(),
        path
    );
}

#[test]
fn a_new_selection_invalidates_the_previous_id() {
    let state = state();
    let first = selected_id(&select(&FakePicker::choosing(Path::new("/one")), &state));
    let second = selected_id(&select(&FakePicker::choosing(Path::new("/two")), &state));

    assert_ne!(first, second);
    assert_eq!(
        resolve_selection(&state, WINDOW_LABEL, &first)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidFolderSelection
    );
    assert_eq!(
        resolve_selection(&state, WINDOW_LABEL, &second).unwrap(),
        PathBuf::from("/two")
    );
}

#[test]
fn a_selection_id_resolves_only_for_its_own_window() {
    let state = state();
    let id = selected_id(&select(&FakePicker::choosing(Path::new("/one")), &state));
    assert_eq!(
        resolve_selection(&state, "window-1", &id).unwrap_err().kind,
        ErrorKind::InvalidFolderSelection
    );
    assert!(resolve_selection(&state, WINDOW_LABEL, &id).is_ok());
    let other = selected_id(
        &select_project_folder(&FakePicker::choosing(Path::new("/two")), &state, "window-1")
            .unwrap(),
    );
    assert_eq!(
        resolve_selection(&state, "window-1", &other).unwrap(),
        PathBuf::from("/two")
    );
    // The other window's selection did not replace this window's.
    assert!(resolve_selection(&state, WINDOW_LABEL, &id).is_ok());
}

#[test]
fn discarding_a_window_forgets_only_its_selection() {
    let state = state();
    let id = selected_id(&select(&FakePicker::choosing(Path::new("/one")), &state));
    state.lock().unwrap().discard_window("window-1");
    assert!(resolve_selection(&state, WINDOW_LABEL, &id).is_ok());
    state.lock().unwrap().discard_window(WINDOW_LABEL);
    assert!(resolve_selection(&state, WINDOW_LABEL, &id).is_err());
}

#[test]
fn unknown_ids_are_invalid_folder_selections() {
    let state = state();
    assert_eq!(
        resolve_selection(&state, WINDOW_LABEL, UNKNOWN_ID)
            .unwrap_err()
            .kind,
        ErrorKind::InvalidFolderSelection
    );
    select(&FakePicker::choosing(Path::new("/one")), &state);
    for id in [UNKNOWN_ID, "", "/one"] {
        assert_eq!(
            resolve_selection(&state, WINDOW_LABEL, id)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidFolderSelection
        );
    }
}

#[test]
fn selection_results_serialize_to_the_documented_shapes() {
    let selected = FolderSelection::Selected {
        selection_id: UNKNOWN_ID.to_owned(),
        display_path: "/p".to_owned(),
    };
    assert_eq!(
        serde_json::to_value(&selected).unwrap(),
        json!({ "status": "selected", "selectionId": UNKNOWN_ID, "displayPath": "/p" })
    );
    assert_eq!(
        serde_json::to_value(FolderSelection::Cancelled).unwrap(),
        json!({ "status": "cancelled" })
    );
}

#[test]
fn error_kinds_use_the_documented_identifiers() {
    assert_eq!(ErrorKind::DialogFailed.as_str(), "dialogFailed");
    assert_eq!(
        ErrorKind::InvalidFolderSelection.as_str(),
        "invalidFolderSelection"
    );
}

// ---- select -> open / create ----

#[test]
fn select_then_open_an_existing_project_succeeds() {
    let (_temp, root) = project_copy();
    let state = state();
    let id = selected_id(&select(&FakePicker::choosing(&root), &state));

    let path = resolve_selection(&state, WINDOW_LABEL, &id).unwrap();
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, &path).expect("open selected project");
    assert_eq!(snapshot.project.project_id, PROJECT_ID);
    // A successful open keeps the selection.
    assert!(resolve_selection(&state, WINDOW_LABEL, &id).is_ok());
}

#[test]
fn a_failed_open_writes_nothing_and_the_same_selection_can_create_the_project() {
    let temp = TempDir::new();
    let folder = temp.path().join("empty");
    std::fs::create_dir(&folder).unwrap();
    let state = state();
    let id = selected_id(&select(&FakePicker::choosing(&folder), &state));
    let before = tree_snapshot(&folder);

    let mut sessions = ProjectSessions::default();
    let path = resolve_selection(&state, WINDOW_LABEL, &id).unwrap();
    let error = open_project(&mut sessions, &path).unwrap_err();
    assert_eq!(
        error.kind,
        ErrorKind::Persistence(PersistenceErrorKind::FileNotFound)
    );
    assert_eq!(tree_snapshot(&folder), before);

    let path =
        resolve_selection(&state, WINDOW_LABEL, &id).expect("selection survives a failed open");
    let snapshot = create_project(&mut sessions, &path, PROJECT_NAME).expect("create here");
    assert_eq!(snapshot.project.name, PROJECT_NAME);
    assert!(folder.join("project.json").is_file());
}

#[test]
fn selecting_never_touches_the_directory_and_does_not_validate_it() {
    let (_temp, root) = project_copy();
    let before = tree_snapshot(&root);
    let state = state();
    select(&FakePicker::choosing(&root), &state);
    assert_eq!(tree_snapshot(&root), before);

    let missing = root.join("does").join("not").join("exist");
    let selection = select(&FakePicker::choosing(&missing), &state);
    assert!(matches!(selection, FolderSelection::Selected { .. }));
    assert!(!root.join("does").exists());
}
