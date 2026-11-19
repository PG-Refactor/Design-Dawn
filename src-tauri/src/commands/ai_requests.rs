//! An AI's request for write access, shown to the user by the running app. The MCP server
//! leaves the request in the app's config directory; a background thread of the app looks
//! for requests and sends each to a window, which asks the user. Only the user's answer
//! (`answer_ai_access_request`) changes the AI access list.

use crate::application::local_state::ai_history::{append as append_ai_history, AiHistoryEntry};
use crate::application::local_state::ai_requests::record_denial;
use crate::mcp::tool_definitions::REQUEST_IMAGE_IMPORT;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};

use super::app_channel::{AppNotification, AppRequestSubscriber};
use crate::application::asset_import::{image_file_data_url, import_asset, ImportedImage};
use crate::application::error::{ApplicationError, ErrorKind};
use crate::application::local_state::ai_access::plain_path;
use crate::application::local_state::ai_image_requests::{
    peek_image_request, pending_image_requests, take_image_request,
};
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
    /// Image requests on screen, by request id.
    shown_images: HashMap<String, Instant>,
}

/// What to do with a request that is waiting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptDecision {
    /// Ask the user.
    Show,
    /// It is on screen already.
    Wait,
    /// The user just said no to this Project: the request is dropped.
    Drop,
}

impl AiRequestPrompts {
    pub fn decide(&mut self, project_id: &ProjectId, now: Instant) -> PromptDecision {
        let max_age = Duration::from_secs(AI_REQUEST_MAX_AGE_SECS);
        let cooldown = Duration::from_secs(AI_REQUEST_DENIED_COOLDOWN_SECS);
        // A question that was shown long ago (and never answered, e.g. its window closed)
        // may be asked again; a "no" holds for the cooldown.
        self.shown
            .retain(|_, at| now.saturating_duration_since(*at) < max_age);
        self.denied
            .retain(|_, at| now.saturating_duration_since(*at) < cooldown);
        if self.denied.contains_key(project_id) {
            PromptDecision::Drop
        } else if self.shown.contains_key(project_id) {
            PromptDecision::Wait
        } else {
            PromptDecision::Show
        }
    }

    pub fn shown(&mut self, project_id: ProjectId, now: Instant) {
        self.shown.insert(project_id, now);
    }

    pub fn answered(&mut self, project_id: &ProjectId, answer: AiRequestAnswer, now: Instant) {
        self.shown.remove(project_id);
        if answer == AiRequestAnswer::Deny {
            self.denied.insert(*project_id, now);
        }
    }
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
    for project_id in pending_requests(&config_dir, unix_now()) {
        match lock(&prompts).decide(&project_id, Instant::now()) {
            PromptDecision::Show => {}
            PromptDecision::Wait => continue,
            PromptDecision::Drop => {
                let _ = remove_request(&config_dir, &project_id);
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
            lock(&prompts).shown(project_id, Instant::now());
        }
    }
}

/// One look for new requests to add an image.
fn show_new_image_requests<R: Runtime>(app: &AppHandle<R>) {
    let (Some(local_state), Some(prompts), Some(hub)) = (
        app.try_state::<LocalState>(),
        app.try_state::<Mutex<AiRequestPrompts>>(),
        app.try_state::<AppRequestSubscriber>(),
    ) else {
        return;
    };
    let config_dir = local_state.config_dir().to_path_buf();
    let max_age = Duration::from_secs(AI_REQUEST_MAX_AGE_SECS);
    lock(&prompts)
        .shown_images
        .retain(|_, at| at.elapsed() < max_age);
    for (request_id, request) in pending_image_requests(&config_dir, unix_now()) {
        if lock(&prompts).shown_images.contains_key(&request_id) {
            continue;
        }
        let Ok(project_id) = ProjectId::parse(&request.project_id) else {
            continue;
        };
        let Some(window_label) = window_for(app, &project_id) else {
            continue;
        };
        let notification = AppNotification::AiImageRequested {
            request_id: request_id.clone(),
            project_id: request.project_id.clone(),
            document_id: request.document_id.clone(),
            sheet_id: request.sheet_id.clone(),
            file_name: request
                .path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            x: request.x,
            y: request.y,
            caption: request.caption.clone(),
        };
        if hub.send_untracked(&window_label, notification) {
            lock(&prompts)
                .shown_images
                .insert(request_id, Instant::now());
        }
    }
}

/// The picture an AI asks to add, read and validated like a dropped image.
#[tauri::command]
pub async fn ai_image_request_preview<R: Runtime>(
    app: AppHandle<R>,
    request_id: String,
) -> Result<String, ApplicationError> {
    tauri::async_runtime::spawn_blocking(move || {
        let config_dir = config_dir_of(&app)?;
        let request = peek_image_request(&config_dir, &request_id)
            .ok_or_else(|| ApplicationError::entity_not_found("the request is gone"))?;
        image_file_data_url(&request.path)
    })
    .await
    .map_err(|error| ApplicationError::new(ErrorKind::DialogFailed, error.to_string()))?
}

/// The user's answer to an image request. "Allow" imports the file into the Document's
/// assets (the Document must be open in this window) and returns the imported image for
/// the window to place; the request is gone either way.
#[tauri::command]
pub async fn answer_ai_image_request<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    request_id: String,
    allow: bool,
) -> Result<Option<ImportedImage>, ApplicationError> {
    let window_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let config_dir = config_dir_of(&app)?;
        let request = take_image_request(&config_dir, &request_id)
            .ok_or_else(|| ApplicationError::entity_not_found("the request is gone"))?;
        if let Some(prompts) = app.try_state::<Mutex<AiRequestPrompts>>() {
            lock(&prompts).shown_images.remove(&request_id);
        }
        if !allow {
            return Ok(None);
        }
        let project_id = ProjectId::parse(&request.project_id)?;
        let registry = app.state::<Mutex<WindowRegistry>>();
        if lock(&registry).find_window_by_project(&project_id) != Some(window_label.as_str()) {
            return Err(ApplicationError::entity_not_found(
                "the Project is not open in this window",
            ));
        }
        let sessions = app.state::<Mutex<ProjectSessions>>();
        let mut sessions = lock(&sessions);
        let imported = import_asset(
            &mut sessions,
            &request.project_id,
            &request.document_id,
            &request.path,
        )?;
        // In the AI's history like its other changes. A failure to record is reported and
        // does not undo the import.
        let entry = AiHistoryEntry {
            at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_secs())
                .unwrap_or_default(),
            tool: REQUEST_IMAGE_IMPORT.to_owned(),
            document_id: Some(request.document_id.clone()),
            sheet_id: Some(request.sheet_id.clone()),
            block_id: None,
            before: None,
            after: Some(imported.content_path.clone()),
            after_hash: None,
        };
        if let Err(error) = append_ai_history(&config_dir, &project_id, entry) {
            eprintln!("failed to record the AI history: {error}");
        }
        Ok(Some(imported))
    })
    .await
    .map_err(|error| ApplicationError::new(ErrorKind::DialogFailed, error.to_string()))?
}

fn config_dir_of<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, ApplicationError> {
    app.try_state::<LocalState>()
        .map(|local_state| local_state.config_dir().to_path_buf())
        .ok_or_else(|| ApplicationError::new(ErrorKind::DialogFailed, "no settings folder"))
}

/// Starts the background look for requests (the running app only; tests start no threads).
/// The prompts' state itself is managed with the other state (`configure`).
pub fn install_ai_request_watch<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(AI_REQUEST_POLL_INTERVAL_MS));
        show_new_requests(&app);
        show_new_image_requests(&app);
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
    lock(&prompts).answered(&project_id, answer, Instant::now());
    let result = match answer {
        // Noted for the MCP server, so the AI is told rather than left waiting. A failure
        // to note it only costs that.
        AiRequestAnswer::Deny => {
            if let Err(error) = record_denial(local_state.config_dir(), &project_id, unix_now()) {
                eprintln!("failed to note the refusal for the AI: {error}");
            }
            Ok(())
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: &str = "01928f3a-0000-7000-8000-000000000001";

    #[test]
    fn a_request_is_shown_once_and_asked_again_only_after_it_got_old() {
        let project = ProjectId::parse(PROJECT).unwrap();
        let start = Instant::now();
        let mut prompts = AiRequestPrompts::default();
        assert_eq!(prompts.decide(&project, start), PromptDecision::Show);
        prompts.shown(project, start);
        let max_age = Duration::from_secs(AI_REQUEST_MAX_AGE_SECS);
        assert_eq!(
            prompts.decide(&project, start + max_age - Duration::from_millis(1)),
            PromptDecision::Wait
        );
        assert_eq!(
            prompts.decide(&project, start + max_age),
            PromptDecision::Show
        );
    }

    #[test]
    fn a_no_drops_requests_for_the_cooldown_and_not_longer() {
        let project = ProjectId::parse(PROJECT).unwrap();
        let start = Instant::now();
        let mut prompts = AiRequestPrompts::default();
        prompts.shown(project, start);
        prompts.answered(&project, AiRequestAnswer::Deny, start);
        let cooldown = Duration::from_secs(AI_REQUEST_DENIED_COOLDOWN_SECS);
        assert_eq!(prompts.decide(&project, start), PromptDecision::Drop);
        assert_eq!(
            prompts.decide(&project, start + cooldown - Duration::from_millis(1)),
            PromptDecision::Drop
        );
        assert_eq!(
            prompts.decide(&project, start + cooldown),
            PromptDecision::Show
        );

        // An allowed request does not hold anything back.
        prompts.shown(project, start + cooldown);
        prompts.answered(&project, AiRequestAnswer::Allow, start + cooldown);
        assert_eq!(
            prompts.decide(&project, start + cooldown),
            PromptDecision::Show
        );
    }
}
