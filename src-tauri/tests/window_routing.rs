//! Routing of open requests to windows (docs/architecture.md §11.0.1, Steps C/E/F): the
//! executor against a fake window host and a fake app channel, with real files for the
//! `.dawn` / Project reads; plus `open_project_in_new_window` through the mock runtime.

mod support;

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use design_dawn_lib::application::folder_selection::{FolderPicker, FolderPickerError};
use design_dawn_lib::application::open_request::{OpenRequest, PendingOpenRequests};
use design_dawn_lib::application::open_routing::WindowLabelAllocator;
use design_dawn_lib::application::window_registry::WindowRegistry;
use design_dawn_lib::commands::{
    handle_second_launch, reroute_unacknowledged, route_open_request, AppNotification,
    AppNotificationSink, AppRequestHub, PlacementSource, RouteOutcome, RoutingState,
    SharedFolderPicker, WindowGeometry, WindowHost, WindowPlacement,
};
use design_dawn_lib::config::NEW_WINDOW_CASCADE_OFFSET;
use design_dawn_lib::domain::entity_id::ProjectId;
use serde_json::{json, Value};
use support::*;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindowBuilder};

const MAIN: &str = "main";
const ENTRY_POINT_FILE: &str = "api-design.dawn";
const LOCAL_ORIGIN: &str = "tauri://localhost";

#[derive(Clone, Default)]
struct FakeSink {
    received: Arc<Mutex<Vec<AppNotification>>>,
}

impl AppNotificationSink for FakeSink {
    fn send_notification(&self, notification: AppNotification) -> Result<(), String> {
        self.received.lock().unwrap().push(notification);
        Ok(())
    }
}

impl FakeSink {
    fn document_ids(&self) -> Vec<String> {
        self.received
            .lock()
            .unwrap()
            .iter()
            .filter_map(|notification| match notification {
                AppNotification::OpenDocument { document_id, .. } => Some(document_id.clone()),
                AppNotification::SettingsChanged { .. }
                | AppNotification::ProjectFilesChanged { .. } => None,
            })
            .collect()
    }
}

#[derive(Default)]
struct FakeHost {
    raised: RefCell<Vec<String>>,
    created: RefCell<Vec<(String, WindowPlacement)>>,
    geometries: HashMap<String, WindowGeometry>,
    fail_creation: bool,
}

impl FakeHost {
    fn with_geometry(mut self, label: &str, width: f64, height: f64) -> Self {
        self.geometries.insert(
            label.to_owned(),
            WindowGeometry {
                width,
                height,
                position: Some((100.0, 50.0)),
            },
        );
        self
    }

    fn created_labels(&self) -> Vec<String> {
        self.created
            .borrow()
            .iter()
            .map(|(label, _)| label.clone())
            .collect()
    }
}

impl WindowHost for FakeHost {
    fn raise_window(&self, label: &str) {
        self.raised.borrow_mut().push(label.to_owned());
    }
    fn window_geometry(&self, label: &str) -> Option<WindowGeometry> {
        self.geometries.get(label).copied()
    }
    fn create_window(&self, label: &str, placement: WindowPlacement) -> Result<(), String> {
        if self.fail_creation {
            return Err("refused".to_owned());
        }
        self.created
            .borrow_mut()
            .push((label.to_owned(), placement));
        Ok(())
    }
}

#[derive(Default)]
struct World {
    registry: Mutex<WindowRegistry>,
    pending: Mutex<PendingOpenRequests>,
    hub: AppRequestHub<FakeSink>,
    labels: Mutex<WindowLabelAllocator>,
}

impl World {
    fn state(&self) -> RoutingState<'_, FakeSink> {
        RoutingState {
            registry: &self.registry,
            pending: &self.pending,
            hub: &self.hub,
            labels: &self.labels,
        }
    }

    fn bind(&self, label: &str, project: &str) {
        self.registry
            .lock()
            .unwrap()
            .bind(label, ProjectId::parse(project).unwrap())
            .unwrap();
    }

    fn pending_for(&self, label: &str) -> Option<OpenRequest> {
        self.pending.lock().unwrap().take(label)
    }
}

fn entry_point(root: &Path) -> OpenRequest {
    OpenRequest::EntryPoint(root.join(ENTRY_POINT_FILE))
}

fn route(
    world: &World,
    host: &FakeHost,
    request: OpenRequest,
) -> Result<RouteOutcome, design_dawn_lib::application::error::ApplicationError> {
    route_open_request(
        &world.state(),
        host,
        request,
        &PlacementSource::Origin(MAIN.to_owned()),
    )
}

fn existing(label: &str) -> RouteOutcome {
    RouteOutcome::FocusedExisting {
        window_label: label.to_owned(),
    }
}

fn opened(label: &str) -> RouteOutcome {
    RouteOutcome::OpenedInNewWindow {
        window_label: label.to_owned(),
    }
}

#[test]
fn a_bound_project_raises_its_window_and_sends_open_document() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let sink = FakeSink::default();
    world.hub.subscribe(MAIN, sink.clone());
    world.bind(MAIN, FOLDERS_PROJECT_ID);
    let host = FakeHost::default();

    let outcome = route(&world, &host, entry_point(&root)).unwrap();

    assert_eq!(outcome, existing(MAIN));
    assert_eq!(*host.raised.borrow(), [MAIN]);
    assert!(host.created.borrow().is_empty());
    assert_eq!(sink.document_ids(), [API_DESIGN_DOCUMENT_ID]);
}

#[test]
fn a_bound_project_folder_only_raises_the_window() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let sink = FakeSink::default();
    world.hub.subscribe("window-7", sink.clone());
    world.bind("window-7", FOLDERS_PROJECT_ID);
    let host = FakeHost::default();

    let outcome = route(&world, &host, OpenRequest::ProjectFolder(root)).unwrap();

    assert_eq!(outcome, existing("window-7"));
    assert_eq!(*host.raised.borrow(), ["window-7"]);
    assert!(sink.document_ids().is_empty());
    assert!(host.created.borrow().is_empty());
}

#[test]
fn an_unbound_project_gets_a_new_window_with_the_request_pending() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let host = FakeHost::default();

    let outcome = route(&world, &host, entry_point(&root)).unwrap();

    assert_eq!(outcome, opened("window-1"));
    assert_eq!(host.created_labels(), ["window-1"]);
    assert!(host.raised.borrow().is_empty());
    assert_eq!(world.pending_for("window-1"), Some(entry_point(&root)));
    // Reserved, so a second request finds the window while it is still starting.
    let project = ProjectId::parse(FOLDERS_PROJECT_ID).unwrap();
    assert_eq!(
        world
            .registry
            .lock()
            .unwrap()
            .find_window_claiming_project(&project),
        Some("window-1")
    );
}

#[test]
fn the_same_project_never_gets_a_second_window() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let host = FakeHost::default();

    route(&world, &host, OpenRequest::ProjectFolder(root.clone())).unwrap();
    let again = route(&world, &host, entry_point(&root)).unwrap();

    assert_eq!(again, existing("window-1"));
    assert_eq!(host.created_labels(), ["window-1"]);
    // The document request waits for the starting window's subscription.
    let sink = FakeSink::default();
    world.hub.subscribe("window-1", sink.clone());
    assert_eq!(sink.document_ids(), [API_DESIGN_DOCUMENT_ID]);
}

#[test]
fn different_projects_get_different_windows() {
    let (_first_temp, first_root) = folders_project_copy();
    let (_second_temp, second_root) = project_copy();
    let world = World::default();
    let host = FakeHost::default();

    assert_eq!(
        route(&world, &host, OpenRequest::ProjectFolder(first_root)).unwrap(),
        opened("window-1")
    );
    assert_eq!(
        route(&world, &host, OpenRequest::ProjectFolder(second_root)).unwrap(),
        opened("window-2")
    );
}

#[test]
fn an_unreadable_request_creates_nothing() {
    let temp = TempDir::new();
    let world = World::default();
    let host = FakeHost::default();
    let result = route(
        &world,
        &host,
        OpenRequest::EntryPoint(temp.path().join("missing.dawn")),
    );
    assert!(result.is_err());
    assert!(host.created.borrow().is_empty());
    assert!(world.labels.lock().unwrap().allocate() == "window-1");
}

#[test]
fn a_failed_window_creation_undoes_the_label_and_the_pending_request() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let host = FakeHost {
        fail_creation: true,
        ..FakeHost::default()
    };
    assert!(route(&world, &host, OpenRequest::ProjectFolder(root.clone())).is_err());
    assert_eq!(world.pending_for("window-1"), None);
    let project = ProjectId::parse(FOLDERS_PROJECT_ID).unwrap();
    assert_eq!(
        world
            .registry
            .lock()
            .unwrap()
            .find_window_claiming_project(&project),
        None
    );
    // Labels are not reused.
    let working_host = FakeHost::default();
    assert_eq!(
        route(&world, &working_host, OpenRequest::ProjectFolder(root)).unwrap(),
        opened("window-2")
    );
}

#[test]
fn an_app_initiated_open_follows_the_size_of_the_origin_window() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let host = FakeHost::default()
        .with_geometry(MAIN, 900.0, 600.0)
        .with_geometry("window-9", 400.0, 300.0);
    world.registry.lock().unwrap().touch_focus("window-9");

    route(&world, &host, OpenRequest::ProjectFolder(root)).unwrap();

    let placement = host.created.borrow()[0].1;
    assert_eq!(placement.size, Some((900.0, 600.0)));
    assert_eq!(
        placement.position,
        Some((
            100.0 + NEW_WINDOW_CASCADE_OFFSET,
            50.0 + NEW_WINDOW_CASCADE_OFFSET
        ))
    );
}

#[test]
fn an_external_open_follows_the_most_recently_focused_window() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let host = FakeHost::default()
        .with_geometry(MAIN, 900.0, 600.0)
        .with_geometry("window-9", 400.0, 300.0);
    world.registry.lock().unwrap().touch_focus(MAIN);
    world.registry.lock().unwrap().touch_focus("window-9");

    let arguments = [OsString::from("app"), root.join(ENTRY_POINT_FILE).into()];
    handle_second_launch(&world.state(), &host, arguments, Path::new("/elsewhere"));

    assert_eq!(host.created.borrow()[0].1.size, Some((400.0, 300.0)));
}

#[test]
fn without_any_geometry_the_window_uses_the_configured_default() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let host = FakeHost::default();
    route(&world, &host, OpenRequest::ProjectFolder(root)).unwrap();
    assert_eq!(host.created.borrow()[0].1, WindowPlacement::default());
}

#[test]
fn a_second_launch_without_a_dawn_raises_the_most_recently_focused_window() {
    let world = World::default();
    let host = FakeHost::default();
    world.registry.lock().unwrap().touch_focus(MAIN);
    world.registry.lock().unwrap().touch_focus("window-2");

    handle_second_launch(
        &world.state(),
        &host,
        [OsString::from("app"), OsString::from("--flag")],
        Path::new("/work"),
    );

    assert_eq!(*host.raised.borrow(), ["window-2"]);
    assert!(host.created.borrow().is_empty());
}

#[test]
fn a_second_launch_without_a_dawn_and_no_focus_history_raises_main() {
    let world = World::default();
    let host = FakeHost::default();
    handle_second_launch(
        &world.state(),
        &host,
        [OsString::from("app")],
        Path::new("/w"),
    );
    assert_eq!(*host.raised.borrow(), [MAIN]);
}

#[test]
fn a_second_launch_with_a_relative_dawn_resolves_against_its_own_directory() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let sink = FakeSink::default();
    world.hub.subscribe(MAIN, sink.clone());
    world.bind(MAIN, FOLDERS_PROJECT_ID);
    let host = FakeHost::default();

    handle_second_launch(
        &world.state(),
        &host,
        [OsString::from("app"), OsString::from(ENTRY_POINT_FILE)],
        &root,
    );

    assert_eq!(*host.raised.borrow(), [MAIN]);
    assert_eq!(sink.document_ids(), [API_DESIGN_DOCUMENT_ID]);
}

#[test]
fn an_unreadable_dawn_from_a_second_launch_still_gets_a_window_that_shows_the_error() {
    let temp = TempDir::new();
    let missing = temp.path().join("missing.dawn");
    let world = World::default();
    let host = FakeHost::default();

    handle_second_launch(
        &world.state(),
        &host,
        [OsString::from("app"), missing.clone().into()],
        Path::new("/w"),
    );

    assert_eq!(host.created_labels(), ["window-1"]);
    assert_eq!(
        world.pending_for("window-1"),
        Some(OpenRequest::EntryPoint(missing))
    );
}

#[test]
fn an_acknowledged_request_is_not_routed_again_when_its_window_goes_away() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    let sink = FakeSink::default();
    world.hub.subscribe(MAIN, sink.clone());
    world.bind(MAIN, FOLDERS_PROJECT_ID);
    let host = FakeHost::default();
    route(&world, &host, entry_point(&root)).unwrap();
    let AppNotification::OpenDocument { request_id, .. } = sink.received.lock().unwrap()[0].clone()
    else {
        panic!("an openDocument was expected");
    };

    assert!(world.hub.acknowledge(MAIN, &request_id));

    assert!(world.hub.discard_window(MAIN).is_empty());
}

#[test]
fn an_unacknowledged_request_is_routed_to_a_new_window_after_its_window_is_destroyed() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    world.hub.subscribe(MAIN, FakeSink::default());
    world.bind(MAIN, FOLDERS_PROJECT_ID);
    let host = FakeHost::default();
    route(&world, &host, entry_point(&root)).unwrap();

    // What `WindowEvent::Destroyed` does: release the window, then route what is left.
    world.registry.lock().unwrap().unregister(MAIN);
    let lost = world.hub.discard_window(MAIN);
    assert_eq!(lost.len(), 1);
    reroute_unacknowledged(&world.state(), &host, lost);

    assert_eq!(host.created_labels(), ["window-1"]);
    assert_eq!(world.pending_for("window-1"), Some(entry_point(&root)));
}

#[test]
fn a_request_sent_to_another_project_window_is_rerouted_to_that_window_when_it_exists() {
    let (_temp, root) = folders_project_copy();
    let world = World::default();
    world.hub.subscribe(MAIN, FakeSink::default());
    world.bind(MAIN, FOLDERS_PROJECT_ID);
    let host = FakeHost::default();
    route(&world, &host, entry_point(&root)).unwrap();
    let lost = world.hub.discard_window(MAIN);

    // Another window opened the Project in the meantime.
    world.registry.lock().unwrap().unregister(MAIN);
    world.bind("window-4", FOLDERS_PROJECT_ID);
    let sink = FakeSink::default();
    world.hub.subscribe("window-4", sink.clone());
    reroute_unacknowledged(&world.state(), &host, lost);

    assert!(host.created.borrow().is_empty());
    assert_eq!(sink.document_ids(), [API_DESIGN_DOCUMENT_ID]);
}

// ---- open_project_in_new_window through the mock runtime ----

struct ChoosingPicker(PathBuf);

impl FolderPicker for ChoosingPicker {
    fn pick_folder(&self) -> Result<Option<PathBuf>, FolderPickerError> {
        Ok(Some(self.0.clone()))
    }
}

fn request(command: &str, body: Value) -> InvokeRequest {
    InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: LOCAL_ORIGIN.parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

type MockApp = tauri::App<tauri::test::MockRuntime>;
type MockWindow = tauri::WebviewWindow<tauri::test::MockRuntime>;

fn invoke(window: &MockWindow, command: &str, body: Value) -> Result<Value, Value> {
    get_ipc_response(window, request(command, body))
        .map(|response| response.deserialize::<Value>().unwrap())
}

fn app_choosing(folder: &Path) -> (MockApp, MockWindow) {
    let picker: SharedFolderPicker = Arc::new(ChoosingPicker(folder.to_path_buf()));
    let app = design_dawn_lib::configure(mock_builder())
        .manage(picker)
        .build(tauri::generate_context!())
        .expect("build app");
    let main = WebviewWindowBuilder::new(&app, MAIN, Default::default())
        .build()
        .expect("main window");
    (app, main)
}

fn pick(window: &MockWindow) -> Value {
    invoke(window, "select_project_folder", json!({})).unwrap()["selectionId"].clone()
}

#[test]
fn opening_an_unbound_project_in_a_new_window_creates_window_1_with_a_folder_request() {
    let (_temp, root) = folders_project_copy();
    let (app, main) = app_choosing(&root);
    let selection_id = pick(&main);

    let result = invoke(
        &main,
        "open_project_in_new_window",
        json!({ "selectionId": selection_id }),
    )
    .unwrap();

    assert_eq!(result, json!({ "status": "openedInNewWindow" }));
    assert!(app.get_webview_window("window-1").is_some());
    assert_eq!(
        app.state::<Mutex<PendingOpenRequests>>()
            .lock()
            .unwrap()
            .take("window-1"),
        Some(OpenRequest::ProjectFolder(root))
    );
    assert!(!result.to_string().contains("window-1"));
}

#[test]
fn the_new_window_takes_the_folder_request_and_binds_the_project() {
    let (_temp, root) = folders_project_copy();
    let (app, main) = app_choosing(&root);
    let selection_id = pick(&main);
    invoke(
        &main,
        "open_project_in_new_window",
        json!({ "selectionId": selection_id }),
    )
    .unwrap();
    let created = app.get_webview_window("window-1").expect("window-1");

    let taken = invoke(&created, "take_open_request", json!({})).unwrap();

    assert_eq!(taken["documentId"], Value::Null);
    assert_eq!(
        taken["snapshot"]["project"]["projectId"],
        FOLDERS_PROJECT_ID
    );
    let project = ProjectId::parse(FOLDERS_PROJECT_ID).unwrap();
    let registry = app.state::<Mutex<WindowRegistry>>();
    assert_eq!(
        registry.lock().unwrap().find_window_by_project(&project),
        Some("window-1")
    );
    // Taken: the reservation is over and nothing is pending any more.
    assert_eq!(
        invoke(&created, "take_open_request", json!({})),
        Ok(Value::Null)
    );
}

#[test]
fn opening_a_project_that_a_window_has_focuses_it_instead_of_creating_a_window() {
    let (_temp, root) = folders_project_copy();
    let (app, main) = app_choosing(&root);
    let selection_id = pick(&main);
    invoke(
        &main,
        "open_project",
        json!({ "selectionId": selection_id }),
    )
    .unwrap();
    let selection_id = pick(&main);

    let result = invoke(
        &main,
        "open_project_in_new_window",
        json!({ "selectionId": selection_id }),
    )
    .unwrap();

    assert_eq!(
        result,
        json!({ "status": "focusedExisting", "inThisWindow": true })
    );
    assert!(app.get_webview_window("window-1").is_none());
}

#[test]
fn focusing_a_project_of_another_window_says_it_is_not_this_window() {
    let (_temp, root) = folders_project_copy();
    let (app, main) = app_choosing(&root);
    let selection_id = pick(&main);
    invoke(
        &main,
        "open_project",
        json!({ "selectionId": selection_id }),
    )
    .unwrap();
    let other = WebviewWindowBuilder::new(&app, "window-5", Default::default())
        .build()
        .expect("other window");
    let selection_id = pick(&other);

    let result = invoke(
        &other,
        "open_project_in_new_window",
        json!({ "selectionId": selection_id }),
    )
    .unwrap();

    assert_eq!(
        result,
        json!({ "status": "focusedExisting", "inThisWindow": false })
    );
}

#[test]
fn a_selection_that_is_not_a_project_is_an_error_and_creates_no_window() {
    let temp = TempDir::new();
    let (app, main) = app_choosing(temp.path());
    let selection_id = pick(&main);

    let error = invoke(
        &main,
        "open_project_in_new_window",
        json!({ "selectionId": selection_id }),
    )
    .unwrap_err();

    assert_eq!(error["kind"], "fileNotFound");
    assert!(app.get_webview_window("window-1").is_none());
}

#[test]
fn an_unknown_selection_id_is_rejected() {
    let (_temp, root) = folders_project_copy();
    let (_app, main) = app_choosing(&root);
    let error = invoke(
        &main,
        "open_project_in_new_window",
        json!({ "selectionId": "nope" }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "invalidFolderSelection");
}

#[test]
fn ack_open_request_is_quiet_for_an_unknown_request() {
    let (_temp, root) = folders_project_copy();
    let (_app, main) = app_choosing(&root);
    assert!(invoke(&main, "ack_open_request", json!({ "requestId": "unknown" })).is_ok());
}

// ---- a reservation blocks other windows ----

fn reserve_in_new_window(app: &MockApp, main: &MockWindow) -> MockWindow {
    let selection_id = pick(main);
    invoke(
        main,
        "open_project_in_new_window",
        json!({ "selectionId": selection_id }),
    )
    .unwrap();
    app.get_webview_window("window-1").expect("window-1")
}

#[test]
fn a_dialog_open_of_a_reserved_project_is_refused_and_the_reserving_window_binds_later() {
    let (_temp, root) = folders_project_copy();
    let (app, main) = app_choosing(&root);
    let reserving = reserve_in_new_window(&app, &main);

    let selection_id = pick(&main);
    let error = invoke(
        &main,
        "open_project",
        json!({ "selectionId": selection_id }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "projectOpenInOtherWindow");
    let project = ProjectId::parse(FOLDERS_PROJECT_ID).unwrap();
    {
        let registry = app.state::<Mutex<WindowRegistry>>();
        assert_eq!(registry.lock().unwrap().project_of(MAIN), None);
    }

    let taken = invoke(&reserving, "take_open_request", json!({})).unwrap();
    assert_eq!(
        taken["snapshot"]["project"]["projectId"],
        FOLDERS_PROJECT_ID
    );
    let registry = app.state::<Mutex<WindowRegistry>>();
    assert_eq!(
        registry.lock().unwrap().find_window_by_project(&project),
        Some("window-1")
    );
}

#[test]
fn another_windows_take_of_a_reserved_project_is_refused() {
    let (_temp, root) = folders_project_copy();
    let (app, main) = app_choosing(&root);
    reserve_in_new_window(&app, &main);
    app.state::<Mutex<PendingOpenRequests>>()
        .lock()
        .unwrap()
        .put(MAIN, OpenRequest::ProjectFolder(root));

    let error = invoke(&main, "take_open_request", json!({})).unwrap_err();

    assert_eq!(error["kind"], "projectOpenInOtherWindow");
}

#[test]
fn destroying_the_reserving_window_frees_the_project() {
    let (_temp, root) = folders_project_copy();
    let (app, main) = app_choosing(&root);
    let reserving = reserve_in_new_window(&app, &main);

    // What `WindowEvent::Destroyed` does to the registry.
    app.state::<Mutex<WindowRegistry>>()
        .lock()
        .unwrap()
        .unregister(reserving.label());

    let selection_id = pick(&main);
    assert!(invoke(
        &main,
        "open_project",
        json!({ "selectionId": selection_id })
    )
    .is_ok());
}
