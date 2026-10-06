//! Save before the window closes (docs/architecture.md §10.1). Rust only stops the close and
//! tells the Frontend; it keeps no "closing in progress" state. The Frontend saves, then calls
//! `confirm_window_close` with the token of its subscription, and only then the window is
//! destroyed. The token and subscription logic is in `CloseRequestHub`, independent of Tauri
//! types, because a `CloseRequestApi` cannot be built in tests.

use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Runtime, Window};
use uuid::Uuid;

use crate::application::error::ApplicationError;
use crate::infrastructure::error::PersistenceErrorKind;

/// What the Frontend receives: `{ "kind": "closeRequested", "subscriptionToken": string }`.
/// Deliberately carries nothing else (no path, no content).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CloseNotification {
    #[serde(rename_all = "camelCase")]
    CloseRequested { subscription_token: String },
}

/// Where a notification goes. The production sink is the IPC channel; tests use a fake.
pub trait CloseNotificationSink: Clone {
    fn send_notification(&self, notification: CloseNotification) -> Result<(), String>;
}

impl CloseNotificationSink for Channel<CloseNotification> {
    fn send_notification(&self, notification: CloseNotification) -> Result<(), String> {
        self.send(notification).map_err(|error| error.to_string())
    }
}

struct Subscription<S> {
    sink: S,
    token: String,
}

/// The current subscription. There is a single main window, so the latest subscription wins
/// (a reloaded frontend replaces the previous page's one and invalidates its token).
pub struct CloseRequestHub<S> {
    subscription: Mutex<Option<Subscription<S>>>,
}

impl<S> Default for CloseRequestHub<S> {
    fn default() -> Self {
        Self {
            subscription: Mutex::new(None),
        }
    }
}

/// The managed state of the running app.
pub type CloseRequestSubscriber = CloseRequestHub<Channel<CloseNotification>>;

impl<S: CloseNotificationSink> CloseRequestHub<S> {
    /// Replaces the subscription and returns its new token. An old page that still holds the
    /// previous token can no longer confirm a close.
    pub fn subscribe(&self, sink: S) -> String {
        let token = Uuid::now_v7().hyphenated().to_string();
        // A single replaceable value, so a poisoned lock cannot hold a broken invariant.
        *self
            .subscription
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(Subscription {
            sink,
            token: token.clone(),
        });
        token
    }

    /// True only for the token of the current subscription.
    pub fn accepts(&self, token: &str) -> bool {
        self.subscription
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .is_some_and(|subscription| subscription.token == token)
    }

    /// Forwards a close request to the current subscription. Returns whether it was sent;
    /// without a subscription (or when sending fails) nothing happens, so the window stays open.
    pub fn notify_close_requested(&self) -> bool {
        // Cloned so the lock is not held while the message is sent.
        let target = self
            .subscription
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|subscription| (subscription.sink.clone(), subscription.token.clone()));
        let Some((sink, subscription_token)) = target else {
            return false;
        };
        match sink.send_notification(CloseNotification::CloseRequested { subscription_token }) {
            Ok(()) => true,
            Err(error) => {
                // Nobody to report to; the window simply stays open.
                eprintln!("failed to send a close request notification: {error}");
                false
            }
        }
    }
}

/// The close is always prevented first, synchronously: the event handler must decide before
/// it returns, and the Frontend may need time (or fail) to save. Only then is the Frontend told.
pub fn handle_close_requested<S: CloseNotificationSink>(
    hub: &CloseRequestHub<S>,
    prevent_close: impl FnOnce(),
) -> bool {
    prevent_close();
    hub.notify_close_requested()
}

/// Destroys the window when `subscription_token` belongs to the current subscription;
/// otherwise a quiet no-op (a stale page's late confirmation is not an error). `destroy`, not
/// `close`: `close` would emit `CloseRequested` again and loop back to the handler.
pub fn confirm_close<R: Runtime, S: CloseNotificationSink>(
    hub: &CloseRequestHub<S>,
    window: &Window<R>,
    subscription_token: &str,
) -> Result<(), ApplicationError> {
    if !hub.accepts(subscription_token) {
        return Ok(());
    }
    window.destroy().map_err(|error| {
        ApplicationError::persistence(
            PersistenceErrorKind::IoError,
            format!("the window could not be closed: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Clone, Default)]
    struct RecordingSink {
        sent: Arc<Mutex<Vec<CloseNotification>>>,
        fail: bool,
    }

    impl CloseNotificationSink for RecordingSink {
        fn send_notification(&self, notification: CloseNotification) -> Result<(), String> {
            if self.fail {
                return Err("closed".to_owned());
            }
            self.sent.lock().unwrap().push(notification);
            Ok(())
        }
    }

    fn requested(token: &str) -> CloseNotification {
        CloseNotification::CloseRequested {
            subscription_token: token.to_owned(),
        }
    }

    #[test]
    fn the_token_is_a_canonical_lowercase_uuid_v7() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        let token = hub.subscribe(RecordingSink::default());
        let parsed = Uuid::parse_str(&token).unwrap();
        assert_eq!(parsed.get_version_num(), 7);
        assert_eq!(token, parsed.hyphenated().to_string());
    }

    #[test]
    fn subscribing_again_replaces_the_subscription_and_invalidates_the_old_token() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        let first = hub.subscribe(RecordingSink::default());
        let second = hub.subscribe(RecordingSink::default());
        assert_ne!(first, second);
        assert!(!hub.accepts(&first));
        assert!(hub.accepts(&second));
    }

    #[test]
    fn nothing_is_accepted_without_a_subscription() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        assert!(!hub.accepts(""));
        assert!(!hub.accepts("anything"));
    }

    #[test]
    fn a_random_token_is_rejected() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        hub.subscribe(RecordingSink::default());
        assert!(!hub.accepts(&Uuid::now_v7().hyphenated().to_string()));
        assert!(!hub.accepts(""));
    }

    #[test]
    fn a_request_is_sent_to_the_current_subscription_only() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        let old = RecordingSink::default();
        let current = RecordingSink::default();
        hub.subscribe(old.clone());
        let token = hub.subscribe(current.clone());
        assert!(hub.notify_close_requested());
        assert!(old.sent.lock().unwrap().is_empty());
        assert_eq!(*current.sent.lock().unwrap(), vec![requested(&token)]);
    }

    #[test]
    fn repeated_requests_are_each_forwarded() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        let sink = RecordingSink::default();
        hub.subscribe(sink.clone());
        hub.notify_close_requested();
        hub.notify_close_requested();
        assert_eq!(sink.sent.lock().unwrap().len(), 2);
    }

    #[test]
    fn without_a_subscription_nothing_is_sent() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        assert!(!hub.notify_close_requested());
    }

    #[test]
    fn a_failed_send_is_reported_as_not_sent() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        hub.subscribe(RecordingSink {
            fail: true,
            ..RecordingSink::default()
        });
        assert!(!hub.notify_close_requested());
    }

    #[test]
    fn the_close_is_prevented_before_the_notification_and_even_without_a_subscription() {
        let hub = CloseRequestHub::<RecordingSink>::default();
        let sink = RecordingSink::default();
        let order = Rc::new(RefCell::new(Vec::new()));

        let mut prevented = Vec::new();
        handle_close_requested(&hub, || prevented.push("prevent"));
        assert_eq!(prevented, ["prevent"]);

        hub.subscribe(sink.clone());
        let observed = Arc::clone(&sink.sent);
        let recorder = Rc::clone(&order);
        handle_close_requested(&hub, || {
            recorder.borrow_mut().push(observed.lock().unwrap().len());
        });
        // Nothing had been sent at the moment the close was prevented.
        assert_eq!(*order.borrow(), vec![0]);
        assert_eq!(sink.sent.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_wire_form_has_only_the_kind_and_the_token() {
        let value = serde_json::to_value(requested("abc")).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "kind": "closeRequested", "subscriptionToken": "abc" })
        );
    }
}
