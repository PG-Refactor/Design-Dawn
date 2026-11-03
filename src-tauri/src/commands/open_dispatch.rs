//! Executes the routing of an open request: bring the window
//! that has the Project forward and tell it, or create a window for it. The decisions are the
//! pure functions of `application::open_routing`; this module only carries them out against
//! the registry, the pending requests, the app channel and a `WindowHost`.
//!
//! Window creation must never run on the main thread or inside an event handler: on Windows
//! `WebviewWindowBuilder::build` deadlocks there (Tauri docs, wry#583). Every caller of
//! `TauriWindowHost` therefore goes through `spawn_blocking` (see `dispatch_in_background`),
//! and the command that opens a Project in a new window is `async`.

use std::ffi::OsString;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};
use uuid::Uuid;

use super::app_channel::{
    AppNotification, AppNotificationSink, AppRequestHub, AppRequestSubscriber,
};
use super::window_size::recorded_size_for_new_window;
use crate::application::document_transfer::{invalid_transfer, DocumentTransfers, PendingTransfer};
use crate::application::error::{ApplicationError, ApplicationResult};
use crate::application::open_request::{
    resolve_open_target, select_open_request, OpenRequest, PendingOpenRequests,
};
use crate::application::open_routing::{
    decide_route, RouteDecision, SentOpenRequest, WindowLabelAllocator,
};
use crate::application::window_registry::WindowRegistry;
use crate::config::{MAIN_WINDOW_LABEL, NEW_WINDOW_CASCADE_OFFSET};
use crate::domain::entity_id::{DocumentId, ProjectId};
use crate::infrastructure::error::PersistenceErrorKind;

/// A window's geometry in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowGeometry {
    pub width: f64,
    pub height: f64,
    /// `None` where the platform cannot tell (some Wayland compositors).
    pub position: Option<(f64, f64)>,
}

/// Where a new window goes. `None` leaves it to the window config / the OS.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct WindowPlacement {
    pub size: Option<(f64, f64)>,
    pub position: Option<(f64, f64)>,
}

/// Same size as the window it follows, shifted by the cascade offset. A zero size (a minimized
/// window reports it on some platforms) is not a size to copy.
pub fn placement_following(geometry: Option<WindowGeometry>) -> WindowPlacement {
    let Some(geometry) = geometry else {
        return WindowPlacement::default();
    };
    let size = (geometry.width > 0.0 && geometry.height > 0.0)
        .then_some((geometry.width, geometry.height));
    let position = geometry
        .position
        .map(|(x, y)| (x + NEW_WINDOW_CASCADE_OFFSET, y + NEW_WINDOW_CASCADE_OFFSET));
    WindowPlacement { size, position }
}

/// The window operations routing needs. The production host is `TauriWindowHost`; tests use a
/// fake, because real windows cannot be raised or sized in a test.
pub trait WindowHost {
    /// Unminimize and focus. Failures are only logged: there is nobody to report them to.
    fn raise_window(&self, label: &str);
    fn window_geometry(&self, label: &str) -> Option<WindowGeometry>;
    fn create_window(&self, label: &str, placement: WindowPlacement) -> Result<(), String>;
}

/// Whose size a new window follows: the window an app-initiated open came from, or (external
/// opens) the window focused last, falling back to `main`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlacementSource {
    Origin(String),
    MostRecentlyFocused,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteOutcome {
    FocusedExisting { window_label: String },
    OpenedInNewWindow { window_label: String },
}

/// The shared state routing touches. Lock order: the registry may be held while taking the
/// label allocator; the others are never held together with it.
pub struct RoutingState<'a, S> {
    pub registry: &'a Mutex<WindowRegistry>,
    pub pending: &'a Mutex<PendingOpenRequests>,
    pub hub: &'a AppRequestHub<S>,
    pub labels: &'a Mutex<WindowLabelAllocator>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // Plain maps and counters, consistent after every single operation.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn window_creation_failed(detail: &str) -> ApplicationError {
    ApplicationError::persistence(
        PersistenceErrorKind::IoError,
        format!("failed to create a window: {detail}"),
    )
}

/// The routing state of the running app (the app channel is a real IPC channel).
pub type AppRoutingState<'a> = RoutingState<'a, Channel<AppNotification>>;

enum Claim {
    Existing(String),
    New(String),
}

impl<S: AppNotificationSink> RoutingState<'_, S> {
    fn source_label(&self, source: &PlacementSource) -> String {
        match source {
            PlacementSource::Origin(label) => label.clone(),
            PlacementSource::MostRecentlyFocused => lock(self.registry)
                .most_recently_focused()
                .unwrap_or(MAIN_WINDOW_LABEL)
                .to_owned(),
        }
    }

    /// Creates the window `label` for `request`. The request is pending before the window
    /// exists, because its Frontend asks for it as soon as it starts. A failed creation
    /// undoes everything about the label.
    fn open_window<H: WindowHost>(
        &self,
        host: &H,
        label: &str,
        request: OpenRequest,
        source: &PlacementSource,
    ) -> ApplicationResult<()> {
        let placement = placement_following(host.window_geometry(&self.source_label(source)));
        lock(self.pending).put(label, request);
        if let Err(detail) = host.create_window(label, placement) {
            lock(self.pending).discard(label);
            lock(self.registry).unregister(label);
            // Requests that were already queued for the label cannot be delivered anywhere.
            for lost in self.hub.discard_window(label) {
                eprintln!(
                    "dropped open request {} of window {label} that failed to start",
                    lost.request_id
                );
            }
            return Err(window_creation_failed(&detail));
        }
        Ok(())
    }

    /// Hands `document` to the window over the app channel; it stays unacknowledged until the
    /// window confirms it.
    fn notify_window(&self, label: &str, sent: SentOpenRequest) {
        if !self.hub.send_open_document(label, sent) {
            eprintln!("open request for window {label} is waiting for its subscription");
        }
    }
}

/// Routes `request` to the window that has its Project, or to a new window. Fails (nothing
/// changed) when the request cannot be read; the caller decides what to show.
pub fn route_open_request<S: AppNotificationSink, H: WindowHost>(
    state: &RoutingState<'_, S>,
    host: &H,
    request: OpenRequest,
    source: &PlacementSource,
) -> ApplicationResult<RouteOutcome> {
    let target = resolve_open_target(&request)?;
    // Deciding and reserving happen under one lock, so two requests for the same Project
    // that arrive together cannot both create a window.
    let claim = {
        let mut registry = lock(state.registry);
        match decide_route(&registry, &target.project_id) {
            RouteDecision::ExistingWindow { window_label } => Claim::Existing(window_label),
            RouteDecision::NewWindow => {
                let label = lock(state.labels).allocate();
                registry.register(&label);
                registry.reserve_project(&label, target.project_id);
                Claim::New(label)
            }
        }
    };
    match claim {
        Claim::Existing(window_label) => {
            host.raise_window(&window_label);
            // A Project folder has no Document to open: the Project is open there already.
            if let Some(document_id) = target.document_id {
                state.notify_window(
                    &window_label,
                    SentOpenRequest {
                        request_id: Uuid::now_v7().hyphenated().to_string(),
                        document_id,
                        request,
                    },
                );
            }
            Ok(RouteOutcome::FocusedExisting { window_label })
        }
        Claim::New(window_label) => {
            state.open_window(host, &window_label, request, source)?;
            Ok(RouteOutcome::OpenedInNewWindow { window_label })
        }
    }
}

/// An open request from outside the app (second launch, a window that went away before
/// acknowledging). One that cannot be read still gets a window: it takes the request and
/// shows the error, like a bad `.dawn` given at start-up.
pub fn route_external_request<S: AppNotificationSink, H: WindowHost>(
    state: &RoutingState<'_, S>,
    host: &H,
    request: OpenRequest,
) {
    let source = PlacementSource::MostRecentlyFocused;
    if let Err(error) = resolve_open_target(&request) {
        eprintln!("open request could not be read: {error}");
        let label = lock(state.labels).allocate();
        lock(state.registry).register(&label);
        if let Err(error) = state.open_window(host, &label, request, &source) {
            eprintln!("{error}");
        }
        return;
    }
    if let Err(error) = route_open_request(state, host, request, &source) {
        eprintln!("open request failed: {error}");
    }
}

/// The second launch (single-instance callback). `arguments` / `working_directory` are the
/// second process's own. Without a `.dawn` it only brings a window forward.
pub fn handle_second_launch<S: AppNotificationSink, H: WindowHost>(
    state: &RoutingState<'_, S>,
    host: &H,
    arguments: impl IntoIterator<Item = OsString>,
    working_directory: &Path,
) {
    match select_open_request(arguments, working_directory) {
        Some(request) => route_external_request(state, host, request),
        None => host.raise_window(&state.source_label(&PlacementSource::MostRecentlyFocused)),
    }
}

/// A window was destroyed: what it never acknowledged is routed again. The Project is no
/// longer open there (the caller already released the window's state), so each goes to
/// another window that has it or to a new one.
pub fn reroute_unacknowledged<S: AppNotificationSink, H: WindowHost>(
    state: &RoutingState<'_, S>,
    host: &H,
    lost: Vec<SentOpenRequest>,
) {
    for sent in lost {
        route_external_request(state, host, sent.request);
    }
}

// ---- moving Documents between windows ----------------------------------------------------

/// Where a Document goes.
#[derive(Debug, Clone, PartialEq)]
pub enum TransferTarget {
    /// A new Document window; `position` (logical screen pixels) is where it was dropped.
    NewWindow { position: Option<(f64, f64)> },
    /// Another window of the same Project.
    Window { label: String },
}

/// The window (of `candidates`, front-most first) whose area holds the screen point, in
/// logical pixels. A window whose position is unknown cannot be hit.
pub fn window_containing(
    point: (f64, f64),
    candidates: &[(String, WindowGeometry)],
) -> Option<String> {
    candidates
        .iter()
        .find(|(_, geometry)| {
            geometry.position.is_some_and(|(left, top)| {
                point.0 >= left
                    && point.0 < left + geometry.width
                    && point.1 >= top
                    && point.1 < top + geometry.height
            })
        })
        .map(|(label, _)| label.clone())
}

/// Hands the Document `document` of `from` to `target`. On success the target holds it and
/// is told (or created and will ask for it); the sender drops it without saving. On failure
/// nothing changed: the sender still holds it.
#[allow(clippy::too_many_arguments)]
pub fn hand_over_document<S: AppNotificationSink, H: WindowHost>(
    state: &RoutingState<'_, S>,
    transfers: &Mutex<DocumentTransfers>,
    host: &H,
    from: &str,
    project: ProjectId,
    document: DocumentId,
    payload: String,
    target: TransferTarget,
) -> ApplicationResult<()> {
    {
        let registry = lock(state.registry);
        registry.ensure_bound(from, &project)?;
        if registry.owner_of_document(&project, &document) != Some(from) {
            return Err(invalid_transfer(format!(
                "window {from} does not hold document {document}"
            )));
        }
    }
    match target {
        TransferTarget::Window { label } => {
            {
                let mut registry = lock(state.registry);
                if label == from || registry.ensure_bound(&label, &project).is_err() {
                    return Err(invalid_transfer(format!(
                        "window {label} cannot take a document of project {project}"
                    )));
                }
                let transfer_id = lock(transfers).put(project, document, &label, payload)?;
                registry.move_document(&project, document, &label);
                drop(registry);
                state
                    .hub
                    .send_untracked(&label, AppNotification::ReceiveDocument { transfer_id });
            }
            host.raise_window(&label);
            Ok(())
        }
        TransferTarget::NewWindow { position } => {
            let source = host.window_geometry(from);
            let transfer_id = lock(transfers).put(project, document, "", payload)?;
            open_document_window(
                state,
                transfers,
                host,
                project,
                document,
                transfer_id,
                source,
                position,
            )
            .inspect_err(|_| {
                // Back to the sender, as if nothing happened.
                lock(state.registry).move_document(&project, document, from);
            })
        }
    }
}

/// Creates a Document window for the waiting hand-over `transfer_id`. Undoes everything
/// about the new window when it cannot be created (the hand-over is withdrawn).
#[allow(clippy::too_many_arguments)]
fn open_document_window<S: AppNotificationSink, H: WindowHost>(
    state: &RoutingState<'_, S>,
    transfers: &Mutex<DocumentTransfers>,
    host: &H,
    project: ProjectId,
    document: DocumentId,
    transfer_id: String,
    source: Option<WindowGeometry>,
    position: Option<(f64, f64)>,
) -> ApplicationResult<()> {
    let label = lock(state.labels).allocate();
    {
        let mut registry = lock(state.registry);
        registry.register(&label);
        registry.attach_document_window(&label, project);
        registry.move_document(&project, document, &label);
    }
    {
        let mut transfers = lock(transfers);
        if let Some(pending) = transfers.cancel(&transfer_id) {
            transfers.readdress(pending, &label);
        }
    }
    lock(state.pending).put(
        &label,
        OpenRequest::DocumentTransfer {
            project_id: project,
            transfer_id: transfer_id.clone(),
        },
    );
    let mut placement = placement_following(source);
    if position.is_some() {
        placement.position = position;
    }
    if let Err(detail) = host.create_window(&label, placement) {
        lock(transfers).cancel(&transfer_id);
        lock(state.pending).discard(&label);
        lock(state.registry).unregister(&label);
        return Err(window_creation_failed(&detail));
    }
    Ok(())
}

/// A window went away before taking what was handed to it: each Document goes to its
/// Project's window (the Project window first), or to a new Document window when none is
/// left.
pub fn reroute_transfers<S: AppNotificationSink, H: WindowHost>(
    state: &RoutingState<'_, S>,
    transfers: &Mutex<DocumentTransfers>,
    host: &H,
    lost: Vec<PendingTransfer>,
) {
    for transfer in lost {
        let project = transfer.project_id;
        let document = transfer.document_id;
        let existing = lock(state.registry)
            .windows_of_project(&project)
            .into_iter()
            .map(|(label, _)| label)
            .next();
        match existing {
            Some(label) => {
                let transfer_id = lock(transfers).readdress(transfer, &label);
                lock(state.registry).move_document(&project, document, &label);
                state
                    .hub
                    .send_untracked(&label, AppNotification::ReceiveDocument { transfer_id });
                host.raise_window(&label);
            }
            None => {
                let transfer_id = lock(transfers).readdress(transfer, "");
                let source = host.window_geometry(MAIN_WINDOW_LABEL);
                if let Err(error) = open_document_window(
                    state,
                    transfers,
                    host,
                    project,
                    document,
                    transfer_id,
                    source,
                    None,
                ) {
                    // Without any window of the Project its session is gone as well; the
                    // unsaved changes of this Document cannot be kept.
                    eprintln!("a moved document could not be delivered: {error}");
                }
            }
        }
    }
}

// ---- production host -------------------------------------------------------------------

pub struct TauriWindowHost<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriWindowHost<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> WindowHost for TauriWindowHost<R> {
    fn raise_window(&self, label: &str) {
        let Some(window) = self.app.get_webview_window(label) else {
            eprintln!("window {label} to bring forward does not exist");
            return;
        };
        if let Err(error) = window.unminimize() {
            eprintln!("failed to restore window {label}: {error}");
        }
        if let Err(error) = window.set_focus() {
            eprintln!("failed to focus window {label}: {error}");
        }
    }

    fn window_geometry(&self, label: &str) -> Option<WindowGeometry> {
        let window = self.app.get_webview_window(label)?;
        let scale = window.scale_factor().ok()?;
        let size = window.inner_size().ok()?.to_logical::<f64>(scale);
        let position = window
            .outer_position()
            .ok()
            .map(|position| position.to_logical::<f64>(scale))
            .map(|position| (position.x, position.y));
        Some(WindowGeometry {
            width: size.width,
            height: size.height,
            position,
        })
    }

    fn create_window(&self, label: &str, placement: WindowPlacement) -> Result<(), String> {
        // Title, minimum size and URL come from the first window's config, so a new window
        // cannot drift from `main`.
        let mut config = self
            .app
            .config()
            .app
            .windows
            .first()
            .cloned()
            .ok_or_else(|| "no window is configured".to_owned())?;
        config.label = label.to_owned();
        // `main` starts hidden until its size is applied (`tauri.conf.json`); a new window
        // is shown by the builder as usual.
        config.visible = true;
        let mut builder = WebviewWindowBuilder::from_config(&self.app, &config)
            .map_err(|error| error.to_string())?;
        // The neighbour's size when there is one; otherwise the size recorded when a
        // window was last closed, else the config size.
        if let Some((width, height)) = placement
            .size
            .or_else(|| recorded_size_for_new_window(&self.app))
        {
            builder = builder.inner_size(width, height);
        }
        if let Some((x, y)) = placement.position {
            builder = builder.position(x, y);
        }
        builder
            .build()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

/// Runs `work` with the app's routing state and a production host, on the blocking pool.
/// The blocking pool is what keeps window creation off the main thread (see the module doc).
pub fn dispatch_in_background<R: Runtime>(
    app: &AppHandle<R>,
    work: impl FnOnce(&AppRoutingState<'_>, &TauriWindowHost<R>) + Send + 'static,
) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_routing_state(&app, |state| {
            work(state, &TauriWindowHost::new(app.clone()))
        });
    });
}

/// Builds the `RoutingState` of the running app from its managed state.
pub fn with_routing_state<R: Runtime, T>(
    app: &AppHandle<R>,
    work: impl FnOnce(&AppRoutingState<'_>) -> T,
) -> T {
    let registry = app.state::<Mutex<WindowRegistry>>();
    let pending = app.state::<Mutex<PendingOpenRequests>>();
    let hub = app.state::<AppRequestSubscriber>();
    let labels = app.state::<Mutex<WindowLabelAllocator>>();
    work(&RoutingState {
        registry: &registry,
        pending: &pending,
        hub: &hub,
        labels: &labels,
    })
}
