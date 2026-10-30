//! Window drag & drop. The native event carries absolute paths,
//! which stay in Rust (`DroppedFilesState`); the Frontend is told only a `dropId` and a count,
//! and activity changes for feedback. This handler stays thin: the state logic is in
//! `application::dropped_files`.
//!
//! The notifications travel over a `tauri::ipc::Channel` the Frontend hands to
//! `subscribe_drop_notifications`, not over Tauri events. Tauri still emits its own built-in
//! drag-drop events (they carry paths), but no frontend code can register a listener for
//! them because the capability grants no `core:event` permission.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{DragDropEvent, Manager, Runtime, Window};

use crate::application::dropped_files::{
    register_drop, DragState, DroppedFilesState, FilesDropped,
};

/// What the Frontend receives on the channel: `{ "kind": "dragState", "active": bool }` or
/// `{ "kind": "filesDropped", "dropId": string, "fileCount": number }`. Deliberately carries
/// no path or file name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DropNotification {
    DragState(DragState),
    FilesDropped(FilesDropped),
}

/// The subscribers, one per window: a drop is announced to the window it happened in. The
/// latest subscription of a window wins (a reloaded frontend replaces the channel of its
/// previous page).
#[derive(Default)]
pub struct DropSubscriber {
    channels: Mutex<HashMap<String, Channel<DropNotification>>>,
}

impl DropSubscriber {
    pub fn replace(&self, window_label: &str, channel: Channel<DropNotification>) {
        // Each entry is a single replaceable value, so a poisoned lock cannot hold a broken
        // invariant.
        self.channels
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(window_label.to_owned(), channel);
    }

    /// For a destroyed window.
    pub fn discard_window(&self, window_label: &str) {
        self.channels
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(window_label);
    }

    fn notify(&self, window_label: &str, notification: DropNotification) {
        // Cloned so the lock is not held while the message is sent.
        let channel = self
            .channels
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(window_label)
            .cloned();
        let Some(channel) = channel else {
            return;
        };
        // A failed send only costs UI feedback (or, for a drop, the Frontend never learns of
        // it); there is nobody to report to, so it is logged instead of panicking the event loop.
        if let Err(error) = channel.send(notification) {
            eprintln!("failed to send a drop notification: {error}");
        }
    }
}

pub(super) fn handle_drag_drop_event<R: Runtime>(window: &Window<R>, drag_drop: &DragDropEvent) {
    let subscriber = window.state::<DropSubscriber>();
    let label = window.label();
    match drag_drop {
        DragDropEvent::Enter { .. } | DragDropEvent::Over { .. } => {
            subscriber.notify(
                label,
                DropNotification::DragState(DragState { active: true }),
            );
        }
        DragDropEvent::Leave => {
            subscriber.notify(
                label,
                DropNotification::DragState(DragState { active: false }),
            );
        }
        DragDropEvent::Drop { paths, .. } => {
            subscriber.notify(
                label,
                DropNotification::DragState(DragState { active: false }),
            );
            let state = window.state::<Mutex<DroppedFilesState>>();
            if let Some(dropped) = register_drop(&state, label, paths.clone()) {
                subscriber.notify(label, DropNotification::FilesDropped(dropped));
            }
        }
        // `DragDropEvent` is non-exhaustive.
        _ => {}
    }
}
