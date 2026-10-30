//! The real file watcher on a temporary directory, and the
//! decision a batch of events leads to. Waits are bounded polls on a channel, never fixed
//! sleeps that the test depends on for correctness.

mod support;

use std::fs;
use std::ops::ControlFlow;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use design_dawn_lib::application::block_content_operations::{
    read_block_content, write_block_content,
};
use design_dawn_lib::application::document_operations::load_document;
use design_dawn_lib::application::external_change::{confirm_batch, BatchOutcome};
use design_dawn_lib::application::project_operations::open_project;
use design_dawn_lib::application::session::{ProjectSessions, WatchGuard};
use design_dawn_lib::domain::entity_id::ProjectId;
use design_dawn_lib::infrastructure::watcher::{ProjectWatcher, WatchBatch};
use support::*;

/// Generous: the aggregation itself takes up to 2 s, and CI machines are slow.
const BATCH_WAIT: Duration = Duration::from_secs(15);
/// How long "nothing arrives" is observed for (longer than the aggregation's quiet period).
const SILENCE_WAIT: Duration = Duration::from_millis(1500);

fn start_watcher(root: &std::path::Path) -> (ProjectWatcher, Receiver<WatchBatch>) {
    let (sender, receiver) = mpsc::channel();
    let watcher = ProjectWatcher::start(root.canonicalize().unwrap(), move |batch| {
        match sender.send(batch) {
            Ok(()) => ControlFlow::Continue(()),
            Err(_) => ControlFlow::Break(()),
        }
    })
    .expect("watcher starts");
    (watcher, receiver)
}

/// Collects batches until one names `path`, or the wait runs out.
fn wait_for_path(receiver: &Receiver<WatchBatch>, path: &str) -> Option<WatchBatch> {
    let deadline = Instant::now() + BATCH_WAIT;
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match receiver.recv_timeout(remaining) {
            Ok(batch) if batch.paths.contains(path) => return Some(batch),
            Ok(_) => {}
            Err(_) => return None,
        }
    }
    None
}

fn drain_silence(receiver: &Receiver<WatchBatch>) -> Vec<WatchBatch> {
    let mut batches = Vec::new();
    while let Ok(batch) = receiver.recv_timeout(SILENCE_WAIT) {
        batches.push(batch);
    }
    batches
}

#[test]
fn an_external_write_arrives_as_one_batch_with_a_relative_path() {
    let (_temp, root) = project_copy();
    let (_watcher, receiver) = start_watcher(&root);
    let relative = format!("documents/system-design/{OVERVIEW_MARKDOWN_PATH}");

    write_text(&root.join(&relative), "# external\n");

    let batch = wait_for_path(&receiver, &relative).expect("a batch names the file");
    assert!(!batch.rescan);
    assert!(batch.paths.iter().all(|path| !path.starts_with('/')));
}

#[test]
fn temp_files_git_and_unrelated_files_never_arrive() {
    let (_temp, root) = project_copy();
    fs::create_dir(root.join(".git")).unwrap();
    let (_watcher, receiver) = start_watcher(&root);

    write_text(&root.join(".git").join("index"), "x");
    write_text(&root.join("notes.txt"), "x");
    write_text(&root.join(".gitattributes"), "x");
    write_text(&document_dir(&root).join(".document.json.dawn-tmp"), "{}");

    let batches = drain_silence(&receiver);
    assert!(
        batches
            .iter()
            .all(|batch| batch.paths.is_empty() && !batch.rescan),
        "{batches:?}"
    );
    assert!(batches.is_empty(), "{batches:?}");
}

#[test]
fn several_quick_writes_are_aggregated() {
    let (_temp, root) = project_copy();
    let (_watcher, receiver) = start_watcher(&root);
    let first = format!("documents/system-design/{OVERVIEW_MARKDOWN_PATH}");
    let second = format!("documents/system-design/{DETAILS_MARKDOWN_PATH}");

    for round in 0..5 {
        write_text(&root.join(&first), &format!("# one {round}\n"));
        write_text(&root.join(&second), &format!("# two {round}\n"));
    }

    let batch = wait_for_path(&receiver, &first).expect("a batch arrives");
    // Both files are in the first batch or the very next one: not one batch per write.
    let mut seen = batch.paths;
    if !seen.contains(&second) {
        seen.extend(
            wait_for_path(&receiver, &second)
                .expect("second file")
                .paths,
        );
    }
    assert!(seen.contains(&second));
}

#[test]
fn dropping_the_watcher_stops_it() {
    let (_temp, root) = project_copy();
    let (watcher, receiver) = start_watcher(&root);
    drop(watcher);
    write_text(
        &root.join(format!("documents/system-design/{OVERVIEW_MARKDOWN_PATH}")),
        "# after drop\n",
    );
    // The aggregating thread ends and drops its callback (and with it the sender).
    match receiver.recv_timeout(BATCH_WAIT) {
        Err(RecvTimeoutError::Disconnected) => {}
        other => panic!("expected the watcher thread to end, got {other:?}"),
    }
}

#[test]
fn starting_on_a_directory_without_documents_fails_cleanly() {
    let temp = TempDir::new();
    let result = ProjectWatcher::start(temp.path().canonicalize().unwrap(), |_| {
        ControlFlow::Continue(())
    });
    assert!(result.is_err());
}

// ---- what a batch amounts to ----

fn opened_with_text() -> (OpenedProject, Mutex<ProjectSessions>, ProjectId) {
    let (temp, root) = project_copy();
    let mut sessions = ProjectSessions::default();
    let snapshot = open_project(&mut sessions, &root).unwrap();
    load_document(&mut sessions, PROJECT_ID, DOCUMENT_ID).unwrap();
    for path in [OVERVIEW_MARKDOWN_PATH, DETAILS_MARKDOWN_PATH] {
        read_block_content(&mut sessions, PROJECT_ID, DOCUMENT_ID, path).unwrap();
    }
    let project_id = ProjectId::parse(PROJECT_ID).unwrap();
    let opened = OpenedProject {
        temp,
        root,
        sessions: ProjectSessions::default(),
        snapshot,
    };
    (opened, Mutex::new(sessions), project_id)
}

fn batch_of(paths: &[&str], rescan: bool) -> WatchBatch {
    WatchBatch {
        paths: paths.iter().map(|path| (*path).to_owned()).collect(),
        rescan,
    }
}

#[test]
fn the_apps_own_save_is_quiet_and_an_external_edit_is_reported() {
    let (opened, sessions, project_id) = opened_with_text();
    let generation = opened.snapshot.session_generation;
    let relative = format!("documents/system-design/{OVERVIEW_MARKDOWN_PATH}");

    write_block_content(
        &mut sessions.lock().unwrap(),
        PROJECT_ID,
        DOCUMENT_ID,
        OVERVIEW_MARKDOWN_PATH,
        "# saved by the app\n",
    )
    .unwrap();
    let own = confirm_batch(
        &sessions,
        &project_id,
        generation,
        &batch_of(&[&relative], false),
    );
    assert_eq!(own, BatchOutcome::Quiet);

    write_text(&opened.root.join(&relative), "# external\n");
    let external = confirm_batch(
        &sessions,
        &project_id,
        generation,
        &batch_of(&[&relative], false),
    );
    let BatchOutcome::Report(changes) = external else {
        panic!("expected a report, got {external:?}");
    };
    assert_eq!(changes.session_generation, generation);
    assert!(!changes.rescan);
    assert_eq!(changes.documents[0].files[0].path, OVERVIEW_MARKDOWN_PATH);
}

#[test]
fn events_for_untracked_files_and_a_rescan_are_reported_without_changes() {
    let (opened, sessions, project_id) = opened_with_text();
    let generation = opened.snapshot.session_generation;

    let untracked = confirm_batch(
        &sessions,
        &project_id,
        generation,
        &batch_of(&["documents/system-design/assets/new.png"], false),
    );
    assert!(matches!(&untracked, BatchOutcome::Report(changes) if changes.is_empty()));

    let rescan = confirm_batch(&sessions, &project_id, generation, &batch_of(&[], true));
    assert!(
        matches!(&rescan, BatchOutcome::Report(changes) if changes.rescan && changes.is_empty())
    );
}

#[test]
fn a_batch_for_a_replaced_or_closed_session_stops_the_watcher() {
    let (opened, sessions, project_id) = opened_with_text();
    let generation = opened.snapshot.session_generation;

    let replaced = confirm_batch(&sessions, &project_id, generation + 1, &batch_of(&[], true));
    assert_eq!(replaced, BatchOutcome::Stop);

    let other = ProjectId::parse(UNKNOWN_ID).unwrap();
    assert_eq!(
        confirm_batch(&sessions, &other, generation, &batch_of(&[], true)),
        BatchOutcome::Stop
    );
}

// ---- the session owns its watcher ----

#[test]
fn the_session_hook_starts_a_watcher_that_stops_with_the_session() {
    let (_temp, root) = project_copy();
    let (sender, receiver) = mpsc::channel::<WatchBatch>();
    let sender = Arc::new(Mutex::new(sender));
    let mut sessions = ProjectSessions::default();
    sessions.set_insert_hook(Box::new(move |session| {
        let sender = sender.lock().unwrap().clone();
        let watcher =
            ProjectWatcher::start(session.root().to_path_buf(), move |batch| {
                match sender.send(batch) {
                    Ok(()) => ControlFlow::Continue(()),
                    Err(_) => ControlFlow::Break(()),
                }
            })
            .expect("watcher starts");
        session.set_watch_guard(Some(WatchGuard::new(watcher)));
    }));
    open_project(&mut sessions, &root).unwrap();
    assert!(sessions
        .get(&ProjectId::parse(PROJECT_ID).unwrap())
        .unwrap()
        .is_watched());

    let relative = format!("documents/system-design/{OVERVIEW_MARKDOWN_PATH}");
    write_text(&root.join(&relative), "# external\n");
    assert!(wait_for_path(&receiver, &relative).is_some());

    // Removing the session drops its watcher; the thread ends and the channel closes.
    sessions.remove(&ProjectId::parse(PROJECT_ID).unwrap());
    drop(sessions);
    let deadline = Instant::now() + BATCH_WAIT;
    loop {
        match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => panic!("the watcher outlived its session"),
            Ok(_) => {}
        }
    }
}

// ---- the whole path: watcher -> confirmation -> window notification ----

use design_dawn_lib::application::external_change::ExternalChanges;
use design_dawn_lib::commands::{AppNotification, AppNotificationSink, AppRequestHub};

#[derive(Clone, Default)]
struct RecordingSink {
    received: Arc<Mutex<Vec<AppNotification>>>,
}

impl AppNotificationSink for RecordingSink {
    fn send_notification(&self, notification: AppNotification) -> Result<(), String> {
        self.received.lock().unwrap().push(notification);
        Ok(())
    }
}

fn wait_for_notification(
    sink: &RecordingSink,
    matches: impl Fn(&ExternalChanges) -> bool,
) -> Option<ExternalChanges> {
    let deadline = Instant::now() + BATCH_WAIT;
    while Instant::now() < deadline {
        let found =
            sink.received
                .lock()
                .unwrap()
                .iter()
                .find_map(|notification| match notification {
                    AppNotification::ProjectFilesChanged { changes, .. } if matches(changes) => {
                        Some(changes.clone())
                    }
                    _ => None,
                });
        if found.is_some() {
            return found;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

#[test]
fn an_external_edit_reaches_the_window_and_the_apps_own_save_does_not() {
    let (_temp, root) = project_copy();
    let sessions = Arc::new(Mutex::new(ProjectSessions::default()));
    let sink = RecordingSink::default();
    let hub = Arc::new(AppRequestHub::<RecordingSink>::default());
    hub.subscribe("main", sink.clone());
    let project_id = ProjectId::parse(PROJECT_ID).unwrap();

    {
        let sessions_for_watcher = Arc::clone(&sessions);
        let hub_for_watcher = Arc::clone(&hub);
        sessions
            .lock()
            .unwrap()
            .set_insert_hook(Box::new(move |session| {
                let generation = session.generation();
                let sessions = Arc::clone(&sessions_for_watcher);
                let hub = Arc::clone(&hub_for_watcher);
                let watcher = ProjectWatcher::start(session.root().to_path_buf(), move |batch| {
                    match confirm_batch(&sessions, &project_id, generation, &batch) {
                        BatchOutcome::Stop => ControlFlow::Break(()),
                        BatchOutcome::Quiet => ControlFlow::Continue(()),
                        BatchOutcome::Report(changes) => {
                            hub.send_project_files_changed("main", &project_id, changes);
                            ControlFlow::Continue(())
                        }
                    }
                })
                .expect("watcher starts");
                session.set_watch_guard(Some(WatchGuard::new(watcher)));
            }));
    }
    {
        let mut guard = sessions.lock().unwrap();
        open_project(&mut guard, &root).unwrap();
        load_document(&mut guard, PROJECT_ID, DOCUMENT_ID).unwrap();
        read_block_content(&mut guard, PROJECT_ID, DOCUMENT_ID, OVERVIEW_MARKDOWN_PATH).unwrap();
        // The app's own save: no notification may come of it.
        write_block_content(
            &mut guard,
            PROJECT_ID,
            DOCUMENT_ID,
            OVERVIEW_MARKDOWN_PATH,
            "# saved by the app\n",
        )
        .unwrap();
    }
    std::thread::sleep(SILENCE_WAIT);
    assert!(sink.received.lock().unwrap().is_empty());

    let file = root.join(format!("documents/system-design/{OVERVIEW_MARKDOWN_PATH}"));
    write_text(&file, "# external\n");

    let changes = wait_for_notification(&sink, |changes| !changes.documents.is_empty())
        .expect("the edit is reported");
    assert!(changes.watching);
    assert_eq!(changes.documents[0].document_id, DOCUMENT_ID);
    assert_eq!(changes.documents[0].files[0].path, OVERVIEW_MARKDOWN_PATH);
    let serialized = serde_json::to_string(&changes).unwrap();
    assert!(!serialized.contains(&root.to_string_lossy().into_owned()));
}
