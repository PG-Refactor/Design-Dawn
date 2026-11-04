//! Tool handlers. Each call reads the Project afresh (`Workspace`), does its one job through
//! the Application layer and answers with JSON. Reads never write.
//!
//! Which Project a call works on: with `--project`, always that one, writable only with
//! `--allow-write`. Otherwise the server follows the app: the Project the AI chose with
//! selectProject, or else the one used last in the app, among the Projects the app lists in
//! its AI access list; a Project is writable when the user allowed it there. The list is
//! read on every call, so a change made in the app applies at once.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde_json::{json, Map, Value};

use crate::application::authoring::{
    create_listed_document, create_listed_sheet, create_text_block, delete_block, find_block,
    image_natural_size, move_block, read_text_block, rename_document, rename_sheet,
    set_block_caption, update_text_block, BlockGeometry,
};
use crate::application::local_state::ai_access::{listed_project_name, AiAccessList};
use crate::application::snapshot::EntityState;
use crate::domain::caption::CaptionPosition;
use crate::domain::entity_id::ProjectId;
use crate::infrastructure::file_format::dto::{BlockDto, SheetDto};
use crate::infrastructure::file_format::image_validation::ImageFormat;

use super::arguments::Arguments;
use super::config::{
    APP_MODE_INSTRUCTIONS, CONTENT_HASH_HEX_LENGTH, DEFAULT_BLOCK_GAP, DEFAULT_BLOCK_HEIGHT,
    DEFAULT_BLOCK_WIDTH, DEFAULT_BLOCK_X, DEFAULT_BLOCK_Y, FIXED_PROJECT_INSTRUCTIONS,
};
use super::protocol::{ToolHost, ToolOutput};
use super::tool_definitions::{self as names, tool_definitions, ToolDefinition};
use super::tool_error::{
    ToolError, KIND_ACCESS_LIST_UNREADABLE, KIND_INTERNAL, KIND_NO_PROJECT,
    KIND_PROJECT_NOT_LISTED, KIND_WRITE_DISABLED,
};
use super::workspace::{find_sheet, Workspace};

pub struct ToolContext {
    target: Target,
    definitions: Vec<ToolDefinition>,
}

enum Target {
    /// `--project`: one Project for the whole session.
    Fixed {
        root: PathBuf,
        project_id: String,
        allow_write: bool,
    },
    /// No `--project`: the Projects of the app's AI access list in `config_dir`.
    FollowApp {
        config_dir: PathBuf,
        /// The Project chosen with selectProject; `None` follows the app.
        selected: Mutex<Option<ProjectId>>,
    },
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
    /// Reads the Project once, so a wrong folder fails at start-up, and remembers its ID:
    /// every later call checks the folder still holds the same Project.
    pub fn open(root: &Path, allow_write: bool) -> Result<Self, ToolError> {
        let root = std::fs::canonicalize(root).map_err(|error| {
            ToolError::from(crate::infrastructure::error::PersistenceError::from_io(
                "resolve project folder",
                &error,
            ))
        })?;
        let mut sessions = crate::application::session::ProjectSessions::default();
        let project = crate::application::project_operations::open_project(&mut sessions, &root)?;
        Ok(Self {
            target: Target::Fixed {
                root,
                project_id: project.project.project_id,
                allow_write,
            },
            definitions: tool_definitions(),
        })
    }

    /// Follows the app whose settings are in `config_dir`. Nothing is read yet: the app may
    /// not have been started, and every call reads the list afresh.
    pub fn follow_app(config_dir: &Path) -> Self {
        Self {
            target: Target::FollowApp {
                config_dir: config_dir.to_path_buf(),
                selected: Mutex::new(None),
            },
            definitions: tool_definitions(),
        }
    }

    pub fn instructions(&self) -> &'static str {
        match self.target {
            Target::Fixed { .. } => FIXED_PROJECT_INSTRUCTIONS,
            Target::FollowApp { .. } => APP_MODE_INSTRUCTIONS,
        }
    }

    fn follows_app(&self) -> bool {
        matches!(self.target, Target::FollowApp { .. })
    }

    fn access_list(config_dir: &Path) -> Result<AiAccessList, ToolError> {
        AiAccessList::read(config_dir).map_err(|_| {
            ToolError::new(
                KIND_ACCESS_LIST_UNREADABLE,
                "the list of Projects that Design Dawn offers to AI cannot be read; open \
Design Dawn's AI integration screen to check it",
            )
        })
    }

    fn selected(selected: &Mutex<Option<ProjectId>>) -> Option<ProjectId> {
        *selected.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn resolve(&self) -> Result<Resolved, ToolError> {
        match &self.target {
            Target::Fixed {
                root,
                project_id,
                allow_write,
            } => Ok(Resolved {
                root: root.clone(),
                project_id: project_id.clone(),
                allow_write: *allow_write,
            }),
            Target::FollowApp {
                config_dir,
                selected,
            } => {
                let list = Self::access_list(config_dir)?;
                let project_id = Self::selected(selected)
                    .or(list.current_project_id)
                    .ok_or_else(|| {
                        ToolError::new(
                            KIND_NO_PROJECT,
                            "no Project is chosen: none was selected and Design Dawn has not \
opened one yet; call listProjects and selectProject",
                        )
                    })?;
                let entry = list.find(&project_id).ok_or_else(|| {
                    ToolError::new(
                        KIND_PROJECT_NOT_LISTED,
                        "the Project is no longer offered to AI by Design Dawn; call \
listProjects and selectProject",
                    )
                })?;
                Ok(Resolved {
                    root: entry.folder.clone(),
                    project_id: project_id.to_string(),
                    allow_write: entry.allow_write,
                })
            }
        }
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
        match definition.name {
            names::LIST_PROJECTS => self.list_projects(),
            names::SELECT_PROJECT => self.select_project(&arguments),
            names::GET_PROJECT => self.get_project(),
            names::GET_DOCUMENT => self.get_document(&arguments),
            names::GET_SHEET => self.get_sheet(&arguments),
            names::GET_BLOCK => self.get_block(&arguments),
            names::CREATE_DOCUMENT => self.create_document(&arguments),
            names::CREATE_SHEET => self.create_sheet(&arguments),
            names::CREATE_BLOCK => self.create_block(&arguments),
            names::UPDATE_DOCUMENT => self.update_document(&arguments),
            names::UPDATE_SHEET => self.update_sheet(&arguments),
            names::UPDATE_BLOCK => self.update_block(&arguments),
            names::MOVE_BLOCK => self.move_block(&arguments),
            names::UPDATE_BLOCK_CAPTION => self.update_block_caption(&arguments),
            names::DELETE_BLOCK => self.delete_block(&arguments),
            other => Err(ToolError::new(
                KIND_INTERNAL,
                format!("tool {other} has no handler"),
            )),
        }
    }

    fn list_projects(&self) -> Result<Value, ToolError> {
        let Target::FollowApp {
            config_dir,
            selected,
        } = &self.target
        else {
            return Err(fixed_project_only());
        };
        let list = Self::access_list(config_dir)?;
        let selected = Self::selected(selected);
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
        let Target::FollowApp {
            config_dir,
            selected,
        } = &self.target
        else {
            return Err(fixed_project_only());
        };
        let Some(project_id) = arguments.optional_string("projectId")? else {
            *selected.lock().unwrap_or_else(PoisonError::into_inner) = None;
            return Ok(json!({ "selectedProjectId": null, "followsApp": true }));
        };
        let project_id = ProjectId::parse(project_id)?;
        let list = Self::access_list(config_dir)?;
        let entry = list.find(&project_id).ok_or_else(|| {
            ToolError::new(
                KIND_PROJECT_NOT_LISTED,
                "Design Dawn does not offer this Project to AI; use a projectId from \
listProjects",
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
        self.definitions
            .iter()
            .filter(|definition| match &self.target {
                // The session's permission is fixed, so a tool it can never use is hidden.
                Target::Fixed { allow_write, .. } => {
                    !definition.project_choice && (*allow_write || !definition.writes)
                }
                // Write permission is per Project and can change while the session runs, so
                // every tool is listed and a write is refused when it is not allowed.
                Target::FollowApp { .. } => true,
            })
            .map(ToolDefinition::to_value)
            .collect()
    }

    fn call_tool(&self, name: &str, arguments: &Map<String, Value>) -> Option<ToolOutput> {
        let definition = self.definition(name)?;
        if definition.project_choice && !self.follows_app() {
            return None;
        }
        if definition.writes {
            match self.resolve() {
                Ok(resolved) if resolved.allow_write => {}
                Ok(_) => return Some(ToolOutput::failure(&write_disabled(self.follows_app()))),
                Err(error) => return Some(ToolOutput::failure(&error)),
            }
        }
        Some(match self.run(definition, arguments) {
            Ok(value) => ToolOutput::success(value),
            Err(error) => ToolOutput::failure(&error),
        })
    }
}

fn write_disabled(follows_app: bool) -> ToolError {
    ToolError::new(
        KIND_WRITE_DISABLED,
        if follows_app {
            "this Project is read-only for AI; the user can allow changes in Design Dawn's AI \
integration screen"
        } else {
            "this server is read-only; it was not started with --allow-write"
        },
    )
}

fn fixed_project_only() -> ToolError {
    ToolError::new(
        KIND_INTERNAL,
        "this server was started for one Project with --project",
    )
}
