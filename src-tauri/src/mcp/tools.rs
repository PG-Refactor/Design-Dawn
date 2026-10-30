//! Tool handlers. Each call reads the Project afresh (`Workspace`), does its one job through
//! the Application layer and answers with JSON. Reads never write; write tools are refused
//! unless the server was started with `--allow-write`.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::application::authoring::{
    create_listed_document, create_listed_sheet, create_text_block, delete_block, find_block,
    image_natural_size, move_block, read_text_block, rename_document, rename_sheet,
    update_text_block, BlockGeometry,
};
use crate::application::snapshot::EntityState;
use crate::infrastructure::file_format::dto::{BlockDto, SheetDto};
use crate::infrastructure::file_format::image_validation::ImageFormat;

use super::arguments::Arguments;
use super::config::{
    CONTENT_HASH_HEX_LENGTH, DEFAULT_BLOCK_GAP, DEFAULT_BLOCK_HEIGHT, DEFAULT_BLOCK_WIDTH,
    DEFAULT_BLOCK_X, DEFAULT_BLOCK_Y,
};
use super::protocol::{ToolHost, ToolOutput};
use super::tool_definitions::{self as names, tool_definitions, ToolDefinition};
use super::tool_error::{ToolError, KIND_INTERNAL, KIND_WRITE_DISABLED};
use super::workspace::{find_sheet, Workspace};

pub struct ToolContext {
    root: PathBuf,
    project_id: String,
    allow_write: bool,
    definitions: Vec<ToolDefinition>,
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

/// `z_index` counts from the back: the last Block of the Sheet is in front.
fn block_json(z_index: usize, block: &BlockDto) -> Value {
    let mut value = json!({
        "blockId": block.block_id,
        "blockType": block.block_type,
        "zIndex": z_index,
    });
    if let (Some(target), Value::Object(geometry)) = (value.as_object_mut(), geometry_json(block)) {
        target.extend(geometry);
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
            root,
            project_id: project.project.project_id,
            allow_write,
            definitions: tool_definitions(),
        })
    }

    fn workspace(&self) -> Result<Workspace, ToolError> {
        Workspace::open(&self.root, &self.project_id)
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
            names::DELETE_BLOCK => self.delete_block(&arguments),
            other => Err(ToolError::new(
                KIND_INTERNAL,
                format!("tool {other} has no handler"),
            )),
        }
    }

    fn get_project(&self) -> Result<Value, ToolError> {
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
    fn list_tools(&self) -> Vec<Value> {
        self.definitions
            .iter()
            .filter(|definition| self.allow_write || !definition.writes)
            .map(ToolDefinition::to_value)
            .collect()
    }

    fn call_tool(&self, name: &str, arguments: &Map<String, Value>) -> Option<ToolOutput> {
        let definition = self.definition(name)?;
        if definition.writes && !self.allow_write {
            return Some(ToolOutput::failure(&ToolError::new(
                KIND_WRITE_DISABLED,
                "this server is read-only; it was not started with --allow-write",
            )));
        }
        Some(match self.run(definition, arguments) {
            Ok(value) => ToolOutput::success(value),
            Err(error) => ToolOutput::failure(&error),
        })
    }
}
