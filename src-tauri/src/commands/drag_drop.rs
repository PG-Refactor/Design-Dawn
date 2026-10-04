//! Window drag & drop (docs/architecture.md §6.2.2). The native event carries absolute paths,
//! which stay in Rust (`DroppedFilesState`); the Frontend is told only a `dropId` and a count,
//! and activity changes for feedback. This handler stays thin: the state logic is in
//! `application::dropped_files`.
//!
//! The notifications travel over a `tauri::ipc::Channel` the Frontend hands to
//! `subscribe_drop_notifications`, not over Tauri events. Tauri still emits its own built-in
//! drag-drop events (they carry paths), but no frontend code can register a listener for
//! them because the capability grants no `core:event` permission.

use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{DragDropEvent, Manager, Runtime, Window, WindowEvent};

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

/// The current subscriber. There is a single main window, so the latest subscription wins
/// (a reloaded frontend replaces the channel of its previous page).
#[derive(Default)]
pub struct DropSubscriber {
    channel: Mutex<Option<Channel<DropNotification>>>,
}

impl DropSubscriber {
    pub fn replace(&self, channel: Channel<DropNotification>) {
        // A single replaceable value, so a poisoned lock cannot hold a broken invariant.
        *self.channel.lock().unwrap_or_else(PoisonError::into_inner) = Some(channel);
    }

    fn notify(&self, notification: DropNotification) {
        // Cloned so the lock is not held while the message is sent.
        let channel = self
            .channel
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
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

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::DragDrop(drag_drop) = event else {
        return;
    };
    let subscriber = window.state::<DropSubscriber>();
    match drag_drop {
        DragDropEvent::Enter { .. } | DragDropEvent::Over { .. } => {
            subscriber.notify(DropNotification::DragState(DragState { active: true }));
        }
        DragDropEvent::Leave => {
            subscriber.notify(DropNotification::DragState(DragState { active: false }));
        }
        DragDropEvent::Drop { paths, .. } => {
            subscriber.notify(DropNotification::DragState(DragState { active: false }));
            let state = window.state::<Mutex<DroppedFilesState>>();
            if let Some(dropped) = register_drop(&state, paths.clone()) {
                subscriber.notify(DropNotification::FilesDropped(dropped));
            }
        }
        // `DragDropEvent` is non-exhaustive.
        _ => {}
    }
}
