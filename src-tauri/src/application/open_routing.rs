//! The pure part of routing an open request to a window:
//! which window handles a Project, the labels of new windows, and the open-document requests
//! that were sent to a window but not yet acknowledged. No Tauri types, so every rule is
//! unit-tested; the commands layer executes the decisions.

use std::collections::HashMap;

use super::open_request::OpenRequest;
use super::window_registry::WindowRegistry;
use crate::config::WINDOW_LABEL_PREFIX;
use crate::domain::entity_id::{DocumentId, ProjectId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteDecision {
    /// A window already has the Project (or is about to open it): bring it forward.
    ExistingWindow { window_label: String },
    /// Nobody has it: a new window opens it.
    NewWindow,
}

/// One Project is open in at most one window, so a Project that is claimed (open, or
/// reserved by a window that is still starting) never gets a second window.
pub fn decide_route(registry: &WindowRegistry, project: &ProjectId) -> RouteDecision {
    match registry.find_window_claiming_project(project) {
        Some(window_label) => RouteDecision::ExistingWindow {
            window_label: window_label.to_owned(),
        },
        None => RouteDecision::NewWindow,
    }
}

/// Hands out `window-<n>` labels. Monotonic: a label is never reused while the app runs, so
/// a late event of a destroyed window cannot be mistaken for its successor's.
#[derive(Debug, Default)]
pub struct WindowLabelAllocator {
    issued: u64,
}

impl WindowLabelAllocator {
    pub fn allocate(&mut self) -> String {
        self.issued += 1;
        format!("{WINDOW_LABEL_PREFIX}{}", self.issued)
    }
}

/// An open-document request that was sent to a window. The original request is kept so it
/// can be routed again when the window disappears before acknowledging it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentOpenRequest {
    pub request_id: String,
    pub document_id: DocumentId,
    pub request: OpenRequest,
}

#[derive(Debug, Default)]
pub struct UnacknowledgedRequests {
    by_window: HashMap<String, Vec<SentOpenRequest>>,
}

impl UnacknowledgedRequests {
    pub fn record(&mut self, window_label: &str, sent: SentOpenRequest) {
        self.by_window
            .entry(window_label.to_owned())
            .or_default()
            .push(sent);
    }

    /// Whether the request was waiting for that window. An id of another window or an
    /// unknown one changes nothing.
    pub fn acknowledge(&mut self, window_label: &str, request_id: &str) -> bool {
        let Some(requests) = self.by_window.get_mut(window_label) else {
            return false;
        };
        let before = requests.len();
        requests.retain(|sent| sent.request_id != request_id);
        let removed = requests.len() != before;
        if requests.is_empty() {
            self.by_window.remove(window_label);
        }
        removed
    }

    pub fn pending_for(&self, window_label: &str) -> Vec<SentOpenRequest> {
        self.by_window
            .get(window_label)
            .cloned()
            .unwrap_or_default()
    }

    /// For a destroyed window: everything it never acknowledged, to be routed again.
    pub fn take_window(&mut self, window_label: &str) -> Vec<SentOpenRequest> {
        self.by_window.remove(window_label).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn project(number: u8) -> ProjectId {
        ProjectId::parse(&format!("01928f3a-0000-7000-8000-0000000000{number:02}")).unwrap()
    }

    fn document() -> DocumentId {
        DocumentId::parse("01928f3a-0000-7000-8000-0000000000aa").unwrap()
    }

    fn sent(request_id: &str) -> SentOpenRequest {
        SentOpenRequest {
            request_id: request_id.to_owned(),
            document_id: document(),
            request: OpenRequest::EntryPoint(PathBuf::from("/p/a.dawn")),
        }
    }

    #[test]
    fn a_project_open_in_a_window_routes_to_that_window() {
        let mut registry = WindowRegistry::default();
        registry.bind("window-3", project(1)).unwrap();
        assert_eq!(
            decide_route(&registry, &project(1)),
            RouteDecision::ExistingWindow {
                window_label: "window-3".to_owned()
            }
        );
    }

    #[test]
    fn a_project_nobody_has_routes_to_a_new_window() {
        let mut registry = WindowRegistry::default();
        registry.bind("main", project(1)).unwrap();
        assert_eq!(
            decide_route(&registry, &project(2)),
            RouteDecision::NewWindow
        );
    }

    #[test]
    fn a_reserved_project_never_gets_a_second_window() {
        let mut registry = WindowRegistry::default();
        registry.reserve_project("window-1", project(1));
        assert_eq!(
            decide_route(&registry, &project(1)),
            RouteDecision::ExistingWindow {
                window_label: "window-1".to_owned()
            }
        );
    }

    #[test]
    fn labels_are_sequential_and_start_at_one() {
        let mut allocator = WindowLabelAllocator::default();
        assert_eq!(allocator.allocate(), "window-1");
        assert_eq!(allocator.allocate(), "window-2");
    }

    #[test]
    fn acknowledging_removes_only_that_request_of_that_window() {
        let mut requests = UnacknowledgedRequests::default();
        requests.record("main", sent("a"));
        requests.record("main", sent("b"));
        requests.record("window-1", sent("c"));
        assert!(!requests.acknowledge("window-1", "a"));
        assert!(requests.acknowledge("main", "a"));
        assert!(!requests.acknowledge("main", "a"));
        assert_eq!(requests.pending_for("main"), vec![sent("b")]);
        assert_eq!(requests.pending_for("window-1"), vec![sent("c")]);
    }

    #[test]
    fn taking_a_window_returns_its_requests_once() {
        let mut requests = UnacknowledgedRequests::default();
        requests.record("main", sent("a"));
        assert_eq!(requests.take_window("main"), vec![sent("a")]);
        assert!(requests.take_window("main").is_empty());
        assert!(requests.pending_for("main").is_empty());
    }
}
