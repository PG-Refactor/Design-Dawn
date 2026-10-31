//! The app channel: Rust to one window, for requests that
//! arrive while the window is running. Separate from the drop and close-request channels.
//! It carries `openDocument` (a `.dawn` opened again for a Project this window has) and
//! `settingsChanged` (the theme or auto-save setting was changed in another window).
//!
//! Delivery is at-least-once: an `openDocument` stays "unacknowledged" until the window
//! confirms it with `ack_open_request`. What happens to a request whose window disappears
//! first is decided by the caller of `discard_window` (it is routed again). `settingsChanged`
//! is fire and forget: a window reads the settings at start-up, so a missed one needs no
//! tracking. The logic is
//! independent of Tauri types (`AppNotificationSink`), like `CloseRequestHub`, so it is
//! tested with a fake sink.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::ipc::Channel;

use crate::application::external_change::ExternalChanges;
use crate::application::local_state::language::LanguagePreference;
use crate::application::local_state::text_size::TextSize;
use crate::application::local_state::theme::ThemePreference;
use crate::application::open_routing::{SentOpenRequest, UnacknowledgedRequests};
use crate::domain::entity_id::ProjectId;

/// What the Frontend receives: `{ "kind": "openDocument", "requestId": string,
/// "documentId": string }` or `{ "kind": "settingsChanged", "themePreference": string,
/// "languagePreference": string, "textSize": string, "autoSave": boolean }`. Deliberately carries no path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppNotification {
    #[serde(rename_all = "camelCase")]
    OpenDocument {
        request_id: String,
        document_id: String,
    },
    #[serde(rename_all = "camelCase")]
    SettingsChanged {
        theme_preference: ThemePreference,
        language_preference: LanguagePreference,
        text_size: TextSize,
        auto_save: bool,
    },
    /// Files of the window's Project changed behind the app's back: `{ "kind": "projectFilesChanged", "projectId", "sessionGeneration",
    /// "watching", "rescan", "project", "documents" }`. Paths are relative; none is absolute.
    #[serde(rename_all = "camelCase")]
    ProjectFilesChanged {
        project_id: String,
        #[serde(flatten)]
        changes: ExternalChanges,
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

    /// Sends the settings to every subscribed window except `except_label` (the one that
    /// changed them and updated itself). Returns the labels it was sent to, in no
    /// particular order. A failed send is only logged: that window reads the settings again
    /// when it starts, and nothing is queued for it.
    pub fn broadcast_settings_changed(
        &self,
        except_label: &str,
        theme_preference: ThemePreference,
        language_preference: LanguagePreference,
        text_size: TextSize,
        auto_save: bool,
    ) -> Vec<String> {
        // Cloned so the lock is not held while the messages are sent.
        let targets: Vec<(String, S)> = self
            .subscriptions()
            .iter()
            .filter(|(label, _)| label.as_str() != except_label)
            .map(|(label, sink)| (label.clone(), sink.clone()))
            .collect();
        let mut sent_to = Vec::new();
        for (label, sink) in targets {
            let notification = AppNotification::SettingsChanged {
                theme_preference,
                language_preference,
                text_size,
                auto_save,
            };
            match sink.send_notification(notification) {
                Ok(()) => sent_to.push(label),
                Err(error) => eprintln!("failed to send settings to window {label}: {error}"),
            }
        }
        sent_to
    }

    /// Tells one window that files of its Project changed. Fire and forget: a window that
    /// misses it compares everything when it regains focus. Returns whether it was sent.
    pub fn send_project_files_changed(
        &self,
        window_label: &str,
        project_id: &ProjectId,
        changes: ExternalChanges,
    ) -> bool {
        // Cloned so the lock is not held while the message is sent.
        let sink = self.subscriptions().get(window_label).cloned();
        let Some(sink) = sink else {
            return false;
        };
        let notification = AppNotification::ProjectFilesChanged {
            project_id: project_id.to_string(),
            changes,
        };
        match sink.send_notification(notification) {
            Ok(()) => true,
            Err(error) => {
                eprintln!("failed to send a file change notice to window {window_label}: {error}");
                false
            }
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

    fn theme(value: &str) -> ThemePreference {
        ThemePreference::parse(value).unwrap()
    }

    fn size(value: &str) -> TextSize {
        TextSize::parse(value).unwrap()
    }

    fn language(value: &str) -> LanguagePreference {
        LanguagePreference::parse(value).unwrap()
    }

    #[test]
    fn the_settings_notification_serializes_with_a_kind() {
        let value = serde_json::to_value(AppNotification::SettingsChanged {
            theme_preference: theme("dark"),
            language_preference: language("ja"),
            text_size: size("large"),
            auto_save: false,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "settingsChanged",
                "themePreference": "dark",
                "languagePreference": "ja",
                "textSize": "large",
                "autoSave": false
            })
        );
    }

    fn sample_changes() -> ExternalChanges {
        use crate::application::external_change::{
            ChangedFile, DocumentChanges, FileChange, ProjectChanges,
        };
        ExternalChanges {
            session_generation: 3,
            watching: true,
            rescan: false,
            project: ProjectChanges {
                structure: false,
                files: Vec::new(),
            },
            documents: vec![DocumentChanges {
                document_id: "01928f3a-6c7d-7e8f-a012-3456789abcde".to_owned(),
                files: vec![ChangedFile {
                    path: "sheets/overview/blocks/markdown-1.md".to_owned(),
                    change: FileChange::Modified,
                    readable: true,
                }],
            }],
        }
    }

    #[test]
    fn the_files_changed_notification_is_flat_and_carries_relative_paths_only() {
        let project_id = ProjectId::parse("01928f3a-5b6c-7d8e-9f01-23456789abcd").unwrap();
        let value = serde_json::to_value(AppNotification::ProjectFilesChanged {
            project_id: project_id.to_string(),
            changes: sample_changes(),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "kind": "projectFilesChanged",
                "projectId": "01928f3a-5b6c-7d8e-9f01-23456789abcd",
                "sessionGeneration": 3,
                "watching": true,
                "rescan": false,
                "project": { "structure": false, "files": [] },
                "documents": [{
                    "documentId": "01928f3a-6c7d-7e8f-a012-3456789abcde",
                    "files": [{
                        "path": "sheets/overview/blocks/markdown-1.md",
                        "change": "modified",
                        "readable": true
                    }]
                }]
            })
        );
    }

    #[test]
    fn a_files_changed_notice_goes_to_the_named_window_only() {
        let project_id = ProjectId::parse("01928f3a-5b6c-7d8e-9f01-23456789abcd").unwrap();
        let hub = AppRequestHub::<FakeSink>::default();
        let owner = FakeSink::default();
        let other = FakeSink::default();
        hub.subscribe("window-1", owner.clone());
        hub.subscribe("main", other.clone());
        assert!(hub.send_project_files_changed("window-1", &project_id, sample_changes()));
        assert_eq!(received(&owner).len(), 1);
        assert!(received(&other).is_empty());
        // No subscription, or a failing channel: only reported as not sent, nothing queued.
        assert!(!hub.send_project_files_changed("window-9", &project_id, sample_changes()));
        hub.subscribe(
            "window-2",
            FakeSink {
                fail: true,
                ..FakeSink::default()
            },
        );
        assert!(!hub.send_project_files_changed("window-2", &project_id, sample_changes()));
        assert!(hub.discard_window("window-9").is_empty());
    }

    #[test]
    fn settings_go_to_the_other_subscribed_windows_only() {
        let hub = AppRequestHub::<FakeSink>::default();
        let caller = FakeSink::default();
        let other = FakeSink::default();
        let third = FakeSink::default();
        hub.subscribe("main", caller.clone());
        hub.subscribe("window-1", other.clone());
        hub.subscribe("window-2", third.clone());
        let mut sent_to = hub.broadcast_settings_changed(
            "main",
            theme("dark"),
            language("ja"),
            size("large"),
            false,
        );
        sent_to.sort();
        assert_eq!(sent_to, vec!["window-1", "window-2"]);
        assert!(received(&caller).is_empty());
        let expected = vec![AppNotification::SettingsChanged {
            theme_preference: theme("dark"),
            language_preference: language("ja"),
            text_size: size("large"),
            auto_save: false,
        }];
        assert_eq!(received(&other), expected);
        assert_eq!(received(&third), expected);
    }

    #[test]
    fn a_window_without_a_subscription_gets_no_settings_and_nothing_is_queued() {
        let hub = AppRequestHub::<FakeSink>::default();
        hub.subscribe("main", FakeSink::default());
        assert!(hub
            .broadcast_settings_changed(
                "main",
                theme("light"),
                language("system"),
                size("medium"),
                true
            )
            .is_empty());
        let late = FakeSink::default();
        hub.subscribe("window-1", late.clone());
        assert!(received(&late).is_empty());
        assert!(hub.discard_window("window-1").is_empty());
    }

    #[test]
    fn a_failed_settings_send_skips_that_window_only() {
        let hub = AppRequestHub::<FakeSink>::default();
        let healthy = FakeSink::default();
        hub.subscribe(
            "window-1",
            FakeSink {
                fail: true,
                ..FakeSink::default()
            },
        );
        hub.subscribe("window-2", healthy.clone());
        let sent_to = hub.broadcast_settings_changed(
            "main",
            theme("system"),
            language("en"),
            size("small"),
            true,
        );
        assert_eq!(sent_to, vec!["window-2"]);
        assert_eq!(received(&healthy).len(), 1);
    }

    #[test]
    fn settings_do_not_touch_the_unacknowledged_open_requests() {
        let hub = AppRequestHub::<FakeSink>::default();
        hub.subscribe("window-1", FakeSink::default());
        hub.send_open_document("window-1", sent("r1"));
        hub.broadcast_settings_changed(
            "main",
            theme("dark"),
            language("system"),
            size("xlarge"),
            true,
        );
        assert_eq!(hub.discard_window("window-1"), vec![sent("r1")]);
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
