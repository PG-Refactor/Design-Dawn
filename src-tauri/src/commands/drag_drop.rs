//! Window drag & drop (docs/architecture.md §6.2.2). The native event carries absolute paths,
//! which stay in Rust (`DroppedFilesState`); the Frontend is told only a `dropId` and a count,
//! and activity changes for feedback. This handler stays thin: the state logic is in
//! `application::dropped_files`.
//!
//! Tauri also forwards its own built-in drag-drop events to the webview. We do not listen to
//! them and must not rely on them: they would hand paths to the Frontend.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{DragDropEvent, Emitter, Manager, Runtime, Window, WindowEvent};

use crate::application::dropped_files::{register_drop, DragState, DroppedFilesState};

pub const FILES_DROPPED_EVENT: &str = "dawn://files-dropped";
pub const DRAG_STATE_EVENT: &str = "dawn://drag-state";

fn emit_to_window<R: Runtime, P: Serialize + Clone>(window: &Window<R>, event: &str, payload: P) {
    // A failed emit only costs UI feedback (or, for a drop, the Frontend never learns of it);
    // there is nobody to report to, so it is logged instead of panicking the event loop.
    if let Err(error) = window.app_handle().emit_to(window.label(), event, payload) {
        eprintln!("failed to emit {event}: {error}");
    }
}

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::DragDrop(drag_drop) = event else {
        return;
    };
    match drag_drop {
        DragDropEvent::Enter { .. } | DragDropEvent::Over { .. } => {
            emit_to_window(window, DRAG_STATE_EVENT, DragState { active: true });
        }
        DragDropEvent::Leave => {
            emit_to_window(window, DRAG_STATE_EVENT, DragState { active: false });
        }
        DragDropEvent::Drop { paths, .. } => {
            emit_to_window(window, DRAG_STATE_EVENT, DragState { active: false });
            let state = window.state::<Mutex<DroppedFilesState>>();
            if let Some(dropped) = register_drop(&state, paths.clone()) {
                emit_to_window(window, FILES_DROPPED_EVENT, dropped);
            }
        }
        // `DragDropEvent` is non-exhaustive.
        _ => {}
    }
}
