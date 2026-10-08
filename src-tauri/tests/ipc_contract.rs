//! Runs every file in `fixtures/ipc/` through the real Tauri IPC pipeline (mock
//! runtime, real `tauri.conf.json` and capability file, the same `configure` as production):
//! argument deserialization, managed state, ACL, Application layer, filesystem, and the
//! serialized response or error. The TypeScript side replays the same file against the client
//! wrappers, so both ends are pinned to one contract. See docs/testing.md.
//!
//! Not covered by the mock runtime: the JS `invoke` serialization (no webview) and the native
//! folder dialog (replaced by a fake picker).

mod support;

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use design_dawn_lib::application::folder_selection::{FolderPicker, FolderPickerError};
use design_dawn_lib::application::local_state::operations::{LocalState, LocalStateDirectories};
use design_dawn_lib::application::window_registry::WindowRegistry;
use design_dawn_lib::commands::SharedFolderPicker;
use serde_json::Value;
use support::*;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindowBuilder};

const FIXTURE_DIRECTORY: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/ipc");
const SUPPORTED_FIXTURE_VERSION: u64 = 1;
const SELECTION_ID_PLACEHOLDER: &str = "$selectionId";
const CURRENT_TARGET: &str = "rust";
/// The only window the default capability applies to (capabilities/default.json).
const MAIN_WINDOW_LABEL: &str = "main";
const OTHER_WINDOW_LABEL: &str = "not-granted";
/// A second window the capability covers (`window-*`), like the ones Step F will create.
const SECOND_WINDOW_LABEL: &str = "window-1";
/// The origin of the app's own frontend; ACL treats it as a local URL.
const LOCAL_ORIGIN: &str = "tauri://localhost";
const EMPTY_DIRECTORY_NAME: &str = "empty";
const PROJECT_DIRECTORY_NAME: &str = "project";
const CONFIG_DIRECTORY_NAME: &str = "config";
const LOCAL_DATA_DIRECTORY_NAME: &str = "local-data";

/// What the fake dialog does when the fixture says `folderPicker: [...]`.
#[derive(Clone)]
enum PickerOutcome {
    Folder(PathBuf),
    Cancelled,
    Failed,
}

struct FakePicker {
    outcomes: Mutex<VecDeque<PickerOutcome>>,
}

impl FolderPicker for FakePicker {
    fn pick_folder(&self) -> Result<Option<PathBuf>, FolderPickerError> {
        let outcome = self
            .outcomes
            .lock()
            .unwrap()
            .pop_front()
            .expect("fake picker has no outcome left");
        match outcome {
            PickerOutcome::Folder(path) => Ok(Some(path)),
            PickerOutcome::Cancelled => Ok(None),
            PickerOutcome::Failed => Err(FolderPickerError::new("fake dialog failure")),
        }
    }
}

/// A fresh `LocalState` per app instance, so scenarios never share settings or viewports and
/// nothing is written outside the scenario's temporary directory.
fn build_app(
    outcomes: Vec<PickerOutcome>,
    directories: LocalStateDirectories,
) -> App<tauri::test::MockRuntime> {
    let picker: SharedFolderPicker = Arc::new(FakePicker {
        outcomes: Mutex::new(outcomes.into()),
    });
    design_dawn_lib::configure(mock_builder())
        .manage(picker)
        .manage(LocalState::new(directories))
        // The real context, so the real capability / app manifest is enforced.
        .build(tauri::generate_context!())
        .expect("build app")
}

fn request(command: &str, args: &Value) -> InvokeRequest {
    InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: LOCAL_ORIGIN.parse().unwrap(),
        body: InvokeBody::Json(args.clone()),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

/// `Ok(json)` for a command success, `Err(json)` for whatever the rejection carried.
fn invoke<W: AsRef<tauri::Webview<tauri::test::MockRuntime>>>(
    webview: &W,
    command: &str,
    args: &Value,
) -> Result<Value, Value> {
    get_ipc_response(webview, request(command, args))
        .map(|body| body.deserialize::<Value>().expect("response is JSON"))
}

fn substitute_selection_id(value: &Value, selection_id: Option<&str>) -> Value {
    match value {
        Value::String(text) if text == SELECTION_ID_PLACEHOLDER => selection_id
            .map(|id| Value::String(id.to_owned()))
            .unwrap_or_else(|| value.clone()),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| substitute_selection_id(item, selection_id))
                .collect(),
        ),
        Value::Object(entries) => Value::Object(
            entries
                .iter()
                .map(|(key, item)| (key.clone(), substitute_selection_id(item, selection_id)))
                .collect(),
        ),
        other => other.clone(),
    }
}

struct Comparison<'a> {
    /// Dotted paths whose value only has to be a non-empty string.
    string_only_paths: Vec<&'a str>,
    selection_id: &'a mut Option<String>,
    mismatches: Vec<String>,
}

impl Comparison<'_> {
    fn compare(&mut self, path: &str, expected: &Value, actual: &Value) {
        if self.string_only_paths.contains(&path) {
            if !matches!(actual, Value::String(text) if !text.is_empty()) {
                self.mismatches
                    .push(format!("{path}: expected a non-empty string, got {actual}"));
            }
            return;
        }
        if matches!(expected, Value::String(text) if text == SELECTION_ID_PLACEHOLDER) {
            self.compare_selection_id(path, actual);
            return;
        }
        match (expected, actual) {
            (Value::Object(expected_entries), Value::Object(actual_entries)) => {
                for (key, expected_value) in expected_entries {
                    let child = join_path(path, key);
                    match actual_entries.get(key) {
                        Some(actual_value) => self.compare(&child, expected_value, actual_value),
                        None => self
                            .mismatches
                            .push(format!("{child}: missing in response")),
                    }
                }
                for key in actual_entries.keys() {
                    if !expected_entries.contains_key(key) {
                        self.mismatches.push(format!(
                            "{}: unexpected key in response",
                            join_path(path, key)
                        ));
                    }
                }
            }
            (Value::Array(expected_items), Value::Array(actual_items)) => {
                if expected_items.len() != actual_items.len() {
                    self.mismatches.push(format!(
                        "{path}: expected {} items, got {}",
                        expected_items.len(),
                        actual_items.len()
                    ));
                    return;
                }
                for (index, (expected_item, actual_item)) in
                    expected_items.iter().zip(actual_items).enumerate()
                {
                    self.compare(
                        &join_path(path, &index.to_string()),
                        expected_item,
                        actual_item,
                    );
                }
            }
            // JSON has one number type; serde_json would otherwise tell `-48` from `-48.0`,
            // which JavaScript (the real consumer) cannot.
            (Value::Number(expected_number), Value::Number(actual_number))
                if expected_number.as_f64() == actual_number.as_f64() => {}
            _ if expected == actual => {}
            _ => self
                .mismatches
                .push(format!("{path}: expected {expected}, got {actual}")),
        }
    }

    /// The first placeholder in a response captures the id issued by Rust; later ones must match.
    fn compare_selection_id(&mut self, path: &str, actual: &Value) {
        let Value::String(id) = actual else {
            self.mismatches
                .push(format!("{path}: selectionId is not a string: {actual}"));
            return;
        };
        match self.selection_id {
            None if !id.is_empty() => *self.selection_id = Some(id.clone()),
            Some(known) if known == id => {}
            _ => self
                .mismatches
                .push(format!("{path}: unexpected selectionId {id}")),
        }
    }
}

fn join_path(parent: &str, key: &str) -> String {
    if parent.is_empty() {
        key.to_owned()
    } else {
        format!("{parent}.{key}")
    }
}

fn targets_rust(case: &Value) -> bool {
    match case.get("targets") {
        None => true,
        Some(targets) => targets
            .as_array()
            .expect("targets is an array")
            .iter()
            .any(|target| target == CURRENT_TARGET),
    }
}

fn run_case(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    case: &Value,
    selection_id: &mut Option<String>,
) -> Vec<String> {
    let request_value = &case["request"];
    let command = request_value["command"].as_str().expect("command");
    let args = substitute_selection_id(&request_value["args"], selection_id.as_deref());
    let outcome = invoke(webview, command, &args);
    let expected = &case["expected"];
    let string_only_paths: Vec<&str> = case
        .get("ignoreValuePaths")
        .and_then(Value::as_array)
        .map(|paths| paths.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();

    if let Some(expected_ok) = expected.get("ok") {
        return match outcome {
            Ok(actual) => {
                let mut comparison = Comparison {
                    string_only_paths,
                    selection_id,
                    mismatches: Vec::new(),
                };
                comparison.compare("", expected_ok, &actual);
                comparison.mismatches
            }
            Err(error) => vec![format!("expected ok, got rejection {error}")],
        };
    }
    if let Some(expected_error) = expected.get("error") {
        return match outcome {
            Err(Value::Object(actual)) => {
                let mut problems = Vec::new();
                if actual.get("kind") != expected_error.get("kind") {
                    problems.push(format!(
                        "expected kind {}, got {:?}",
                        expected_error["kind"],
                        actual.get("kind")
                    ));
                }
                if !matches!(actual.get("detail"), Some(Value::String(text)) if !text.is_empty()) {
                    problems.push("detail is not a non-empty string".to_owned());
                }
                if actual.len() != 2 {
                    problems.push(format!("error has unexpected keys: {actual:?}"));
                }
                problems
            }
            other => vec![format!("expected a {{kind, detail}} error, got {other:?}")],
        };
    }
    if expected.get("tauriError") == Some(&Value::Bool(true)) {
        // Tauri's own refusals (argument errors, ACL) are plain strings, never `{kind, detail}`.
        return match outcome {
            Err(Value::String(message)) if !message.is_empty() => Vec::new(),
            other => vec![format!("expected a Tauri string error, got {other:?}")],
        };
    }
    vec!["expected must be ok, error or tauriError".to_owned()]
}

fn local_state_directories(root: &Path) -> LocalStateDirectories {
    LocalStateDirectories {
        config_dir: root.join(CONFIG_DIRECTORY_NAME),
        local_data_dir: root.join(LOCAL_DATA_DIRECTORY_NAME),
    }
}

fn picker_outcomes(
    names: &[Value],
    project_root: &Path,
    empty_directory: &Path,
) -> Vec<PickerOutcome> {
    names
        .iter()
        .map(|name| match name.as_str().expect("picker outcome") {
            "projectCopy" => PickerOutcome::Folder(project_root.to_path_buf()),
            "emptyDirectory" => PickerOutcome::Folder(empty_directory.to_path_buf()),
            "cancelled" => PickerOutcome::Cancelled,
            "failed" => PickerOutcome::Failed,
            unknown => panic!("unknown folderPicker outcome {unknown}"),
        })
        .collect()
}

fn contract_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(FIXTURE_DIRECTORY)
        .expect("read fixture directory")
        .map(|entry| entry.expect("directory entry").path())
        .collect();
    files.sort();
    files
}

/// Returns (executed, mismatches) for one contract file.
fn run_contract_file(file: &Path) -> (usize, Vec<String>) {
    let fixture: Value =
        serde_json::from_str(&fs::read_to_string(file).expect("read fixture")).unwrap();
    assert_eq!(fixture["fixtureVersion"], SUPPORTED_FIXTURE_VERSION);
    assert_eq!(fixture["selectionIdPlaceholder"], SELECTION_ID_PLACEHOLDER);

    let mut mismatches = Vec::new();
    let mut executed = 0;
    for scenario in fixture["scenarios"].as_array().expect("scenarios") {
        let scenario_name = scenario["name"].as_str().expect("scenario name");
        let temp = TempDir::new();
        let project_root = temp.path().join(PROJECT_DIRECTORY_NAME);
        // A scenario may name another sample project; the default is the basic one.
        let fixture_project = scenario.get("project").and_then(Value::as_str).map_or_else(
            || PathBuf::from(FIXTURE_PROJECT),
            |name| Path::new(FIXTURE_PROJECTS_DIRECTORY).join(name),
        );
        copy_dir_all(&fixture_project, &project_root);
        let empty_directory = temp.path().join(EMPTY_DIRECTORY_NAME);
        fs::create_dir_all(&empty_directory).unwrap();

        // Scenarios that never open a dialog (local state) omit `folderPicker`.
        let picker_names = scenario
            .get("folderPicker")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let outcomes = picker_outcomes(picker_names, &project_root, &empty_directory);
        let app = build_app(outcomes, local_state_directories(temp.path()));
        let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
            .build()
            .expect("create main window");

        let mut selection_id = None;
        for case in scenario["cases"].as_array().expect("cases") {
            if !targets_rust(case) {
                continue;
            }
            executed += 1;
            let case_name = case["name"].as_str().expect("case name");
            for problem in run_case(&webview, case, &mut selection_id) {
                mismatches.push(format!("[{scenario_name}] {case_name}: {problem}"));
            }
        }
    }
    (executed, mismatches)
}

#[test]
fn every_contract_case_matches_the_real_ipc_response() {
    let files = contract_files();
    assert!(!files.is_empty(), "no contract file found");
    let mut executed = 0;
    let mut mismatches = Vec::new();
    for file in &files {
        let name = file.file_name().unwrap().to_string_lossy().into_owned();
        let (file_executed, file_mismatches) = run_contract_file(file);
        executed += file_executed;
        mismatches.extend(file_mismatches.into_iter().map(|m| format!("{name} {m}")));
    }

    assert!(
        mismatches.is_empty(),
        "{} of {executed} contract cases mismatched:\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
    println!("contract cases executed: {executed}");
}

#[test]
fn a_window_without_the_capability_is_refused_by_tauri() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, OTHER_WINDOW_LABEL, Default::default())
        .build()
        .expect("create window");

    let outcome = invoke(
        &webview,
        "open_project",
        &serde_json::json!({ "selectionId": "x" }),
    );

    match outcome {
        Err(Value::String(message)) => assert!(message.contains("not allowed"), "{message}"),
        other => panic!("expected a Tauri ACL refusal, got {other:?}"),
    }
    assert!(app.get_webview_window(MAIN_WINDOW_LABEL).is_none());
}

/// Opens the fixture project through real IPC in a fresh main window and returns the app (kept
/// alive), the window, the project root and the project id.
struct OpenedProject {
    app: App<tauri::test::MockRuntime>,
    webview: tauri::WebviewWindow<tauri::test::MockRuntime>,
    project_root: PathBuf,
    project_id: String,
}

fn open_fixture_project(temp: &TempDir) -> OpenedProject {
    open_fixture_project_with_pickers(temp, Vec::new())
}

/// `later_outcomes` follow the one folder choice the main window makes to open the project.
fn open_fixture_project_with_pickers(
    temp: &TempDir,
    later_outcomes: Vec<PickerOutcome>,
) -> OpenedProject {
    let project_root = temp.path().join(PROJECT_DIRECTORY_NAME);
    copy_dir_all(Path::new(FIXTURE_PROJECT), &project_root);
    let mut outcomes = vec![PickerOutcome::Folder(project_root.clone())];
    outcomes.extend(later_outcomes);
    let app = build_app(outcomes, local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");
    let selection = invoke(&webview, "select_project_folder", &serde_json::json!({})).unwrap();
    let snapshot = invoke(
        &webview,
        "open_project",
        &serde_json::json!({ "selectionId": selection["selectionId"] }),
    )
    .unwrap();
    let project_id = snapshot["project"]["projectId"]
        .as_str()
        .unwrap()
        .to_owned();
    // Only an opened Document is served and receives assets, like the Frontend's first step.
    invoke(
        &webview,
        "load_document",
        &serde_json::json!({ "projectId": project_id, "documentId": DOCUMENT_ID }),
    )
    .unwrap();
    OpenedProject {
        app,
        webview,
        project_root,
        project_id,
    }
}

fn assert_refused_by_acl(outcome: Result<Value, Value>) {
    match outcome {
        Err(Value::String(message)) => assert!(message.contains("not allowed"), "{message}"),
        other => panic!("expected a Tauri ACL refusal, got {other:?}"),
    }
}

/// Drop events are the one input that originates in the OS window rather than in a command.
/// The handler is called directly (a mock window cannot receive a native drop), and the
/// notifications it sends are captured by a Rust-made channel installed as the subscriber;
/// the import then runs through real IPC.
#[test]
fn a_native_drop_is_announced_without_paths_and_imported_through_the_command() {
    use design_dawn_lib::commands::{handle_window_event, DropNotification, DropSubscriber};
    use tauri::ipc::{Channel, InvokeResponseBody};
    use tauri::{DragDropEvent, PhysicalPosition, WindowEvent};

    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let (webview, project_root, project_id) =
        (&opened.webview, &opened.project_root, &opened.project_id);

    let messages = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&messages);
    opened.app.state::<DropSubscriber>().replace(
        MAIN_WINDOW_LABEL,
        Channel::<DropNotification>::new(move |body| {
            match body {
                InvokeResponseBody::Json(json) => sink.lock().unwrap().push(json),
                InvokeResponseBody::Raw(_) => panic!("notifications are JSON"),
            }
            Ok(())
        }),
    );

    let source = temp.path().join("dropped picture.png");
    fs::write(&source, png_bytes(1920, 1080)).unwrap();
    let window = AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(webview).window();
    let position = PhysicalPosition::new(0.0, 0.0);
    let paths = vec![source.clone()];
    for event in [
        DragDropEvent::Enter {
            paths: paths.clone(),
            position,
        },
        DragDropEvent::Over { position },
        DragDropEvent::Leave,
        DragDropEvent::Drop { paths, position },
    ] {
        handle_window_event(&window, &WindowEvent::DragDrop(event));
    }

    let temp_text = temp.path().to_string_lossy().into_owned();
    let received = messages.lock().unwrap().clone();
    assert_eq!(received.len(), 5, "{received:?}");
    for message in &received {
        assert!(!message.contains(&temp_text), "{message}");
        assert!(!message.contains("dropped"), "{message}");
    }
    assert_eq!(
        received[..4],
        [
            r#"{"kind":"dragState","active":true}"#,
            r#"{"kind":"dragState","active":true}"#,
            r#"{"kind":"dragState","active":false}"#,
            r#"{"kind":"dragState","active":false}"#,
        ]
    );
    let announced: Value = serde_json::from_str(&received[4]).unwrap();
    assert_eq!(announced["kind"], "filesDropped");
    assert_eq!(announced["fileCount"], 1);
    let mut keys: Vec<&String> = announced.as_object().unwrap().keys().collect();
    keys.sort();
    assert_eq!(keys, ["dropId", "fileCount", "kind"]);

    let result = invoke(
        webview,
        "import_dropped_images",
        &serde_json::json!({
            "dropId": announced["dropId"],
            "projectId": project_id,
            "documentId": DOCUMENT_ID,
        }),
    )
    .unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "imported": [{
                "contentPath": "assets/dropped-picture.png",
                "naturalWidth": 1920,
                "naturalHeight": 1080,
                "initialWidth": 480,
                "initialHeight": 270,
                "blockType": "image",
            }],
            "rejected": [],
        })
    );
    assert!(document_dir(project_root)
        .join("assets/dropped-picture.png")
        .is_file());
}

/// Before the Frontend subscribed there is nobody to tell; the handler must not fail.
#[test]
fn a_native_drop_without_a_subscriber_is_ignored_quietly() {
    use design_dawn_lib::commands::handle_window_event;
    use tauri::{DragDropEvent, PhysicalPosition, WindowEvent};

    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let source = temp.path().join("quiet.png");
    fs::write(&source, png_bytes(10, 10)).unwrap();
    let window =
        AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(&opened.webview).window();
    handle_window_event(
        &window,
        &WindowEvent::DragDrop(DragDropEvent::Drop {
            paths: vec![source],
            position: PhysicalPosition::new(0.0, 0.0),
        }),
    );
}

#[test]
fn subscribing_to_drop_notifications_with_a_channel_succeeds() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");

    let outcome = invoke(
        &webview,
        "subscribe_drop_notifications",
        &serde_json::json!({ "channel": "__CHANNEL__:7" }),
    );

    assert_eq!(outcome, Ok(Value::Null));
}

#[test]
fn subscribing_with_a_malformed_channel_is_a_tauri_error() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");

    let outcome = invoke(
        &webview,
        "subscribe_drop_notifications",
        &serde_json::json!({ "channel": "not-a-channel" }),
    );

    assert!(matches!(outcome, Err(Value::String(_))), "{outcome:?}");
}

const CHANNEL_ARGUMENT: &str = "__CHANNEL__:9";

fn subscribe_close_requests(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>) -> String {
    let outcome = invoke(
        webview,
        "subscribe_close_requests",
        &serde_json::json!({ "channel": CHANNEL_ARGUMENT }),
    );
    match outcome {
        Ok(Value::String(token)) => token,
        other => panic!("expected a token, got {other:?}"),
    }
}

#[test]
fn subscribing_to_close_requests_returns_a_canonical_token_each_time() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");

    let first = subscribe_close_requests(&webview);
    let second = subscribe_close_requests(&webview);

    for token in [&first, &second] {
        let parsed = uuid::Uuid::parse_str(token).expect("a UUID");
        assert_eq!(parsed.get_version_num(), 7);
        assert_eq!(token, &parsed.hyphenated().to_string());
    }
    assert_ne!(first, second);
}

#[test]
fn confirming_with_a_wrong_token_or_without_a_subscription_keeps_the_window() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");
    let confirm = |token: &str| {
        invoke(
            &webview,
            "confirm_window_close",
            &serde_json::json!({ "subscriptionToken": token }),
        )
    };

    assert_eq!(confirm("no-subscription-yet"), Ok(Value::Null));
    assert!(app.get_webview_window(MAIN_WINDOW_LABEL).is_some());

    let stale = subscribe_close_requests(&webview);
    let _current = subscribe_close_requests(&webview);
    assert_eq!(confirm(&stale), Ok(Value::Null));
    assert_eq!(confirm("random"), Ok(Value::Null));
    assert!(app.get_webview_window(MAIN_WINDOW_LABEL).is_some());
}

#[test]
fn confirming_with_the_current_token_succeeds_through_the_destroy_path() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");
    let token = subscribe_close_requests(&webview);

    let outcome = invoke(
        &webview,
        "confirm_window_close",
        &serde_json::json!({ "subscriptionToken": token }),
    );

    assert_eq!(outcome, Ok(Value::Null));
    // Not observable here: the manager drops the window only from the runtime's event loop (the mock's
    // `run_iteration` is a no-op) and the mock's window map is private, so only the accepted path (token matched, `destroy` returned Ok) is asserted.
    // That a wrong token does not reach `destroy` is covered by the pure `accepts` tests.
}

#[test]
fn a_rejected_close_confirmation_records_no_window_size() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");
    subscribe_close_requests(&webview);

    invoke(
        &webview,
        "confirm_window_close",
        &serde_json::json!({ "subscriptionToken": "not-the-token" }),
    )
    .unwrap();

    // The accepted path is not observable: the mock window reports no real size, so only
    // `size_to_record` (unit tests) and `set_window_size` (local_state.rs) cover recording.
    let local_state =
        app.state::<design_dawn_lib::application::local_state::operations::LocalState>();
    assert_eq!(local_state.get_app_settings().window_size, None);
}

/// Tauri's built-in drag-drop events carry absolute paths. They reach a script only through a
/// listener registered with `plugin:event|listen`, so that command must stay refused.
#[test]
fn the_webview_cannot_listen_to_tauris_builtin_drag_events() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");

    for event in ["tauri://drag-drop", "tauri://drag-enter"] {
        let outcome = invoke(
            &webview,
            "plugin:event|listen",
            &serde_json::json!({
                "event": event,
                "target": { "kind": "Any" },
                "handler": 1,
            }),
        );
        assert_refused_by_acl(outcome);
    }
}

#[test]
fn the_webview_cannot_resolve_operating_system_directories() {
    let temp = TempDir::new();
    let app = build_app(Vec::new(), local_state_directories(temp.path()));
    let webview = WebviewWindowBuilder::new(&app, MAIN_WINDOW_LABEL, Default::default())
        .build()
        .expect("create main window");

    let outcome = invoke(
        &webview,
        "plugin:path|resolve_directory",
        &serde_json::json!({ "directory": 11 }),
    );

    assert_refused_by_acl(outcome);
}

/// The rejection is what the webview sees: it must carry neither absolute paths nor the
/// Project's internal directory and file names, even though the internal detail has them.
#[test]
fn a_filesystem_error_rejection_carries_no_path() {
    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    fs::remove_file(document_dir(&opened.project_root).join(OVERVIEW_MARKDOWN_PATH)).unwrap();

    let rejection = invoke(
        &opened.webview,
        "read_block_content",
        &serde_json::json!({
            "projectId": opened.project_id,
            "documentId": DOCUMENT_ID,
            "contentPath": OVERVIEW_MARKDOWN_PATH,
        }),
    )
    .unwrap_err();

    assert_eq!(rejection["kind"], "fileNotFound");
    let text = rejection.to_string();
    for forbidden in [
        temp.path().to_string_lossy().as_ref(),
        "system-design",
        "documents",
        "overview",
        "markdown-1",
        "sheets",
    ] {
        assert!(!text.contains(forbidden), "{forbidden} leaked: {text}");
    }
}

#[test]
fn close_document_through_ipc_stops_the_asset_from_being_served() {
    use design_dawn_lib::application::session::ProjectSessions;
    use design_dawn_lib::commands::respond_to_asset_request;

    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let uri: tauri::http::Uri = format!(
        "dawn-asset://localhost/{}/{DOCUMENT_ID}/assets/pixel.png",
        opened.project_id
    )
    .parse()
    .unwrap();
    let serve = || {
        let sessions = opened.app.state::<Mutex<ProjectSessions>>();
        let registry = opened.app.state::<Mutex<WindowRegistry>>();
        respond_to_asset_request(&sessions, &registry, MAIN_WINDOW_LABEL, &uri).status()
    };
    assert_eq!(serve(), 200);

    invoke(
        &opened.webview,
        "close_document",
        &serde_json::json!({ "projectId": opened.project_id, "documentId": DOCUMENT_ID }),
    )
    .unwrap();

    assert_eq!(serve(), 404);
}

// ---- Step D: per-window Project binding (docs/architecture.md §11.0.1) ----

fn second_window(opened: &OpenedProject) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
    WebviewWindowBuilder::new(&opened.app, SECOND_WINDOW_LABEL, Default::default())
        .build()
        .expect("create second window")
}

fn pick_folder_in(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>) -> Value {
    invoke(webview, "select_project_folder", &serde_json::json!({})).unwrap()["selectionId"].clone()
}

fn read_overview_markdown(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    project_id: &str,
) -> Result<Value, Value> {
    invoke(
        webview,
        "read_block_content",
        &serde_json::json!({
            "projectId": project_id,
            "documentId": DOCUMENT_ID,
            "contentPath": OVERVIEW_MARKDOWN_PATH,
        }),
    )
}

fn error_kind(outcome: Result<Value, Value>) -> String {
    outcome.unwrap_err()["kind"]
        .as_str()
        .expect("a {kind, detail} error")
        .to_owned()
}

#[test]
fn a_window_outside_main_but_matching_the_pattern_may_call_commands() {
    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let second = second_window(&opened);
    assert!(invoke(&second, "get_app_settings", &serde_json::json!({})).is_ok());
}

#[test]
fn opening_a_project_bound_to_another_window_is_refused_and_keeps_its_session() {
    let temp = TempDir::new();
    let opened = open_fixture_project_with_pickers(
        &temp,
        vec![PickerOutcome::Folder(
            temp.path().join(PROJECT_DIRECTORY_NAME),
        )],
    );
    let second = second_window(&opened);
    let selection_id = pick_folder_in(&second);

    let outcome = invoke(
        &second,
        "open_project",
        &serde_json::json!({ "selectionId": selection_id }),
    );

    assert_eq!(error_kind(outcome), "projectOpenInOtherWindow");
    assert!(read_overview_markdown(&opened.webview, &opened.project_id).is_ok());
    let registry = opened.app.state::<Mutex<WindowRegistry>>();
    let registry = registry.lock().unwrap();
    assert_eq!(registry.project_of(SECOND_WINDOW_LABEL), None);
    assert!(registry.project_of(MAIN_WINDOW_LABEL).is_some());
}

#[test]
fn a_window_cannot_use_the_commands_on_another_windows_project() {
    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let second = second_window(&opened);
    let project_id = &opened.project_id;

    assert_eq!(
        error_kind(read_overview_markdown(&second, project_id)),
        "projectNotOpen"
    );
    for (command, args) in [
        (
            "load_document",
            serde_json::json!({ "projectId": project_id, "documentId": DOCUMENT_ID }),
        ),
        (
            "close_document",
            serde_json::json!({ "projectId": project_id, "documentId": DOCUMENT_ID }),
        ),
        (
            "delete_document",
            serde_json::json!({ "projectId": project_id, "documentId": DOCUMENT_ID }),
        ),
        (
            "write_block_content",
            serde_json::json!({
                "projectId": project_id,
                "documentId": DOCUMENT_ID,
                "contentPath": OVERVIEW_MARKDOWN_PATH,
                "text": "overwritten",
            }),
        ),
        (
            "import_dropped_images",
            serde_json::json!({
                "dropId": "x",
                "projectId": project_id,
                "documentId": DOCUMENT_ID,
            }),
        ),
        (
            "copy_asset_to_document",
            serde_json::json!({
                "projectId": project_id,
                "sourceDocumentId": DOCUMENT_ID,
                "contentPath": "assets/pixel.png",
                "targetDocumentId": DOCUMENT_ID,
            }),
        ),
    ] {
        assert_eq!(
            error_kind(invoke(&second, command, &args)),
            "projectNotOpen",
            "{command}"
        );
    }
    // Nothing happened to the owner's data.
    let text = read_overview_markdown(&opened.webview, project_id).unwrap();
    assert_ne!(text, Value::String("overwritten".to_owned()));
}

#[test]
fn closing_the_project_unbinds_it_so_another_window_can_open_it() {
    let temp = TempDir::new();
    let opened = open_fixture_project_with_pickers(
        &temp,
        vec![PickerOutcome::Folder(
            temp.path().join(PROJECT_DIRECTORY_NAME),
        )],
    );
    let second = second_window(&opened);

    assert_eq!(
        invoke(&opened.webview, "close_project", &serde_json::json!({})),
        Ok(Value::Null)
    );
    // Closing again, or from a window with no Project, is harmless.
    assert_eq!(
        invoke(&opened.webview, "close_project", &serde_json::json!({})),
        Ok(Value::Null)
    );
    assert_eq!(
        error_kind(read_overview_markdown(&opened.webview, &opened.project_id)),
        "projectNotOpen"
    );

    let selection_id = pick_folder_in(&second);
    let snapshot = invoke(
        &second,
        "open_project",
        &serde_json::json!({ "selectionId": selection_id }),
    )
    .unwrap();
    assert_eq!(snapshot["project"]["projectId"], opened.project_id);
}

#[test]
fn what_one_window_selected_or_dropped_or_subscribed_is_unusable_from_another() {
    use design_dawn_lib::commands::{handle_window_event, DropNotification, DropSubscriber};
    use tauri::ipc::{Channel, InvokeResponseBody};
    use tauri::{DragDropEvent, PhysicalPosition, WindowEvent};

    let temp = TempDir::new();
    let empty_root = temp.path().join(EMPTY_DIRECTORY_NAME);
    let opened = open_fixture_project_with_pickers(
        &temp,
        vec![
            PickerOutcome::Folder(temp.path().join(PROJECT_DIRECTORY_NAME)),
            PickerOutcome::Folder(empty_root),
        ],
    );
    let second = second_window(&opened);

    // A folder selection made by main cannot be consumed by the second window.
    let main_selection = pick_folder_in(&opened.webview);
    assert_eq!(
        error_kind(invoke(
            &second,
            "open_project",
            &serde_json::json!({ "selectionId": main_selection }),
        )),
        "invalidFolderSelection"
    );

    // The second window gets its own Project (a fresh one) to pass the Project check.
    let second_selection = pick_folder_in(&second);
    let created = invoke(
        &second,
        "create_project",
        &serde_json::json!({ "selectionId": second_selection, "name": "Second" }),
    )
    .unwrap();
    let second_project_id = created["project"]["projectId"].as_str().unwrap().to_owned();
    let new_document_id = "01928f3a-6c7d-7e8f-a012-3456789abc99";
    invoke(
        &second,
        "create_document",
        &serde_json::json!({
            "projectId": second_project_id,
            "documentId": new_document_id,
            "name": "Doc",
            "parentFolderId": null,
        }),
    )
    .unwrap();

    // A drop on main yields a dropId that only main can import.
    let announcements = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&announcements);
    opened.app.state::<DropSubscriber>().replace(
        MAIN_WINDOW_LABEL,
        Channel::<DropNotification>::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        }),
    );
    let source = temp.path().join("only-main.png");
    fs::write(&source, png_bytes(4, 4)).unwrap();
    let main_window =
        AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(&opened.webview).window();
    handle_window_event(
        &main_window,
        &WindowEvent::DragDrop(DragDropEvent::Drop {
            paths: vec![source],
            position: PhysicalPosition::new(0.0, 0.0),
        }),
    );
    let announced: Value =
        serde_json::from_str(announcements.lock().unwrap().last().expect("announced")).unwrap();
    assert_eq!(
        error_kind(invoke(
            &second,
            "import_dropped_images",
            &serde_json::json!({
                "dropId": announced["dropId"],
                "projectId": second_project_id,
                "documentId": new_document_id,
            }),
        )),
        "invalidDropSelection"
    );
    assert!(invoke(
        &opened.webview,
        "import_dropped_images",
        &serde_json::json!({
            "dropId": announced["dropId"],
            "projectId": opened.project_id,
            "documentId": DOCUMENT_ID,
        }),
    )
    .is_ok());
}

#[test]
fn the_close_token_of_one_window_does_not_belong_to_another() {
    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let second = second_window(&opened);
    let main_token = subscribe_close_requests(&opened.webview);
    let second_token = subscribe_close_requests(&second);
    assert_ne!(main_token, second_token);

    // Per-window acceptance is unit-tested on the hub (destroying is not observable in the
    // mock runtime); here the commands only have to keep answering quietly.
    use design_dawn_lib::commands::CloseRequestSubscriber;
    let hub = opened.app.state::<CloseRequestSubscriber>();
    assert!(hub.accepts(MAIN_WINDOW_LABEL, &main_token));
    assert!(!hub.accepts(SECOND_WINDOW_LABEL, &main_token));
    assert!(hub.accepts(SECOND_WINDOW_LABEL, &second_token));
    assert_eq!(
        invoke(
            &second,
            "confirm_window_close",
            &serde_json::json!({ "subscriptionToken": "not-its-own" }),
        ),
        Ok(Value::Null)
    );
}

#[test]
fn dawn_asset_serves_only_the_project_bound_to_the_requesting_window() {
    use design_dawn_lib::application::session::ProjectSessions;
    use design_dawn_lib::commands::respond_to_asset_request;

    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let _second = second_window(&opened);
    let uri: tauri::http::Uri = format!(
        "dawn-asset://localhost/{}/{DOCUMENT_ID}/assets/pixel.png",
        opened.project_id
    )
    .parse()
    .unwrap();
    let sessions = opened.app.state::<Mutex<ProjectSessions>>();
    let registry = opened.app.state::<Mutex<WindowRegistry>>();
    let status = |label: &str| respond_to_asset_request(&sessions, &registry, label, &uri).status();

    assert_eq!(status(MAIN_WINDOW_LABEL), 200);
    assert_eq!(status(SECOND_WINDOW_LABEL), 404);
    assert_eq!(status("unknown-webview"), 404);
}

#[test]
fn destroying_a_window_releases_its_project_session_and_per_window_state() {
    use design_dawn_lib::application::session::ProjectSessions;
    use design_dawn_lib::commands::handle_window_event;
    use tauri::WindowEvent;

    let temp = TempDir::new();
    let opened = open_fixture_project_with_pickers(
        &temp,
        vec![PickerOutcome::Folder(
            temp.path().join(PROJECT_DIRECTORY_NAME),
        )],
    );
    let second = second_window(&opened);
    let main_token = subscribe_close_requests(&opened.webview);
    let main_window =
        AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(&opened.webview).window();

    handle_window_event(&main_window, &WindowEvent::Destroyed);

    let project = design_dawn_lib::domain::entity_id::ProjectId::parse(&opened.project_id).unwrap();
    let sessions = opened.app.state::<Mutex<ProjectSessions>>();
    assert!(sessions.lock().unwrap().get(&project).is_err());
    let registry = opened.app.state::<Mutex<WindowRegistry>>();
    assert_eq!(
        registry.lock().unwrap().find_window_by_project(&project),
        None
    );
    let hub = opened
        .app
        .state::<design_dawn_lib::commands::CloseRequestSubscriber>();
    assert!(!hub.accepts(MAIN_WINDOW_LABEL, &main_token));

    // The Project is free for another window again.
    let selection_id = pick_folder_in(&second);
    assert!(invoke(
        &second,
        "open_project",
        &serde_json::json!({ "selectionId": selection_id }),
    )
    .is_ok());
}

#[test]
fn focus_events_order_the_windows_for_the_registry() {
    use design_dawn_lib::commands::handle_window_event;
    use tauri::WindowEvent;

    let temp = TempDir::new();
    let opened = open_fixture_project(&temp);
    let second = second_window(&opened);
    let window_of = |webview: &tauri::WebviewWindow<tauri::test::MockRuntime>| {
        AsRef::<tauri::Webview<tauri::test::MockRuntime>>::as_ref(webview).window()
    };
    let registry = opened.app.state::<Mutex<WindowRegistry>>();

    handle_window_event(&window_of(&opened.webview), &WindowEvent::Focused(true));
    handle_window_event(&window_of(&second), &WindowEvent::Focused(true));
    assert_eq!(
        registry.lock().unwrap().most_recently_focused(),
        Some(SECOND_WINDOW_LABEL)
    );
    handle_window_event(&window_of(&second), &WindowEvent::Focused(false));
    handle_window_event(&window_of(&opened.webview), &WindowEvent::Focused(true));
    assert_eq!(
        registry.lock().unwrap().most_recently_focused(),
        Some(MAIN_WINDOW_LABEL)
    );
}
