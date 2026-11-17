//! Commands of the custom templates (`application::templates`). Every one is for the
//! Project the calling window has open; the three template places are resolved here (the
//! Project folder, the app's local data), so the Frontend never names a folder.

use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, Window};

use super::{ensure_window_project, log_failure, project_root, run_blocking};
use crate::application::asset_import::{import_asset, read_document_asset, ImportedImage};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::local_state::operations::LocalState;
use crate::application::session::ProjectSessions;
use crate::application::templates::{
    delete_template as delete, list_templates as list, move_template as relocate,
    read_template as read, rename_template as rename, save_template as save, template_asset_path,
    TemplateContent, TemplateKind, TemplateList, TemplateRoots, TemplateScope, TemplateSummary,
    TEMPLATES_DIRECTORY_NAME,
};
use crate::infrastructure::file_format::dto::parse_dto;

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
        import_asset(&mut guard, &project, &document_id, &path)
    })
    .await
}
