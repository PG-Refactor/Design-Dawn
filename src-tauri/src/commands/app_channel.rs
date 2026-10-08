//! The app channel (docs/architecture.md §11.0.1): Rust to one window, for requests that
//! arrive while the window is running. Separate from the drop and close-request channels.
//! Today it only carries `openDocument` (a `.dawn` opened again for a Project this window
//! has); `settingsChanged` joins it later.
//!
//! Delivery is at-least-once: an `openDocument` stays "unacknowledged" until the window
//! confirms it with `ack_open_request`. What happens to a request whose window disappears
//! first is decided by the caller of `discard_window` (it is routed again). The logic is
//! independent of Tauri types (`AppNotificationSink`), like `CloseRequestHub`, so it is
//! tested with a fake sink.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::ipc::Channel;

use crate::application::open_routing::{SentOpenRequest, UnacknowledgedRequests};

/// What the Frontend receives: `{ "kind": "openDocument", "requestId": string,
/// "documentId": string }`. Deliberately carries no path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppNotification {
    #[serde(rename_all = "camelCase")]
    OpenDocument {
        request_id: String,
        document_id: String,
    },
}

impl AppNotification {
    fn open_document(sent: &SentOpenRequest) -> Self {
        Self::OpenDocument {
            request_id: sent.request_id.clone(),
            document_id: sent.document_id.to_string(),
        }
    }
}

/// Where a notification goes. The production sink is the IPC channel; tests use a fake.
pub trait AppNotificationSink: Clone {
    fn send_notification(&self, notification: AppNotification) -> Result<(), String>;
}

impl AppNotificationSink for Channel<AppNotification> {
    fn send_notification(&self, notification: AppNotification) -> Result<(), String> {
        self.send(notification).map_err(|error| error.to_string())
    }
}

/// The current channel of each window (the latest subscription of a window wins, like the
/// other channels) and the requests sent to it that it has not acknowledged.
pub struct AppRequestHub<S> {
    subscriptions: Mutex<HashMap<String, S>>,
    unacknowledged: Mutex<UnacknowledgedRequests>,
}

impl<S> Default for AppRequestHub<S> {
    fn default() -> Self {
        Self {
            subscriptions: Mutex::new(HashMap::new()),
            unacknowledged: Mutex::new(UnacknowledgedRequests::default()),
        }
    }
}

/// The managed state of the running app.
pub type AppRequestSubscriber = AppRequestHub<Channel<AppNotification>>;

impl<S: AppNotificationSink> AppRequestHub<S> {
    // Both maps are consistent after every single operation, so a poisoned lock holds no
    // broken invariant.
    fn subscriptions(&self) -> MutexGuard<'_, HashMap<String, S>> {
        self.subscriptions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn unacknowledged(&self) -> MutexGuard<'_, UnacknowledgedRequests> {
        self.unacknowledged
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn deliver(&self, window_label: &str, sent: &SentOpenRequest) -> bool {
        // Cloned so the lock is not held while the message is sent.
        let sink = self.subscriptions().get(window_label).cloned();
        let Some(sink) = sink else {
            return false;
        };
        match sink.send_notification(AppNotification::open_document(sent)) {
            Ok(()) => true,
            Err(error) => {
                // Stays unacknowledged: it is delivered again on the next subscription or
                // routed again if the window goes away.
                eprintln!("failed to send an open request: {error}");
                false
            }
        }
    }

    /// Replaces the window's channel and sends it what it has not acknowledged yet (a window
    /// whose Frontend subscribes after a request arrived, or a reloaded page).
    pub fn subscribe(&self, window_label: &str, sink: S) {
        self.subscriptions().insert(window_label.to_owned(), sink);
        for sent in self.unacknowledged().pending_for(window_label) {
            self.deliver(window_label, &sent);
        }
    }

    /// Records the request as unacknowledged first, then tries to send it: a missing
    /// subscription or a failed send keeps it recorded. Returns whether it was sent.
    pub fn send_open_document(&self, window_label: &str, sent: SentOpenRequest) -> bool {
        self.unacknowledged().record(window_label, sent.clone());
        self.deliver(window_label, &sent)
    }

    pub fn acknowledge(&self, window_label: &str, request_id: &str) -> bool {
        self.unacknowledged().acknowledge(window_label, request_id)
    }

    /// For a destroyed window: forgets its channel and returns what it never acknowledged.
    pub fn discard_window(&self, window_label: &str) -> Vec<SentOpenRequest> {
        self.subscriptions().remove(window_label);
        self.unacknowledged().take_window(window_label)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use super::*;
    use crate::application::open_request::OpenRequest;
    use crate::domain::entity_id::DocumentId;

    #[derive(Clone, Default)]
    struct FakeSink {
        received: Arc<Mutex<Vec<AppNotification>>>,
        fail: bool,
    }

    impl AppNotificationSink for FakeSink {
        fn send_notification(&self, notification: AppNotification) -> Result<(), String> {
            if self.fail {
                return Err("closed".to_owned());
            }
            self.received.lock().unwrap().push(notification);
            Ok(())
        }
    }

    fn sent(request_id: &str) -> SentOpenRequest {
        SentOpenRequest {
            request_id: request_id.to_owned(),
            document_id: DocumentId::parse("01928f3a-0000-7000-8000-0000000000aa").unwrap(),
            request: OpenRequest::EntryPoint(PathBuf::from("/p/a.dawn")),
        }
    }

    fn received(sink: &FakeSink) -> Vec<AppNotification> {
        sink.received.lock().unwrap().clone()
    }

    #[test]
    fn the_notification_serializes_with_a_kind_and_no_path() {
        let value = serde_json::to_value(AppNotification::open_document(&sent("r1"))).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "openDocument",
                "requestId": "r1",
                "documentId": "01928f3a-0000-7000-8000-0000000000aa"
            })
        );
    }

    #[test]
    fn a_subscribed_window_is_sent_the_request_and_it_stays_unacknowledged() {
        let hub = AppRequestHub::<FakeSink>::default();
        let sink = FakeSink::default();
        hub.subscribe("main", sink.clone());
        assert!(hub.send_open_document("main", sent("r1")));
        assert_eq!(received(&sink).len(), 1);
        assert!(hub.acknowledge("main", "r1"));
        assert!(!hub.acknowledge("main", "r1"));
        assert!(hub.discard_window("main").is_empty());
    }

    #[test]
    fn without_a_subscription_the_request_waits_and_is_delivered_on_subscribe() {
        let hub = AppRequestHub::<FakeSink>::default();
        assert!(!hub.send_open_document("window-1", sent("r1")));
        let sink = FakeSink::default();
        hub.subscribe("window-1", sink.clone());
        assert_eq!(
            received(&sink),
            vec![AppNotification::open_document(&sent("r1"))]
        );
    }

    #[test]
    fn a_failed_send_keeps_the_request_unacknowledged() {
        let hub = AppRequestHub::<FakeSink>::default();
        hub.subscribe(
            "main",
            FakeSink {
                fail: true,
                ..FakeSink::default()
            },
        );
        assert!(!hub.send_open_document("main", sent("r1")));
        assert_eq!(hub.discard_window("main"), vec![sent("r1")]);
    }

    #[test]
    fn an_acknowledged_request_is_not_sent_again_on_resubscribe() {
        let hub = AppRequestHub::<FakeSink>::default();
        hub.subscribe("main", FakeSink::default());
        hub.send_open_document("main", sent("r1"));
        hub.acknowledge("main", "r1");
        let later = FakeSink::default();
        hub.subscribe("main", later.clone());
        assert!(received(&later).is_empty());
    }

    #[test]
    fn requests_never_cross_windows() {
        let hub = AppRequestHub::<FakeSink>::default();
        let other = FakeSink::default();
        hub.subscribe("window-1", other.clone());
        hub.send_open_document("main", sent("r1"));
        assert!(received(&other).is_empty());
        assert!(!hub.acknowledge("window-1", "r1"));
    }

    #[test]
    fn discarding_a_window_forgets_its_channel() {
        let hub = AppRequestHub::<FakeSink>::default();
        let sink = FakeSink::default();
        hub.subscribe("main", sink.clone());
        hub.discard_window("main");
        assert!(!hub.send_open_document("main", sent("r1")));
        assert!(received(&sink).is_empty());
    }
}
