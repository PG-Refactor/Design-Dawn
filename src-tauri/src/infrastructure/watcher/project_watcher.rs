use std::fmt;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::Instant;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::aggregator::{Aggregator, WatchBatch};
use super::constants::{AGGREGATION_MAX_DELAY, AGGREGATION_QUIET_PERIOD};
use super::filter::watched_relative_path;
use crate::infrastructure::file_format::constants::DOCUMENTS_DIRECTORY_NAME;

/// The watcher could not be started (for example the system's watch limit is reached, or the
/// file system does not support watching). The app then relies on checks at window focus.
#[derive(Debug)]
pub struct WatchStartError(String);

impl fmt::Display for WatchStartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "file watching could not be started: {}", self.0)
    }
}

impl std::error::Error for WatchStartError {}

/// What the notify callback hands to the aggregating thread.
enum WatchSignal {
    Paths(Vec<String>),
    /// Events may be lost, or the OS reported an error: a full comparison is needed.
    Rescan,
}

/// Watches one Project. Dropping it stops watching: the notify watcher goes away, which closes
/// the channel and ends the aggregating thread (nothing is joined, so dropping is safe while
/// the thread waits for a lock the dropper holds).
pub struct ProjectWatcher {
    _watcher: RecommendedWatcher,
}

impl fmt::Debug for ProjectWatcher {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProjectWatcher")
            .finish_non_exhaustive()
    }
}

fn signal_from(root: &Path, outcome: notify::Result<Event>) -> Option<WatchSignal> {
    let event = match outcome {
        Ok(event) => event,
        Err(_) => return Some(WatchSignal::Rescan),
    };
    if event.need_rescan() {
        return Some(WatchSignal::Rescan);
    }
    // Reading a file (which this app does all the time) is not a change.
    if matches!(event.kind, EventKind::Access(_)) {
        return None;
    }
    let paths: Vec<String> = event
        .paths
        .iter()
        .filter_map(|path| watched_relative_path(root, path))
        .collect();
    (!paths.is_empty()).then_some(WatchSignal::Paths(paths))
}

fn run_aggregation(
    receiver: mpsc::Receiver<WatchSignal>,
    mut on_batch: impl FnMut(WatchBatch) -> ControlFlow<()>,
) {
    let mut aggregator = Aggregator::new(AGGREGATION_QUIET_PERIOD, AGGREGATION_MAX_DELAY);
    loop {
        let received = match aggregator.next_deadline() {
            None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(deadline) => {
                receiver.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            }
        };
        match received {
            Ok(WatchSignal::Paths(paths)) => aggregator.record_paths(paths, Instant::now()),
            Ok(WatchSignal::Rescan) => aggregator.record_rescan(Instant::now()),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if let Some(batch) = aggregator.take_due(Instant::now()) {
            if on_batch(batch).is_break() {
                return;
            }
        }
    }
}

impl ProjectWatcher {
    /// Starts watching `root` (canonical): `project.json` directly in it and everything under
    /// `documents/`. Links are not followed. `on_batch` runs on the watcher's own thread, never
    /// while the watcher holds a lock; returning `Break` ends the thread.
    pub fn start(
        root: PathBuf,
        on_batch: impl FnMut(WatchBatch) -> ControlFlow<()> + Send + 'static,
    ) -> Result<Self, WatchStartError> {
        let (sender, receiver): (Sender<WatchSignal>, _) = mpsc::channel();
        let event_root = root.clone();
        let mut watcher = RecommendedWatcher::new(
            move |outcome| {
                if let Some(signal) = signal_from(&event_root, outcome) {
                    // The receiver is gone only while the watcher is being dropped.
                    let _ = sender.send(signal);
                }
            },
            Config::default().with_follow_symlinks(false),
        )
        .map_err(|error| WatchStartError(error.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::NonRecursive)
            .map_err(|error| WatchStartError(error.to_string()))?;
        watcher
            .watch(
                &root.join(DOCUMENTS_DIRECTORY_NAME),
                RecursiveMode::Recursive,
            )
            .map_err(|error| WatchStartError(error.to_string()))?;
        thread::Builder::new()
            .name("project-watcher".to_owned())
            .spawn(move || run_aggregation(receiver, on_batch))
            .map_err(|error| WatchStartError(error.to_string()))?;
        Ok(Self { _watcher: watcher })
    }
}
