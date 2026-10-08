//! Launch-argument open requests (docs/architecture.md §11.0.1, Step B): the application
//! function against real files, and `take_open_request` through the real IPC pipeline.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::open_request::{
    take_open_request, OpenRequest, PendingOpenRequests,
};
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::infrastructure::error::PersistenceErrorKind;
use design_dawn_lib::infrastructure::file_format::constants::ENTRY_POINT_MAX_BYTES;
use serde_json::{json, Value};
use support::*;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindowBuilder};

const MAIN_WINDOW_LABEL: &str = "main";
const OTHER_WINDOW_LABEL: &str = "window-2";
const LOCAL_ORIGIN: &str = "tauri://localhost";
const ENTRY_POINT_FILE: &str = "api-design.dawn";

fn pending_for(label: &str, path: PathBuf) -> Mutex<PendingOpenRequests> {
    let mut pending = PendingOpenRequests::default();
    pending.put(label, OpenRequest::EntryPoint(path));
    Mutex::new(pending)
}

fn take(path: &Path) -> Result<Option<Value>, ErrorKind> {
    let pending = pending_for(MAIN_WINDOW_LABEL, path.to_path_buf());
    let mut sessions = ProjectSessions::default();
    take_open_request(&pending, &mut sessions, MAIN_WINDOW_LABEL)
        .map(|opened| opened.map(|value| serde_json::to_value(value).unwrap()))
        .map_err(|error| error.kind)
}

fn write_entry_point(root: &Path, document_path: &str) {
    write_json(
        &root.join(ENTRY_POINT_FILE),
        &json!({
            "schemaVersion": 1,
            "documentId": API_DESIGN_DOCUMENT_ID,
            "path": document_path
        }),
    );
}

#[test]
fn opens_the_project_and_names_the_document() {
    let (_temp, root) = folders_project_copy();
    let value = take(&root.join(ENTRY_POINT_FILE)).unwrap().unwrap();
    assert_eq!(value["documentId"], API_DESIGN_DOCUMENT_ID);
    assert_eq!(value["resolution"], "path");
    assert_eq!(
        value["snapshot"]["project"]["projectId"],
        FOLDERS_PROJECT_ID
    );
}

#[test]
fn nothing_pending_for_the_window_returns_none() {
    let pending = pending_for(OTHER_WINDOW_LABEL, PathBuf::from("/x/a.dawn"));
    let mut sessions = ProjectSessions::default();
    let outcome = take_open_request(&pending, &mut sessions, MAIN_WINDOW_LABEL);
    assert_eq!(outcome, Ok(None));
}

#[test]
fn a_missing_file_is_file_not_found() {
    let (_temp, root) = folders_project_copy();
    assert_eq!(
        take(&root.join("missing.dawn")).unwrap_err(),
        ErrorKind::Persistence(PersistenceErrorKind::FileNotFound)
    );
}

#[test]
fn invalid_json_is_rejected() {
    let (_temp, root) = folders_project_copy();
    write_text(&root.join(ENTRY_POINT_FILE), "{ not json");
    assert_eq!(
        take(&root.join(ENTRY_POINT_FILE)).unwrap_err(),
        ErrorKind::Persistence(PersistenceErrorKind::InvalidJson)
    );
}

#[test]
fn a_directory_named_like_an_entry_point_is_rejected() {
    let (_temp, root) = folders_project_copy();
    fs::create_dir(root.join("folder.dawn")).unwrap();
    assert_eq!(
        take(&root.join("folder.dawn")).unwrap_err(),
        ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure)
    );
}

#[test]
fn a_file_over_the_size_limit_is_rejected() {
    let (_temp, root) = folders_project_copy();
    let padding = " ".repeat(usize::try_from(ENTRY_POINT_MAX_BYTES).unwrap());
    write_text(
        &root.join(ENTRY_POINT_FILE),
        &format!("{{\"schemaVersion\":1,\"documentId\":\"{API_DESIGN_DOCUMENT_ID}\",\"path\":\"x\"}}{padding}"),
    );
    assert_eq!(
        take(&root.join(ENTRY_POINT_FILE)).unwrap_err(),
        ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure)
    );
}

#[test]
fn a_file_without_the_dawn_extension_is_rejected() {
    let (_temp, root) = folders_project_copy();
    assert_eq!(
        take(&root.join("project.json")).unwrap_err(),
        ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure)
    );
}

#[test]
fn a_dawn_without_a_project_json_above_it_is_rejected() {
    let temp = TempDir::new();
    write_entry_point(temp.path(), "documents/x");
    assert_eq!(
        take(&temp.path().join(ENTRY_POINT_FILE)).unwrap_err(),
        ErrorKind::Persistence(PersistenceErrorKind::FileNotFound)
    );
}

#[test]
fn a_traversing_document_path_falls_back_to_the_id_scan() {
    let (temp, root) = folders_project_copy();
    // A sibling directory outside the Project that a `../` path would reach.
    let outside = temp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    let project = root.clone();
    let relative_to_outside = format!("../{}", outside.file_name().unwrap().to_str().unwrap());
    write_entry_point(&project, &relative_to_outside);
    let value = take(&project.join(ENTRY_POINT_FILE)).unwrap().unwrap();
    assert_eq!(value["resolution"], "idScan");
    assert_eq!(value["documentId"], API_DESIGN_DOCUMENT_ID);
}

#[test]
fn the_error_and_the_result_never_carry_a_path() {
    let (temp, root) = folders_project_copy();
    let value = take(&root.join(ENTRY_POINT_FILE)).unwrap().unwrap();
    let text = value.to_string();
    let temp_text = temp.path().to_string_lossy();
    assert!(!text.contains(temp_text.as_ref()));
    assert!(!text.contains(ENTRY_POINT_FILE));
}

fn request(command: &str) -> InvokeRequest {
    InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: LOCAL_ORIGIN.parse().unwrap(),
        body: InvokeBody::Json(json!({})),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

fn take_over_ipc(path: &Path, label: &str) -> (Result<Value, Value>, Result<Value, Value>) {
    let app = design_dawn_lib::configure(mock_builder())
        .build(tauri::generate_context!())
        .expect("build app");
    app.state::<Mutex<PendingOpenRequests>>()
        .lock()
        .unwrap()
        .put(label, OpenRequest::EntryPoint(path.to_path_buf()));
    let webview = WebviewWindowBuilder::new(&app, label, Default::default())
        .build()
        .expect("create window");
    let call = || {
        get_ipc_response(&webview, request("take_open_request"))
            .map(|body| body.deserialize::<Value>().unwrap())
    };
    (call(), call())
}

#[test]
fn the_command_returns_the_snapshot_once_and_then_null() {
    let (temp, root) = folders_project_copy();
    let (first, second) = take_over_ipc(&root.join(ENTRY_POINT_FILE), MAIN_WINDOW_LABEL);
    let first = first.expect("first take succeeds");
    assert_eq!(first["documentId"], API_DESIGN_DOCUMENT_ID);
    assert!(first["snapshot"]["documents"].is_array());
    assert!(!first
        .to_string()
        .contains(temp.path().to_string_lossy().as_ref()));
    assert_eq!(second, Ok(Value::Null));
}

#[test]
fn the_command_error_for_a_missing_file_has_a_kind_and_no_path() {
    let (temp, root) = folders_project_copy();
    let (first, second) = take_over_ipc(&root.join("missing.dawn"), MAIN_WINDOW_LABEL);
    let error = first.expect_err("missing file fails");
    assert_eq!(error["kind"], "fileNotFound");
    assert!(!error
        .to_string()
        .contains(temp.path().to_string_lossy().as_ref()));
    // The request is consumed even though opening it failed.
    assert_eq!(second, Ok(Value::Null));
}
