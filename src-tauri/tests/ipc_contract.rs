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
/// The origin of the app's own frontend; ACL treats it as a local URL.
const LOCAL_ORIGIN: &str = "tauri://localhost";
const EMPTY_DIRECTORY_NAME: &str = "empty";
const PROJECT_DIRECTORY_NAME: &str = "project";
const CONFIG_DIRECTORY_NAME: &str = "config";
const LOCAL_DATA_DIRECTORY_NAME: &str = "local-data";

/// What the fake dialog does when the fixture says `folderPicker: [...]`.
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
        copy_dir_all(Path::new(FIXTURE_PROJECT), &project_root);
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
    let project_root = temp.path().join(PROJECT_DIRECTORY_NAME);
    copy_dir_all(Path::new(FIXTURE_PROJECT), &project_root);
    let app = build_app(
        vec![PickerOutcome::Folder(project_root.clone())],
        local_state_directories(temp.path()),
    );
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
    opened
        .app
        .state::<DropSubscriber>()
        .replace(Channel::<DropNotification>::new(move |body| {
            match body {
                InvokeResponseBody::Json(json) => sink.lock().unwrap().push(json),
                InvokeResponseBody::Raw(_) => panic!("notifications are JSON"),
            }
            Ok(())
        }));

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
        respond_to_asset_request(&sessions, &uri).status()
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
