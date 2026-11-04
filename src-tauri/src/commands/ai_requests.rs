//! An AI's request for write access, shown to the user by the running app. The MCP server
//! leaves the request in the app's config directory; a background thread of the app looks
//! for requests and sends each to a window, which asks the user. Only the user's answer
//! (`answer_ai_access_request`) changes the AI access list.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};

use super::app_channel::{AppNotification, AppRequestSubscriber};
use crate::application::error::ApplicationError;
use crate::application::local_state::ai_access::plain_path;
use crate::application::local_state::ai_requests::{pending_requests, remove_request};
use crate::application::local_state::constants::{
    AI_REQUEST_DENIED_COOLDOWN_SECS, AI_REQUEST_MAX_AGE_SECS, AI_REQUEST_POLL_INTERVAL_MS,
};
use crate::application::local_state::operations::LocalState;
use crate::application::project_operations::read_project_identity;
use crate::application::session::ProjectSessions;
use crate::application::window_registry::WindowRegistry;
use crate::domain::entity_id::ProjectId;

/// The user's answer to a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiRequestAnswer {
    Allow,
    /// Allowed until the app exits.
    AllowUntilAppExits,
    Deny,
}

/// What the app remembers about requests while it runs: which are on screen (so one is
/// not shown twice) and which Projects the user just refused (so an AI cannot keep asking).
#[derive(Debug, Default)]
pub struct AiRequestPrompts {
    shown: HashMap<ProjectId, Instant>,
    denied: HashMap<ProjectId, Instant>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// The folder of a Project an AI asked about: where the access list has it, or else the
/// folder a window has it open from. `None` when the app does not know where it is.
fn folder_of<R: Runtime>(app: &AppHandle<R>, project_id: &ProjectId) -> Option<PathBuf> {
    let local_state = app.try_state::<LocalState>()?;
    if let Some(entry) = local_state
        .ai_access_list()
        .ok()
        .and_then(|list| list.find(project_id).map(|entry| entry.folder.clone()))
    {
        return Some(entry);
    }
    let sessions = app.try_state::<Mutex<ProjectSessions>>()?;
    let sessions = lock(&sessions);
    sessions
        .get(project_id)
        .ok()
        .map(|session| session.root().to_path_buf())
}

/// The window to ask in: the Project's own window, or else the one used last.
fn window_for<R: Runtime>(app: &AppHandle<R>, project_id: &ProjectId) -> Option<String> {
    let registry = app.try_state::<Mutex<WindowRegistry>>()?;
    let registry = lock(&registry);
    registry
        .find_window_by_project(project_id)
        .or_else(|| registry.most_recently_focused())
        .map(str::to_owned)
}

/// One look for new requests.
fn show_new_requests<R: Runtime>(app: &AppHandle<R>) {
    let (Some(local_state), Some(prompts), Some(hub)) = (
        app.try_state::<LocalState>(),
        app.try_state::<Mutex<AiRequestPrompts>>(),
        app.try_state::<AppRequestSubscriber>(),
    ) else {
        return;
    };
    let config_dir = local_state.config_dir().to_path_buf();
    let max_age = Duration::from_secs(AI_REQUEST_MAX_AGE_SECS);
    let cooldown = Duration::from_secs(AI_REQUEST_DENIED_COOLDOWN_SECS);
    for project_id in pending_requests(&config_dir, unix_now()) {
        {
            let mut prompts = lock(&prompts);
            prompts.denied.retain(|_, at| at.elapsed() < cooldown);
            prompts.shown.retain(|_, at| at.elapsed() < max_age);
            if prompts.denied.contains_key(&project_id) {
                let _ = remove_request(&config_dir, &project_id);
                continue;
            }
            if prompts.shown.contains_key(&project_id) {
                continue;
            }
        }
        let named = folder_of(app, &project_id).and_then(|folder| {
            read_project_identity(&folder)
                .ok()
                .filter(|identity| identity.project_id == project_id)
                .map(|identity| (identity.name, folder))
        });
        // A Project the app cannot find is not shown (the AI is told to have it added).
        let Some((project_name, folder)) = named else {
            let _ = remove_request(&config_dir, &project_id);
            continue;
        };
        let Some(window_label) = window_for(app, &project_id) else {
            continue;
        };
        let notification = AppNotification::AiAccessRequested {
            project_id: project_id.to_string(),
            project_name,
            folder_display: plain_path(&folder).to_string_lossy().into_owned(),
        };
        if hub.send_untracked(&window_label, notification) {
            lock(&prompts).shown.insert(project_id, Instant::now());
        }
    }
}

/// Starts the background look for requests (the running app only; tests start no threads).
/// The prompts' state itself is managed with the other state (`configure`).
pub fn install_ai_request_watch<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(AI_REQUEST_POLL_INTERVAL_MS));
        show_new_requests(&app);
    });
}

/// The user's answer to an AI's request for write access to the Project.
#[tauri::command]
pub fn answer_ai_access_request<R: Runtime>(
    app: AppHandle<R>,
    prompts: State<'_, Mutex<AiRequestPrompts>>,
    project_id: String,
    answer: AiRequestAnswer,
) -> Result<(), ApplicationError> {
    let project_id = ProjectId::parse(&project_id)?;
    let local_state = app
        .try_state::<LocalState>()
        .ok_or_else(|| ApplicationError::entity_not_found("no local state"))?;
    {
        let mut prompts = lock(&prompts);
        prompts.shown.remove(&project_id);
        if answer == AiRequestAnswer::Deny {
            prompts.denied.insert(project_id, Instant::now());
        }
    }
    let result = match answer {
        AiRequestAnswer::Deny => Ok(()),
        AiRequestAnswer::Allow | AiRequestAnswer::AllowUntilAppExits => {
            let folder = folder_of(&app, &project_id)
                .ok_or_else(|| ApplicationError::entity_not_found("unknown Project folder"))?;
            local_state.grant_ai_write(
                project_id,
                &folder,
                answer == AiRequestAnswer::AllowUntilAppExits,
            )
        }
    };
    let _ = remove_request(local_state.config_dir(), &project_id);
    result
}
