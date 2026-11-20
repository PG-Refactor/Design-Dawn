//! Tool handlers. Each call reads the Project afresh (`Workspace`), does its one job through
//! the Application layer and answers with JSON. Reads never write.
//!
//! Which Project a call works on: the Project the AI chose with selectProject, or else the
//! one used last in the app, among the Projects of the AI access list in the app's settings
//! folder; a Project is writable when it is allowed there. The list is shared with the app
//! and read on every call, so a change made in the app applies at once. addProject and
//! setWriteAccess change it from here: the user approves those calls in the AI client, as
//! any other tool call, and each is kept in the Project's AI history for the app to show.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde_json::{json, Map, Value};

use crate::application::asset_import::import_asset_reusing_same;
use crate::application::authoring::{
    create_image_block, create_listed_document, create_listed_sheet, create_text_block,
    delete_block, find_block, image_natural_size, move_block, read_text_block, rename_document,
    rename_sheet, set_block_caption, update_text_block, BlockGeometry,
};
use crate::application::export_markdown::document_markdown;
use crate::application::local_state::ai_access::{listed_project_name, AiAccessList};
use crate::application::local_state::ai_history::{append as append_ai_history, AiHistoryEntry};
use crate::application::local_state::constants::APP_IDENTIFIER;
use crate::application::project_operations::read_project_identity;
use crate::application::project_search::{search_project, SearchQuery};
use crate::application::templates::{
    list_templates, read_template, template_asset_path, TemplateBlockContent, TemplateKind,
    TemplateRoots, TemplateScope, TEMPLATES_DIRECTORY_NAME,
};
use crate::domain::constants::{ASSETS_DIRECTORY_NAME, PATH_SEPARATOR};

/// Under the app's local data, as the app keeps the user's own templates.
const TEMPLATE_PROJECTS_DIRECTORY: &str = "projects";
const TEMPLATE_GLOBAL_DIRECTORY: &str = "global";

/// Image references in `exportMarkdown` point at the Document's own assets folder.
const EXPORT_ASSETS_PREFIX: &str = "assets/";
use crate::application::snapshot::EntityState;
use crate::domain::caption::CaptionPosition;
use crate::domain::entity_id::ProjectId;
use crate::domain::error::DomainErrorKind;
use crate::infrastructure::file_format::dto::{BlockDto, SheetDto};
use crate::infrastructure::file_format::image_validation::ImageFormat;

use super::arguments::Arguments;
use super::config::{
    APP_MODE_INSTRUCTIONS, BLOCK_MAX_HEIGHT, BLOCK_MAX_WIDTH, BLOCK_MIN_HEIGHT, BLOCK_MIN_WIDTH,
    CONTENT_HASH_HEX_LENGTH, DEFAULT_BLOCK_GAP, DEFAULT_BLOCK_HEIGHT, DEFAULT_BLOCK_WIDTH,
    DEFAULT_BLOCK_X, DEFAULT_BLOCK_Y,
};
use super::protocol::{ToolHost, ToolOutput};
use super::tool_definitions::{self as names, tool_definitions, ToolDefinition};
use super::tool_error::{
    ToolError, KIND_ACCESS_LIST_UNREADABLE, KIND_INTERNAL, KIND_NO_PROJECT,
    KIND_PROJECT_NOT_LISTED, KIND_WRITE_DISABLED,
};
use super::workspace::{find_sheet, Workspace};

pub struct ToolContext {
    /// The app's settings folder: the AI access list and the AI history are there.
    config_dir: PathBuf,
    /// The Project chosen with selectProject; `None` follows the app.
    selected: Mutex<Option<ProjectId>>,
    definitions: Vec<ToolDefinition>,
}

/// The Project one call works on.
struct Resolved {
    root: PathBuf,
    project_id: String,
    allow_write: bool,
}

fn entity_state(state: EntityState) -> Value {
    serde_json::to_value(state).unwrap_or(Value::Null)
}

fn geometry_json(block: &BlockDto) -> Value {
    json!({
        "position": { "x": block.position.x, "y": block.position.y },
        "size": { "width": block.size.width, "height": block.size.height },
    })
}

/// `z_index` counts from the back: the last Block of the Sheet is in front. A figure's
/// caption is included when it has one (the position defaults to below, as in the file).
fn block_json(z_index: usize, block: &BlockDto) -> Value {
    let mut value = json!({
        "blockId": block.block_id,
        "blockType": block.block_type,
        "zIndex": z_index,
    });
    if let (Some(target), Value::Object(geometry)) = (value.as_object_mut(), geometry_json(block)) {
        target.extend(geometry);
        if let Some(caption) = &block.caption {
            target.insert("caption".to_owned(), json!(caption));
            target.insert(
                "captionPosition".to_owned(),
                json!(block
                    .caption_position
                    .as_deref()
                    .unwrap_or(CaptionPosition::Below.as_str())),
            );
        }
    }
    value
}

fn is_content_hash(text: &str) -> bool {
    text.len() == CONTENT_HASH_HEX_LENGTH
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Refuses a size outside what the app lets anyone make (stricter bounds than the file
/// format's). Refused rather than enlarged, so the AI is not left with a size it did
/// not ask for.
fn check_block_size(size: Option<(i64, i64)>) -> Result<(), ToolError> {
    match size {
        Some((width, height))
            if !(BLOCK_MIN_WIDTH..=BLOCK_MAX_WIDTH).contains(&width)
                || !(BLOCK_MIN_HEIGHT..=BLOCK_MAX_HEIGHT).contains(&height) =>
        {
            Err(ToolError::new(
                DomainErrorKind::InvalidSize.as_str(),
                format!(
                    "a Block must be {BLOCK_MIN_WIDTH} x {BLOCK_MIN_HEIGHT} to \
{BLOCK_MAX_WIDTH} x {BLOCK_MAX_HEIGHT} (width x height); got {width} x {height}"
                ),
            ))
        }
        _ => Ok(()),
    }
}

/// Below the lowest Block, so a new Block does not cover an existing one.
fn default_block_geometry(sheet: &SheetDto) -> BlockGeometry {
    let lowest_bottom = sheet
        .blocks
        .iter()
        .filter_map(|block| {
            let top = block.position.y.as_i64()?;
            let height = block.size.height.as_i64()?;
            Some(top.saturating_add(height))
        })
        .max();
    BlockGeometry {
        x: DEFAULT_BLOCK_X,
        y: lowest_bottom.map_or(DEFAULT_BLOCK_Y, |bottom| {
            bottom.saturating_add(DEFAULT_BLOCK_GAP)
        }),
        width: DEFAULT_BLOCK_WIDTH,
        height: DEFAULT_BLOCK_HEIGHT,
    }
}

impl ToolContext {
    /// Works with the app whose settings are in `config_dir`. Nothing is read yet: the app
    /// may not have been started, and every call reads the list afresh.
    pub fn new(config_dir: &Path) -> Self {
        Self {
            config_dir: config_dir.to_path_buf(),
            selected: Mutex::new(None),
            definitions: tool_definitions(),
        }
    }

    pub fn instructions(&self) -> &'static str {
        APP_MODE_INSTRUCTIONS
    }

    fn access_list(config_dir: &Path) -> Result<AiAccessList, ToolError> {
        AiAccessList::read(config_dir).map_err(|_| access_list_unreadable())
    }

    fn selected(selected: &Mutex<Option<ProjectId>>) -> Option<ProjectId> {
        *selected.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn resolve(&self) -> Result<Resolved, ToolError> {
        let list = Self::access_list(&self.config_dir)?;
        let chosen = Self::selected(&self.selected);
        let project_id = chosen.or(list.current_project_id).ok_or_else(no_project)?;
        let entry = list.find(&project_id).ok_or_else(|| {
            ToolError::new(
                KIND_PROJECT_NOT_LISTED,
                if chosen.is_some() {
                    "the Project is no longer offered to AI; call listProjects and selectProject"
                } else {
                    "the Project open in Design Dawn is not offered to AI; call addProject with \
its folder (the user approves it in the AI client), or listProjects and selectProject for \
another one"
                },
            )
        })?;
        Ok(Resolved {
            root: entry.folder.clone(),
            project_id: project_id.to_string(),
            allow_write: entry.allow_write,
        })
    }

    fn workspace(&self) -> Result<Workspace, ToolError> {
        let resolved = self.resolve()?;
        Workspace::open(&resolved.root, &resolved.project_id)
    }

    fn definition(&self, name: &str) -> Option<&ToolDefinition> {
        self.definitions
            .iter()
            .find(|definition| definition.name == name)
    }

    fn run(
        &self,
        definition: &ToolDefinition,
        arguments: &Map<String, Value>,
    ) -> Result<Value, ToolError> {
        let arguments = Arguments::new(arguments, definition)?;
        // The text an update replaces, read first so the user can undo it from the app.
        let before = (definition.name == names::UPDATE_BLOCK)
            .then(|| self.block_text(&arguments).ok())
            .flatten();
        let result = self.dispatch(definition, &arguments);
        if definition.writes || definition.changes_access {
            if let Ok(value) = &result {
                self.record_history(definition.name, &arguments, before, value);
            }
        }
        result
    }

    /// The current text of the Block the arguments name.
    fn block_text(&self, arguments: &Arguments) -> Result<String, ToolError> {
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let block = find_block(sheet, arguments.string("blockId")?)?;
        Ok(read_text_block(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            block,
        )?
        .text)
    }

    /// Adds the change to the Project's AI history in the app's settings folder; a failure to
    /// record is reported on stderr and does not undo the change. A change of access names
    /// its Project in the result (addProject's Project may not be the one in use).
    fn record_history(
        &self,
        tool: &str,
        arguments: &Arguments,
        before: Option<String>,
        result: &Value,
    ) {
        let named = result
            .get("projectId")
            .and_then(Value::as_str)
            .and_then(|text| ProjectId::parse(text).ok());
        let Some(project_id) = named.or_else(|| {
            self.resolve()
                .ok()
                .and_then(|resolved| ProjectId::parse(&resolved.project_id).ok())
        }) else {
            return;
        };
        let text = |key: &str| {
            arguments
                .optional_string(key)
                .ok()
                .flatten()
                .map(str::to_owned)
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        let entry = AiHistoryEntry {
            at: now,
            tool: tool.to_owned(),
            document_id: text("documentId").or_else(|| {
                result
                    .get("documentId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
            sheet_id: text("sheetId").or_else(|| {
                result
                    .get("sheetId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
            block_id: text("blockId").or_else(|| {
                result
                    .get("blockId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
            before,
            after: text("text").or_else(|| {
                // What access became, or the image file an importImage added.
                result
                    .get("writable")
                    .and_then(Value::as_bool)
                    .map(|writable| writable.to_string())
                    .or_else(|| {
                        result
                            .get("contentPath")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
            }),
            after_hash: result
                .get("contentHash")
                .and_then(Value::as_str)
                .map(str::to_owned),
        };
        if let Err(error) = append_ai_history(&self.config_dir, &project_id, entry) {
            eprintln!(
                "design-dawn-mcp: could not record the AI history: {}",
                error.detail
            );
        }
    }

    fn dispatch(
        &self,
        definition: &ToolDefinition,
        arguments: &Arguments,
    ) -> Result<Value, ToolError> {
        match definition.name {
            names::LIST_PROJECTS => self.list_projects(),
            names::SELECT_PROJECT => self.select_project(arguments),
            names::ADD_PROJECT => self.add_project(arguments),
            names::SET_WRITE_ACCESS => self.set_write_access(arguments),
            names::GET_PROJECT => self.get_project(),
            names::GET_DOCUMENT => self.get_document(arguments),
            names::GET_SHEET => self.get_sheet(arguments),
            names::GET_BLOCK => self.get_block(arguments),
            names::SEARCH_PROJECT => self.search_project(arguments),
            names::EXPORT_MARKDOWN => self.export_markdown(arguments),
            names::CREATE_DOCUMENT => self.create_document(arguments),
            names::CREATE_SHEET => self.create_sheet(arguments),
            names::CREATE_BLOCK => self.create_block(arguments),
            names::UPDATE_DOCUMENT => self.update_document(arguments),
            names::UPDATE_SHEET => self.update_sheet(arguments),
            names::UPDATE_BLOCK => self.update_block(arguments),
            names::MOVE_BLOCK => self.move_block(arguments),
            names::UPDATE_BLOCK_CAPTION => self.update_block_caption(arguments),
            names::DELETE_BLOCK => self.delete_block(arguments),
            names::IMPORT_IMAGE => self.import_image(arguments),
            names::LIST_TEMPLATES => self.list_templates(),
            names::CREATE_FROM_TEMPLATE => self.create_from_template(arguments),
            other => Err(ToolError::new(
                KIND_INTERNAL,
                format!("tool {other} has no handler"),
            )),
        }
    }

    fn list_projects(&self) -> Result<Value, ToolError> {
        let list = Self::access_list(&self.config_dir)?;
        let selected = Self::selected(&self.selected);
        let in_use = selected.or(list.current_project_id);
        let projects: Vec<Value> = list
            .projects
            .iter()
            .map(|entry| {
                let name = listed_project_name(entry);
                json!({
                    "projectId": entry.project_id.to_string(),
                    "name": name,
                    // The folder's own name tells apart two Projects with the same name,
                    // without handing the AI a path.
                    "folderName": entry.folder.file_name().map(|name| name.to_string_lossy()),
                    "available": name.is_some(),
                    "openInApp": list.current_project_id == Some(entry.project_id),
                    "inUse": in_use == Some(entry.project_id),
                    "writable": entry.allow_write,
                })
            })
            .collect();
        Ok(json!({
            "projects": projects,
            "selectedProjectId": selected.map(|id| id.to_string()),
        }))
    }

    fn select_project(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let selected = &self.selected;
        let Some(project_id) = arguments.optional_string("projectId")? else {
            *selected.lock().unwrap_or_else(PoisonError::into_inner) = None;
            return Ok(json!({ "selectedProjectId": null, "followsApp": true }));
        };
        let project_id = ProjectId::parse(project_id)?;
        let list = Self::access_list(&self.config_dir)?;
        let entry = list.find(&project_id).ok_or_else(|| {
            ToolError::new(
                KIND_PROJECT_NOT_LISTED,
                "this Project is not offered to AI; use a projectId from listProjects, or \
addProject with its folder",
            )
        })?;
        // Checked now, so a Project that moved away fails here rather than on the next call.
        Workspace::open(&entry.folder, &project_id.to_string())?;
        *selected.lock().unwrap_or_else(PoisonError::into_inner) = Some(project_id);
        Ok(json!({
            "selectedProjectId": project_id.to_string(),
            "name": listed_project_name(entry),
            "writable": entry.allow_write,
            "followsApp": false,
        }))
    }

    /// Offers the Project in `folder` to AI (read-only; setWriteAccess allows changes), as
    /// the app's AI integration screen does. Already offered: nothing changes.
    fn add_project(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let folder = PathBuf::from(arguments.string("folder")?);
        if !folder.is_absolute() {
            return Err(ToolError::invalid_arguments(
                "folder must be an absolute path of a Project folder (the one holding \
project.json)",
            ));
        }
        let identity = read_project_identity(&folder)?;
        let folder = std::fs::canonicalize(&folder).map_err(|error| {
            ToolError::from(crate::infrastructure::error::PersistenceError::from_io(
                "resolve project folder",
                &error,
            ))
        })?;
        let project_id = identity.project_id;
        let (added, writable) = AiAccessList::update_file(&self.config_dir, |list| {
            let added = list.find(&project_id).is_none();
            list.add(project_id, &folder);
            Ok((
                added,
                list.find(&project_id)
                    .is_some_and(|entry| entry.allow_write),
            ))
        })
        .map_err(|_| access_list_unreadable())?;
        Ok(json!({
            "projectId": project_id.to_string(),
            "name": identity.name,
            "added": added,
            "writable": writable,
        }))
    }

    /// Allows or stops AI changes to an offered Project (the one in use, or projectId).
    fn set_write_access(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let writable = arguments
            .optional_bool("writable")?
            .ok_or_else(|| ToolError::invalid_arguments("writable is required"))?;
        let project_id = match arguments.optional_string("projectId")? {
            Some(text) => ProjectId::parse(text)?,
            None => ProjectId::parse(&self.resolve()?.project_id)?,
        };
        let listed = AiAccessList::update_file(&self.config_dir, |list| {
            if list.find(&project_id).is_none() {
                return Ok(false);
            }
            list.set_allow_write(&project_id, writable)?;
            Ok(true)
        })
        .map_err(|_| access_list_unreadable())?;
        if !listed {
            return Err(ToolError::new(
                KIND_PROJECT_NOT_LISTED,
                "this Project is not offered to AI; call addProject with its folder first",
            ));
        }
        Ok(json!({ "projectId": project_id.to_string(), "writable": writable }))
    }

    /// Copies an image file of this computer into the Document's assets and shows it in a
    /// new Image Block, as dropping the file on the Sheet does.
    fn import_image(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let path = PathBuf::from(arguments.string("path")?);
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !path.is_absolute()
            || !path.is_file()
            || ImageFormat::from_file_name(&file_name).is_none()
        {
            return Err(ToolError::invalid_arguments(
                "path must be an absolute path of an existing PNG, JPEG, WebP, SVG or GIF file",
            ));
        }
        let caption = arguments.optional_string("caption")?;
        let mut workspace = self.workspace()?;
        let document_id = arguments.string("documentId")?;
        let sheet_id = arguments.string("sheetId")?;
        let document = workspace.load_document(document_id)?;
        let defaults = default_block_geometry(find_sheet(&document, sheet_id)?);
        let (x, y) = arguments
            .optional_pair("position", "x", "y")?
            .unwrap_or((defaults.x, defaults.y));
        let document_id = document.document.document_id.clone();
        // The same file again (an AI retrying) uses the copy made the first time.
        let image = import_asset_reusing_same(
            &mut workspace.sessions,
            &workspace.project_id,
            &document_id,
            &path,
        )?;
        let sheet = find_sheet(&workspace.load_document(&document_id)?, sheet_id)?.clone();
        let mut block = create_image_block(
            &mut workspace.sessions,
            &workspace.project_id,
            &document_id,
            &sheet,
            &image.content_path,
            BlockGeometry {
                x,
                y,
                width: i64::from(image.initial_width),
                height: i64::from(image.initial_height),
            },
        )?;
        if let Some(caption) = caption.filter(|caption| !caption.is_empty()) {
            let sheet = find_sheet(&workspace.load_document(&document_id)?, sheet_id)?.clone();
            block = set_block_caption(
                &mut workspace.sessions,
                &workspace.project_id,
                &document_id,
                &sheet,
                &block.block_id,
                Some(caption),
                None,
            )?;
        }
        let mut value = block_json(sheet.blocks.len(), &block);
        if let Some(target) = value.as_object_mut() {
            target.insert("documentId".to_owned(), json!(document_id));
            target.insert("sheetId".to_owned(), json!(sheet.sheet_id));
            target.insert("contentPath".to_owned(), json!(image.content_path));
        }
        Ok(value)
    }

    fn get_project(&self) -> Result<Value, ToolError> {
        let writable = self.resolve()?.allow_write;
        let workspace = self.workspace()?;
        let project = &workspace.project;
        let folders: Vec<Value> = project
            .folders
            .iter()
            .map(|folder| {
                json!({
                    "folderId": folder.folder_id,
                    "name": folder.name,
                    "parentFolderId": folder.parent_folder_id,
                    "childOrder": folder.child_order,
                    "state": entity_state(folder.state),
                })
            })
            .collect();
        let documents: Vec<Value> = project
            .documents
            .iter()
            .map(|document| {
                json!({
                    "documentId": document.document_id,
                    "name": document.name,
                    "folderId": document.parent_folder_id,
                    "state": entity_state(document.state),
                })
            })
            .collect();
        Ok(json!({
            "projectId": project.project.project_id,
            "name": project.project.name,
            "childOrder": project.project.child_order,
            "folders": folders,
            "documents": documents,
            "issues": project.issues,
            "writable": writable,
        }))
    }

    fn get_document(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let folder_id = workspace
            .project
            .documents
            .iter()
            .find(|entry| entry.document_id == document.document.document_id)
            .and_then(|entry| entry.parent_folder_id.clone());
        let sheets: Vec<Value> = document
            .sheets
            .iter()
            .map(|sheet| {
                json!({
                    "sheetId": sheet.sheet_id,
                    "name": sheet.name,
                    "state": entity_state(sheet.state),
                })
            })
            .collect();
        Ok(json!({
            "documentId": document.document.document_id,
            "name": document.document.name,
            "folderId": folder_id,
            "sheets": sheets,
            "issues": document.issues,
        }))
    }

    fn get_sheet(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let blocks: Vec<Value> = sheet
            .blocks
            .iter()
            .enumerate()
            .map(|(z_index, block)| block_json(z_index, block))
            .collect();
        Ok(json!({
            "documentId": document.document.document_id,
            "sheetId": sheet.sheet_id,
            "name": sheet.name,
            "blocks": blocks,
        }))
    }

    fn search_project(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let resolved = self.resolve()?;
        let result = search_project(
            &resolved.root,
            SearchQuery {
                text: arguments.string("query")?.to_owned(),
                match_case: arguments.optional_bool("matchCase")?.unwrap_or(false),
                regex: arguments.optional_bool("regex")?.unwrap_or(false),
            },
        )?;
        Ok(serde_json::to_value(result).unwrap_or(Value::Null))
    }

    fn export_markdown(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let resolved = self.resolve()?;
        let exported = document_markdown(
            &resolved.root,
            arguments.string("documentId")?,
            EXPORT_ASSETS_PREFIX,
        )?;
        Ok(json!({ "markdown": exported.text }))
    }

    fn get_block(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let document_id = document.document.document_id.clone();
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let block = find_block(sheet, arguments.string("blockId")?)?;
        let z_index = sheet
            .blocks
            .iter()
            .position(|candidate| candidate.block_id == block.block_id)
            .unwrap_or_default();
        let mut value = block_json(z_index, block);
        let details = if block.block_type == "image" {
            let file_name = block
                .content_path
                .rsplit('/')
                .next()
                .unwrap_or(&block.content_path);
            let format = ImageFormat::from_file_name(file_name)
                .and_then(|format| format.definition().extensions.first().copied());
            let size = image_natural_size(
                &mut workspace.sessions,
                &workspace.project_id,
                &document_id,
                block,
            );
            json!({
                "image": {
                    "fileName": file_name,
                    "format": format,
                    "width": size.map(|(width, _)| width),
                    "height": size.map(|(_, height)| height),
                },
            })
        } else {
            let content = read_text_block(
                &mut workspace.sessions,
                &workspace.project_id,
                &document_id,
                block,
            )?;
            json!({ "text": content.text, "contentHash": content.content_hash })
        };
        if let (Some(target), Value::Object(details)) = (value.as_object_mut(), details) {
            target.extend(details);
        }
        Ok(value)
    }

    fn create_document(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let name = arguments.string("name")?;
        let folder_id = arguments.optional_string("folderId")?;
        let mut workspace = self.workspace()?;
        let created = create_listed_document(
            &mut workspace.sessions,
            &workspace.project_id,
            &workspace.project,
            name,
            folder_id,
        )?;
        Ok(json!({
            "documentId": created.document.document_id,
            "name": created.document.name,
            "folderId": folder_id,
        }))
    }

    fn create_sheet(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let name = arguments.string("name")?;
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let created = create_listed_sheet(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document,
            name,
        )?;
        Ok(json!({
            "documentId": document.document.document_id,
            "sheetId": created.sheet_id,
            "name": created.name,
        }))
    }

    fn create_block(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let block_type = arguments.string("type")?;
        let text = arguments.string("text")?;
        let position = arguments.optional_pair("position", "x", "y")?;
        let size = arguments.optional_pair("size", "width", "height")?;
        check_block_size(size)?;
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let defaults = default_block_geometry(sheet);
        let geometry = BlockGeometry {
            x: position.map_or(defaults.x, |(x, _)| x),
            y: position.map_or(defaults.y, |(_, y)| y),
            width: size.map_or(defaults.width, |(width, _)| width),
            height: size.map_or(defaults.height, |(_, height)| height),
        };
        let block = create_text_block(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            sheet,
            block_type,
            text,
            geometry,
        )?;
        let content = read_text_block(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            &block,
        )?;
        let mut value = block_json(sheet.blocks.len(), &block);
        if let Some(target) = value.as_object_mut() {
            target.insert("contentHash".to_owned(), json!(content.content_hash));
        }
        Ok(value)
    }

    /// The three places of the templates for the Project in use (`application::templates`).
    fn template_roots(&self) -> Result<(TemplateRoots, Workspace), ToolError> {
        let resolved = self.resolve()?;
        let workspace = Workspace::open(&resolved.root, &resolved.project_id)?;
        let root = resolved.root;
        let local = dirs::data_local_dir()
            .map(|base| base.join(APP_IDENTIFIER).join(TEMPLATES_DIRECTORY_NAME));
        let roots = TemplateRoots {
            shared: Some(root.join(TEMPLATES_DIRECTORY_NAME)),
            project: local.as_ref().map(|local| {
                local
                    .join(TEMPLATE_PROJECTS_DIRECTORY)
                    .join(&workspace.project_id)
            }),
            global: local.map_or_else(
                // Without a data folder there are no personal templates: a folder that does not
                // exist lists nothing.
                || {
                    root.join(TEMPLATES_DIRECTORY_NAME)
                        .join(TEMPLATE_GLOBAL_DIRECTORY)
                },
                |local| local.join(TEMPLATE_GLOBAL_DIRECTORY),
            ),
        };
        Ok((roots, workspace))
    }

    fn list_templates(&self) -> Result<Value, ToolError> {
        let (roots, _) = self.template_roots()?;
        let listed = list_templates(&roots);
        Ok(json!({
            "templates": listed.templates,
            "unreadable": listed.issues.len(),
        }))
    }

    /// Text Blocks of a template onto a Sheet, one after another (each saves the Sheet).
    /// Returns the new blockIds and how many image Blocks were left out.
    /// Copies the template's images into the Document (an identical image of the same
    /// name there is used as it is), by their name in the template. The texts that show
    /// an image renamed on the way (a different file had the name) are rewritten.
    fn import_template_images(
        &self,
        workspace: &mut Workspace,
        source: &TemplateSource<'_>,
        document_id: &str,
        names: impl IntoIterator<Item = String>,
    ) -> Result<BTreeMap<String, String>, ToolError> {
        let mut imported = BTreeMap::new();
        for name in names {
            if imported.contains_key(&name) {
                continue;
            }
            let path = template_asset_path(
                source.roots,
                source.scope,
                source.kind,
                source.template_id,
                &name,
            )?;
            let image = import_asset_reusing_same(
                &mut workspace.sessions,
                &workspace.project_id,
                document_id,
                &path,
            )?;
            imported.insert(name, image.content_path);
        }
        Ok(imported)
    }

    fn place_template_blocks(
        &self,
        workspace: &mut Workspace,
        document_id: &str,
        sheet_id: &str,
        blocks: &[TemplateBlockContent],
        images: &BTreeMap<String, String>,
        offset: (i64, i64),
    ) -> Result<Vec<String>, ToolError> {
        let mut created = Vec::new();
        for block in blocks {
            let document = workspace.load_document(document_id)?;
            let sheet = find_sheet(&document, sheet_id)?.clone();
            let geometry = BlockGeometry {
                x: block.x + offset.0,
                y: block.y + offset.1,
                width: i64::from(block.width),
                height: i64::from(block.height),
            };
            let made = match (block.text.as_deref(), block.asset.as_deref()) {
                (Some(text), _) => create_text_block(
                    &mut workspace.sessions,
                    &workspace.project_id,
                    document_id,
                    &sheet,
                    &block.block_type,
                    &rewritten_image_paths(text, images),
                    geometry,
                )?,
                (None, Some(asset)) => {
                    let Some(content_path) = images.get(asset) else {
                        continue;
                    };
                    create_image_block(
                        &mut workspace.sessions,
                        &workspace.project_id,
                        document_id,
                        &sheet,
                        content_path,
                        geometry,
                    )?
                }
                (None, None) => continue,
            };
            if let Some(caption) = block.caption.as_deref() {
                let document = workspace.load_document(document_id)?;
                let sheet = find_sheet(&document, sheet_id)?.clone();
                let position = block
                    .caption_position
                    .as_deref()
                    .and_then(|value| CaptionPosition::parse(value).ok());
                set_block_caption(
                    &mut workspace.sessions,
                    &workspace.project_id,
                    document_id,
                    &sheet,
                    &made.block_id,
                    Some(caption),
                    position,
                )?;
            }
            created.push(made.block_id);
        }
        Ok(created)
    }

    fn create_from_template(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let scope = TemplateScope::parse(arguments.string("scope")?)?;
        let kind = TemplateKind::parse(arguments.string("kind")?)?;
        let template_id = arguments.string("templateId")?;
        let name = arguments.optional_string("name")?;
        let (roots, mut workspace) = self.template_roots()?;
        let content = read_template(&roots, scope, kind, template_id)?;
        let source = TemplateSource {
            roots: &roots,
            scope,
            kind,
            template_id,
        };
        // The images the blocks show and the ones their texts name, once per Document.
        let image_names = |blocks: &[&TemplateBlockContent]| -> Vec<String> {
            blocks
                .iter()
                .filter_map(|block| block.asset.clone())
                .chain(content.assets.iter().cloned())
                .collect()
        };
        match kind {
            TemplateKind::Markdown | TemplateKind::Mermaid => {
                let block = content.block.clone().ok_or_else(|| {
                    ToolError::new(KIND_INTERNAL, "the template holds no Block".to_owned())
                })?;
                let document_id = arguments.string("documentId")?.to_owned();
                let sheet_id = arguments.string("sheetId")?.to_owned();
                let document = workspace.load_document(&document_id)?;
                let defaults = default_block_geometry(find_sheet(&document, &sheet_id)?);
                let (x, y) = arguments
                    .optional_pair("position", "x", "y")?
                    .unwrap_or((defaults.x, defaults.y));
                let images = self.import_template_images(
                    &mut workspace,
                    &source,
                    &document_id,
                    image_names(&[&block]),
                )?;
                let blocks = self.place_template_blocks(
                    &mut workspace,
                    &document_id,
                    &sheet_id,
                    &[block],
                    &images,
                    (x, y),
                )?;
                Ok(json!({ "documentId": document_id, "sheetId": sheet_id, "blockIds": blocks }))
            }
            TemplateKind::Sheet => {
                let sheet = content.sheets.first().cloned().ok_or_else(|| {
                    ToolError::new(KIND_INTERNAL, "the template holds no Sheet".to_owned())
                })?;
                let document_id = arguments.string("documentId")?.to_owned();
                let document = workspace.load_document(&document_id)?;
                let created = create_listed_sheet(
                    &mut workspace.sessions,
                    &workspace.project_id,
                    &document.document,
                    name.unwrap_or(&sheet.sheet_name),
                )?;
                let images = self.import_template_images(
                    &mut workspace,
                    &source,
                    &document_id,
                    image_names(&sheet.blocks.iter().collect::<Vec<_>>()),
                )?;
                let blocks = self.place_template_blocks(
                    &mut workspace,
                    &document_id,
                    &created.sheet_id,
                    &sheet.blocks,
                    &images,
                    (0, 0),
                )?;
                Ok(json!({
                    "documentId": document_id,
                    "sheetId": created.sheet_id,
                    "blockIds": blocks,
                }))
            }
            TemplateKind::Document => {
                let document_name = name
                    .map(str::to_owned)
                    .or(content.document_name.clone())
                    .unwrap_or_else(|| content.name.clone());
                let created = create_listed_document(
                    &mut workspace.sessions,
                    &workspace.project_id,
                    &workspace.project,
                    &document_name,
                    arguments.optional_string("folderId")?,
                )?;
                let document_id = created.document.document_id.clone();
                let images = self.import_template_images(
                    &mut workspace,
                    &source,
                    &document_id,
                    image_names(
                        &content
                            .sheets
                            .iter()
                            .flat_map(|sheet| sheet.blocks.iter())
                            .collect::<Vec<_>>(),
                    ),
                )?;
                let mut sheets = Vec::new();
                for sheet in &content.sheets {
                    let document = workspace.load_document(&document_id)?;
                    let made = create_listed_sheet(
                        &mut workspace.sessions,
                        &workspace.project_id,
                        &document.document,
                        &sheet.sheet_name,
                    )?;
                    let blocks = self.place_template_blocks(
                        &mut workspace,
                        &document_id,
                        &made.sheet_id,
                        &sheet.blocks,
                        &images,
                        (0, 0),
                    )?;
                    sheets.push(json!({ "sheetId": made.sheet_id, "blockIds": blocks }));
                }
                Ok(json!({
                    "documentId": document_id,
                    "name": document_name,
                    "sheets": sheets,
                }))
            }
        }
    }

    fn update_document(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let name = arguments.string("name")?;
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let renamed = rename_document(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document,
            name,
        )?;
        Ok(json!({ "documentId": renamed.document_id, "name": renamed.name }))
    }

    fn update_sheet(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let name = arguments.string("name")?;
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let renamed = rename_sheet(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            sheet,
            name,
        )?;
        Ok(json!({
            "documentId": document.document.document_id,
            "sheetId": renamed.sheet_id,
            "name": renamed.name,
        }))
    }

    fn update_block(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let text = arguments.string("text")?;
        let expected_hash = arguments.string("expectedContentHash")?;
        if !is_content_hash(expected_hash) {
            return Err(ToolError::invalid_arguments(
                "expectedContentHash must be a contentHash returned by getBlock",
            ));
        }
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let block_id = arguments.string("blockId")?;
        let written = update_text_block(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            sheet,
            block_id,
            text,
            expected_hash,
        )?;
        Ok(json!({
            "blockId": find_block(sheet, block_id)?.block_id,
            "contentHash": written.content_hash,
            "written": written.written,
        }))
    }

    fn move_block(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let position = arguments.pair("position", "x", "y")?;
        let size = arguments.optional_pair("size", "width", "height")?;
        check_block_size(size)?;
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let moved = move_block(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            sheet,
            arguments.string("blockId")?,
            position,
            size,
        )?;
        let z_index = sheet
            .blocks
            .iter()
            .position(|candidate| candidate.block_id == moved.block_id)
            .unwrap_or_default();
        Ok(block_json(z_index, &moved))
    }

    fn update_block_caption(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let caption = arguments.string("caption")?;
        let position = arguments
            .optional_string("position")?
            .map(CaptionPosition::parse)
            .transpose()?;
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let changed = set_block_caption(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            sheet,
            arguments.string("blockId")?,
            // An empty caption is how the app removes one too.
            (!caption.is_empty()).then_some(caption),
            position,
        )?;
        let z_index = sheet
            .blocks
            .iter()
            .position(|candidate| candidate.block_id == changed.block_id)
            .unwrap_or_default();
        Ok(block_json(z_index, &changed))
    }

    fn delete_block(&self, arguments: &Arguments) -> Result<Value, ToolError> {
        let mut workspace = self.workspace()?;
        let document = workspace.load_document(arguments.string("documentId")?)?;
        let sheet = find_sheet(&document, arguments.string("sheetId")?)?;
        let block_id = arguments.string("blockId")?;
        let removal = delete_block(
            &mut workspace.sessions,
            &workspace.project_id,
            &document.document.document_id,
            sheet,
            block_id,
        )?;
        Ok(json!({
            "blockId": find_block(sheet, block_id)?.block_id,
            "deleted": true,
            "contentFileRemoved": removal.content_file_removed,
        }))
    }
}

impl ToolHost for ToolContext {
    fn instructions(&self) -> &'static str {
        ToolContext::instructions(self)
    }

    fn list_tools(&self) -> Vec<Value> {
        // Write permission is per Project and can change while the session runs, so every
        // tool is listed and a write is refused when it is not allowed.
        self.definitions
            .iter()
            .map(ToolDefinition::to_value)
            .collect()
    }

    fn call_tool(&self, name: &str, arguments: &Map<String, Value>) -> Option<ToolOutput> {
        let definition = self.definition(name)?;
        if definition.writes {
            match self.resolve() {
                Ok(resolved) if resolved.allow_write => {}
                Ok(_) => return Some(ToolOutput::failure(&write_disabled())),
                Err(error) => return Some(ToolOutput::failure(&error)),
            }
        }
        Some(match self.run(definition, arguments) {
            Ok(value) => ToolOutput::success(value),
            Err(error) => ToolOutput::failure(&error),
        })
    }
}

fn write_disabled() -> ToolError {
    ToolError::new(
        KIND_WRITE_DISABLED,
        "this Project is read-only for AI; call setWriteAccess with writable true (the user \
approves that call in the AI client), or ask the user to allow it in Design Dawn",
    )
}

fn access_list_unreadable() -> ToolError {
    ToolError::new(
        KIND_ACCESS_LIST_UNREADABLE,
        "the list of Projects offered to AI cannot be read; open Design Dawn's AI integration \
screen to check it",
    )
}

fn no_project() -> ToolError {
    ToolError::new(
        KIND_NO_PROJECT,
        "no Project is chosen: none was selected and Design Dawn has not opened one yet; call \
listProjects and selectProject",
    )
}

/// The template a `createFromTemplate` call reads its images from.
struct TemplateSource<'a> {
    roots: &'a TemplateRoots,
    scope: TemplateScope,
    kind: TemplateKind,
    template_id: &'a str,
}

/// A text with the images renamed on import shown under their new name, as the app does:
/// `assets/<name in the template>` becomes the image's contentPath in the Document.
fn rewritten_image_paths(text: &str, images: &BTreeMap<String, String>) -> String {
    images
        .iter()
        .filter(|(name, content_path)| {
            content_path.as_str() != format!("{ASSETS_DIRECTORY_NAME}{PATH_SEPARATOR}{name}")
        })
        .fold(text.to_owned(), |rewritten, (name, content_path)| {
            rewritten.replace(
                &format!("{ASSETS_DIRECTORY_NAME}{PATH_SEPARATOR}{name}"),
                content_path,
            )
        })
}
