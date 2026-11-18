//! Commands of the custom templates (`application::templates`). Every one is for the
//! Project the calling window has open; the three template places are resolved here (the
//! Project folder, the app's local data), so the Frontend never names a folder.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, Window};

use super::{ensure_window_project, log_failure, project_root, run_blocking};
use crate::application::asset_import::{
    import_asset_reusing_same, read_document_asset, ImportedImage,
};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::local_state::operations::LocalState;
use crate::application::open_request::OpenRequest;
use crate::application::project_operations::create_project;
use crate::application::session::ProjectSessions;
use crate::application::templates::{
    delete_template as delete, list_templates as list, move_template as relocate,
    read_template as read, rename_template as rename, replace_template, save_template as save,
    template_asset_path, TemplateContent, TemplateKind, TemplateList, TemplateRoots, TemplateScope,
    TemplateSummary, TEMPLATES_DIRECTORY_NAME,
};
use crate::infrastructure::error::PersistenceErrorKind;
use crate::infrastructure::file_format::dto::parse_dto;
use uuid::Uuid;

use super::{route_open_request, with_routing_state, PlacementSource, TauriWindowHost};

/// Under the app's local data: one folder per Project, and one for every Project.
const PROJECTS_DIRECTORY: &str = "projects";
const GLOBAL_DIRECTORY: &str = "global";

fn roots<R: Runtime>(app: &AppHandle<R>, project_id: &str) -> ApplicationResult<TemplateRoots> {
    let local = app
        .try_state::<LocalState>()
        .ok_or_else(|| ApplicationError::new(ErrorKind::InvalidTemplate, "no local state"))?
        .templates_directory();
    Ok(TemplateRoots {
        shared: Some(project_root(app, project_id)?.join(TEMPLATES_DIRECTORY_NAME)),
        project: Some(local.join(PROJECTS_DIRECTORY).join(project_id)),
        global: local.join(GLOBAL_DIRECTORY),
    })
}

/// Checks the window, resolves the places and runs `work` off the main thread (templates
/// are copied whole).
async fn with_roots<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
    window: &Window<R>,
    project_id: &str,
    work: impl FnOnce(TemplateRoots) -> ApplicationResult<T> + Send + 'static,
) -> Result<T, ApplicationError> {
    log_failure(ensure_window_project(window, project_id))?;
    let roots = log_failure(roots(app, project_id))?;
    run_blocking(move || work(roots)).await
}

#[tauri::command]
pub async fn list_templates<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<TemplateList, ApplicationError> {
    with_roots(&app, &window, &project_id, |roots| Ok(list(&roots))).await
}

#[tauri::command]
pub async fn read_template<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    scope: String,
    kind: String,
    template_id: String,
) -> Result<TemplateContent, ApplicationError> {
    let (scope, kind) = (TemplateScope::parse(&scope)?, TemplateKind::parse(&kind)?);
    with_roots(&app, &window, &project_id, move |roots| {
        read(&roots, scope, kind, &template_id)
    })
    .await
}

/// `document_id`: where the images of `content` are (its assets are copied in).
#[tauri::command]
pub async fn save_template<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    document_id: Option<String>,
    scope: String,
    kind: String,
    content: Value,
) -> Result<TemplateSummary, ApplicationError> {
    let (scope, kind) = (TemplateScope::parse(&scope)?, TemplateKind::parse(&kind)?);
    let content: TemplateContent = parse_dto(content)?;
    let app_for_assets = app.clone();
    let project = project_id.clone();
    with_roots(&app, &window, &project_id, move |roots| {
        let sessions = app_for_assets.state::<Mutex<ProjectSessions>>();
        let read_asset = |source: &str| {
            let document = document_id.as_deref().ok_or_else(|| {
                ApplicationError::new(ErrorKind::InvalidTemplate, "images need their Document")
            })?;
            read_document_asset(&sessions, &project, document, source)
        };
        save(&roots, scope, kind, &content, &read_asset)
    })
    .await
}

#[tauri::command]
pub async fn rename_template<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    scope: String,
    kind: String,
    template_id: String,
    name: String,
) -> Result<(), ApplicationError> {
    let (scope, kind) = (TemplateScope::parse(&scope)?, TemplateKind::parse(&kind)?);
    with_roots(&app, &window, &project_id, move |roots| {
        rename(&roots, scope, kind, &template_id, &name)
    })
    .await
}

#[tauri::command]
pub async fn delete_template<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    scope: String,
    kind: String,
    template_id: String,
) -> Result<(), ApplicationError> {
    let (scope, kind) = (TemplateScope::parse(&scope)?, TemplateKind::parse(&kind)?);
    with_roots(&app, &window, &project_id, move |roots| {
        delete(&roots, scope, kind, &template_id)
    })
    .await
}

#[tauri::command]
pub async fn move_template<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    scope: String,
    kind: String,
    template_id: String,
    to_scope: String,
) -> Result<(), ApplicationError> {
    let (scope, kind) = (TemplateScope::parse(&scope)?, TemplateKind::parse(&kind)?);
    let to = TemplateScope::parse(&to_scope)?;
    with_roots(&app, &window, &project_id, move |roots| {
        relocate(&roots, scope, kind, &template_id, to)
    })
    .await
}

/// One image of a template, copied into the Document's assets (validated like an import).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn import_template_asset<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    document_id: String,
    scope: String,
    kind: String,
    template_id: String,
    asset_name: String,
) -> Result<ImportedImage, ApplicationError> {
    let (scope, kind) = (TemplateScope::parse(&scope)?, TemplateKind::parse(&kind)?);
    let app_for_import = app.clone();
    let project = project_id.clone();
    with_roots(&app, &window, &project_id, move |roots| {
        let path = template_asset_path(&roots, scope, kind, &template_id, &asset_name)?;
        let sessions = app_for_import.state::<Mutex<ProjectSessions>>();
        let mut guard = sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        import_asset_reusing_same(&mut guard, &project, &document_id, &path)
    })
    .await
}

// ---- editing a template in a window of its own ----

/// A template being edited: the Project made for it (a folder in the app's local data, never
/// a Project of the user) stands for the template until it is saved back.
#[derive(Debug, Clone)]
struct TemplateEdit {
    roots: TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: String,
    name: String,
}

/// The templates being edited, by the id of the Project made for each.
#[derive(Debug, Default)]
pub struct TemplateEdits {
    by_project: HashMap<String, TemplateEdit>,
}

fn edit_of<R: Runtime>(app: &AppHandle<R>, project_id: &str) -> ApplicationResult<TemplateEdit> {
    app.state::<Mutex<TemplateEdits>>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .by_project
        .get(project_id)
        .cloned()
        .ok_or_else(|| {
            ApplicationError::new(ErrorKind::InvalidTemplate, "this Project edits no template")
        })
}

/// Where the Projects made for editing templates are kept. Emptied when the app starts:
/// none of them is in use then.
pub fn template_editing_directory(local_state: &LocalState) -> PathBuf {
    local_state
        .templates_directory()
        .with_file_name(EDITING_DIRECTORY)
}

const EDITING_DIRECTORY: &str = "template-editing";

/// What the app left from editing templates last time (a Project folder per template).
pub fn clear_template_editing(local_state: &LocalState) {
    let _ = std::fs::remove_dir_all(template_editing_directory(local_state));
}

/// Opens a new window that edits the template: a Project of its own is made in the app's
/// local data; the window fills it from the template (`template_edit_info`).
#[tauri::command]
pub async fn open_template_editor<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    scope: String,
    kind: String,
    template_id: String,
) -> Result<(), ApplicationError> {
    let (scope, kind) = (TemplateScope::parse(&scope)?, TemplateKind::parse(&kind)?);
    log_failure(ensure_window_project(&window, &project_id))?;
    let roots = log_failure(roots(&app, &project_id))?;
    let editing = app
        .try_state::<LocalState>()
        .map(|local_state| template_editing_directory(local_state.inner()))
        .ok_or_else(|| ApplicationError::new(ErrorKind::InvalidTemplate, "no local state"))?;
    let origin = window.label().to_owned();
    let worker = app.clone();
    run_blocking(move || {
        let content = read(&roots, scope, kind, &template_id)?;
        let folder = editing.join(Uuid::now_v7().to_string());
        std::fs::create_dir_all(&folder).map_err(|error| {
            ApplicationError::persistence(PersistenceErrorKind::IoError, error.to_string())
        })?;
        // A throwaway set of sessions: the window opens the Project itself.
        let mut made = ProjectSessions::default();
        let snapshot = create_project(&mut made, &folder, &content.name)?;
        worker
            .state::<Mutex<TemplateEdits>>()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .by_project
            .insert(
                snapshot.project.project_id.clone(),
                TemplateEdit {
                    roots,
                    scope,
                    kind,
                    template_id,
                    name: content.name,
                },
            );
        let host = TauriWindowHost::new(worker.clone());
        with_routing_state(&worker, |state| {
            route_open_request(
                state,
                &host,
                OpenRequest::ProjectFolder(folder),
                &PlacementSource::Origin(origin),
            )
        })
        .map(|_| ())
    })
    .await
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateEditInfo {
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: String,
    name: String,
    content: TemplateContent,
}

/// For a window: the template its Project stands for, with what it holds now; `None` for an
/// ordinary Project.
#[tauri::command]
pub async fn template_edit_info<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
) -> Result<Option<TemplateEditInfo>, ApplicationError> {
    log_failure(ensure_window_project(&window, &project_id))?;
    let Ok(edit) = edit_of(&app, &project_id) else {
        return Ok(None);
    };
    run_blocking(move || {
        let content = read(&edit.roots, edit.scope, edit.kind, &edit.template_id)?;
        Ok(Some(TemplateEditInfo {
            scope: edit.scope,
            kind: edit.kind,
            template_id: edit.template_id,
            name: edit.name,
            content,
        }))
    })
    .await
}

/// One image of the template being edited, into the editing Project's Document.
#[tauri::command]
pub async fn import_template_edit_asset<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    document_id: String,
    asset_name: String,
) -> Result<ImportedImage, ApplicationError> {
    log_failure(ensure_window_project(&window, &project_id))?;
    let edit = log_failure(edit_of(&app, &project_id))?;
    let worker = app.clone();
    run_blocking(move || {
        let path = template_asset_path(
            &edit.roots,
            edit.scope,
            edit.kind,
            &edit.template_id,
            &asset_name,
        )?;
        let sessions = worker.state::<Mutex<ProjectSessions>>();
        let mut guard = sessions.lock().unwrap_or_else(PoisonError::into_inner);
        import_asset_reusing_same(&mut guard, &project_id, &document_id, &path)
    })
    .await
}

/// Writes what the editing window holds back into the template (same id, name and place).
#[tauri::command]
pub async fn save_template_edit<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    project_id: String,
    document_id: String,
    content: Value,
) -> Result<(), ApplicationError> {
    log_failure(ensure_window_project(&window, &project_id))?;
    let edit = log_failure(edit_of(&app, &project_id))?;
    let content: TemplateContent = parse_dto(content)?;
    let worker = app.clone();
    run_blocking(move || {
        let sessions = worker.state::<Mutex<ProjectSessions>>();
        let read_asset =
            |source: &str| read_document_asset(&sessions, &project_id, &document_id, source);
        replace_template(
            &edit.roots,
            edit.scope,
            edit.kind,
            &edit.template_id,
            &content,
            &read_asset,
        )
    })
    .await
}
