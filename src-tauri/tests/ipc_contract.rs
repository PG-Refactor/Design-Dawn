//! Runs `fixtures/ipc/persistence-commands.json` through the real Tauri IPC pipeline (mock
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
use design_dawn_lib::commands::SharedFolderPicker;
use serde_json::Value;
use support::*;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindowBuilder};

const FIXTURE_FILE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/ipc/persistence-commands.json"
);
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

fn build_app(outcomes: Vec<PickerOutcome>) -> App<tauri::test::MockRuntime> {
    let picker: SharedFolderPicker = Arc::new(FakePicker {
        outcomes: Mutex::new(outcomes.into()),
    });
    design_dawn_lib::configure(mock_builder())
        .manage(picker)
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

#[test]
fn every_contract_case_matches_the_real_ipc_response() {
    let fixture: Value =
        serde_json::from_str(&fs::read_to_string(FIXTURE_FILE).expect("read fixture")).unwrap();
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

        let outcomes = picker_outcomes(
            scenario["folderPicker"].as_array().expect("folderPicker"),
            &project_root,
            &empty_directory,
        );
        let app = build_app(outcomes);
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
    let app = build_app(Vec::new());
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
