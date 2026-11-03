//! Starts a file watcher for every Project session and forwards what it finds to the windows
//! that have the Project. The watcher lives in the session
//! (`WatchGuard`), so closing, replacing or dropping the session stops it. All decisions are in
//! `application::external_change`; this only wires them to Tauri state.

use std::ops::ControlFlow;
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager, Runtime};

use super::app_channel::AppRequestSubscriber;
use crate::application::external_change::{confirm_batch, BatchOutcome};
use crate::application::session::{ProjectSession, ProjectSessions, WatchGuard};
use crate::application::window_registry::WindowRegistry;
use crate::domain::entity_id::ProjectId;
use crate::infrastructure::watcher::{ProjectWatcher, WatchBatch};

fn forward_batch<R: Runtime>(
    app: &AppHandle<R>,
    project_id: &ProjectId,
    generation: u64,
    batch: &WatchBatch,
) -> ControlFlow<()> {
    let sessions = app.state::<Mutex<ProjectSessions>>();
    match confirm_batch(&sessions, project_id, generation, batch) {
        BatchOutcome::Stop => ControlFlow::Break(()),
        BatchOutcome::Quiet => ControlFlow::Continue(()),
        BatchOutcome::Report(changes) => {
            // The sessions lock is released: locks are never nested here (registry, then hub).
            // Every window of the Project hears it: the Project window and the Document
            // windows each check the files of what they show.
            let labels: Vec<String> = {
                let registry = app.state::<Mutex<WindowRegistry>>();
                let registry = registry.lock().unwrap_or_else(PoisonError::into_inner);
                registry
                    .windows_of_project(project_id)
                    .into_iter()
                    .map(|(label, _)| label)
                    .collect()
            };
            let hub = app.state::<AppRequestSubscriber>();
            for label in labels {
                hub.send_project_files_changed(&label, project_id, changes.clone());
            }
            ControlFlow::Continue(())
        }
    }
}

/// Makes every session registered from now on start its watcher. A watcher that cannot start
/// is logged and the session runs unwatched (`ExternalChanges.watching` tells the Frontend).
pub fn install_external_change_watching<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    let hook = move |session: &mut ProjectSession| {
        let project_id = *session.project_id();
        let generation = session.generation();
        let watcher_handle = handle.clone();
        let started = ProjectWatcher::start(session.root().to_path_buf(), move |batch| {
            forward_batch(&watcher_handle, &project_id, generation, &batch)
        });
        match started {
            Ok(watcher) => session.set_watch_guard(Some(WatchGuard::new(watcher))),
            Err(error) => eprintln!("{error}"),
        }
    };
    app.state::<Mutex<ProjectSessions>>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .set_insert_hook(Box::new(hook));
}
