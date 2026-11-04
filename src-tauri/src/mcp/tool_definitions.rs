//! The tool list: names, descriptions and JSON Schema of the inputs. The handlers are in
//! `tools.rs`; the argument names used there must match the properties declared here, which
//! `Arguments` enforces by refusing any key not declared.

use serde_json::{json, Map, Value};

pub const LIST_PROJECTS: &str = "listProjects";
pub const SELECT_PROJECT: &str = "selectProject";
pub const GET_PROJECT: &str = "getProject";
pub const GET_DOCUMENT: &str = "getDocument";
pub const GET_SHEET: &str = "getSheet";
pub const GET_BLOCK: &str = "getBlock";
pub const CREATE_DOCUMENT: &str = "createDocument";
pub const CREATE_SHEET: &str = "createSheet";
pub const CREATE_BLOCK: &str = "createBlock";
pub const UPDATE_DOCUMENT: &str = "updateDocument";
pub const UPDATE_SHEET: &str = "updateSheet";
pub const UPDATE_BLOCK: &str = "updateBlock";
pub const MOVE_BLOCK: &str = "moveBlock";
pub const UPDATE_BLOCK_CAPTION: &str = "updateBlockCaption";
pub const DELETE_BLOCK: &str = "deleteBlock";

/// Where a caption can be shown, as `updateBlockCaption` takes it.
pub const CAPTION_POSITIONS: [&str; 2] = ["below", "above"];

/// Block types a tool can create from text. Images are not offered: they would need the
/// server to read an arbitrary file.
pub const CREATABLE_BLOCK_TYPES: [&str; 2] = ["markdown", "mermaid"];

#[derive(Debug, Clone)]
pub struct Property {
    pub name: &'static str,
    pub schema: Value,
    pub required: bool,
}

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: &'static str,
    pub description: &'static str,
    /// Write tools are refused unless the Project may be changed (`--allow-write`, or the
    /// app's per-Project permission).
    pub writes: bool,
    /// Choosing the Project: offered only when the server follows the app (no `--project`).
    pub project_choice: bool,
    /// Whether the call replaces or removes something that cannot be brought back by the tool.
    pub destructive: bool,
    pub properties: Vec<Property>,
}

impl ToolDefinition {
    pub fn property_names(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.properties.iter().map(|property| property.name)
    }

    pub fn to_value(&self) -> Value {
        let mut properties = Map::new();
        for property in &self.properties {
            properties.insert(property.name.to_owned(), property.schema.clone());
        }
        let required: Vec<&str> = self
            .properties
            .iter()
            .filter(|property| property.required)
            .map(|property| property.name)
            .collect();
        let mut annotations = json!({ "readOnlyHint": !self.writes, "openWorldHint": false });
        if self.writes {
            annotations["destructiveHint"] = json!(self.destructive);
        }
        json!({
            "name": self.name,
            "description": self.description,
            "inputSchema": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": false,
            },
            "annotations": annotations,
        })
    }
}

fn property(name: &'static str, required: bool, schema: Value) -> Property {
    Property {
        name,
        schema,
        required,
    }
}

fn id(name: &'static str, required: bool, description: &str) -> Property {
    property(
        name,
        required,
        json!({ "type": "string", "description": description }),
    )
}

fn text(name: &'static str, required: bool, description: &str) -> Property {
    property(
        name,
        required,
        json!({ "type": "string", "description": description }),
    )
}

fn pair(
    name: &'static str,
    required: bool,
    first: &str,
    second: &str,
    description: &str,
) -> Property {
    property(
        name,
        required,
        json!({
            "type": "object",
            "description": description,
            "properties": { first: { "type": "integer" }, second: { "type": "integer" } },
            "required": [first, second],
            "additionalProperties": false,
        }),
    )
}

const DOCUMENT_ID_HELP: &str = "ID of the Document (from getProject)";
const SHEET_ID_HELP: &str = "ID of the Sheet (from getDocument)";
const BLOCK_ID_HELP: &str = "ID of the Block (from getSheet)";
const WORLD_UNITS_HELP: &str = "integer world units";

pub fn tool_definitions() -> Vec<ToolDefinition> {
    let read = |name, description, properties| ToolDefinition {
        name,
        description,
        writes: false,
        destructive: false,
        project_choice: false,
        properties,
    };
    let write = |name, description, destructive, properties| ToolDefinition {
        name,
        description,
        writes: true,
        destructive,
        project_choice: false,
        properties,
    };
    let choice = |name, description, properties| ToolDefinition {
        name,
        description,
        writes: false,
        destructive: false,
        project_choice: true,
        properties,
    };
    vec![
        choice(
            LIST_PROJECTS,
            "The Projects Design Dawn offers to AI, most recently opened first: projectId, name, \
folder name, whether it is open in the app, whether the other tools use it now (inUse) and \
whether it may be changed (writable). Without selectProject the tools use the Project open in \
the app.",
            vec![],
        ),
        choice(
            SELECT_PROJECT,
            "Chooses the Project the other tools work on, by projectId from listProjects. Omit \
projectId to follow the Project open in the app again. Only for this session.",
            vec![id(
                "projectId",
                false,
                "ID of the Project (from listProjects); omit to follow the app",
            )],
        ),
        read(
            GET_PROJECT,
            "The Project: its ID and name, the Folder tree and the list of Documents.",
            vec![],
        ),
        read(
            GET_DOCUMENT,
            "A Document: its name and its Sheets in order.",
            vec![id("documentId", true, DOCUMENT_ID_HELP)],
        ),
        read(
            GET_SHEET,
            "A Sheet: its Blocks with type, position, size, stacking order (back to front) and \
caption. Block text is not included; use getBlock.",
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
            ],
        ),
        read(
            GET_BLOCK,
            "A Block. Markdown and Mermaid Blocks include their text and contentHash (pass it \
as expectedContentHash to updateBlock). Image Blocks include only file name, format and size.",
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                id("blockId", true, BLOCK_ID_HELP),
            ],
        ),
        write(
            CREATE_DOCUMENT,
            "Creates an empty Document (it has no Sheet yet; use createSheet), listed last in \
the Project or in a Folder.",
            false,
            vec![
                text("name", true, "display name"),
                id(
                    "folderId",
                    false,
                    "ID of the Folder to create it in (from getProject); omit for the Project root",
                ),
            ],
        ),
        write(
            CREATE_SHEET,
            "Creates an empty Sheet at the end of a Document.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                text("name", true, "display name"),
            ],
        ),
        write(
            CREATE_BLOCK,
            "Adds a Markdown or Mermaid Block in front of the others. Without position it is \
placed below the lowest existing Block; without size it is 480 x 320.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                property(
                    "type",
                    true,
                    json!({ "type": "string", "enum": CREATABLE_BLOCK_TYPES }),
                ),
                text(
                    "text",
                    true,
                    "the Block's text (Markdown or Mermaid source)",
                ),
                pair(
                    "position",
                    false,
                    "x",
                    "y",
                    &format!("top-left corner, {WORLD_UNITS_HELP}"),
                ),
                pair(
                    "size",
                    false,
                    "width",
                    "height",
                    &format!("{WORLD_UNITS_HELP}, at least 1"),
                ),
            ],
        ),
        write(
            UPDATE_DOCUMENT,
            "Renames a Document.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                text("name", true, "new display name"),
            ],
        ),
        write(
            UPDATE_SHEET,
            "Renames a Sheet.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                text("name", true, "new display name"),
            ],
        ),
        write(
            UPDATE_BLOCK,
            "Replaces the text of a Markdown or Mermaid Block. Nothing is written (result \
conflict) if the text changed since you read it.",
            true,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                id("blockId", true, BLOCK_ID_HELP),
                text("text", true, "the new text"),
                text(
                    "expectedContentHash",
                    true,
                    "the contentHash returned by getBlock for the text you based the change on",
                ),
            ],
        ),
        write(
            MOVE_BLOCK,
            "Moves a Block and optionally resizes it. Its stacking order does not change.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                id("blockId", true, BLOCK_ID_HELP),
                pair(
                    "position",
                    true,
                    "x",
                    "y",
                    &format!("top-left corner, {WORLD_UNITS_HELP}"),
                ),
                pair(
                    "size",
                    false,
                    "width",
                    "height",
                    &format!("{WORLD_UNITS_HELP}, at least 1"),
                ),
            ],
        ),
        write(
            UPDATE_BLOCK_CAPTION,
            "Sets or removes the caption of a figure (a Mermaid or Image Block): one line of \
up to 500 characters shown under (or above) it. An empty caption removes it. Markdown Blocks \
have no caption.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                id("blockId", true, BLOCK_ID_HELP),
                text(
                    "caption",
                    true,
                    "the caption text; an empty string removes the caption",
                ),
                property(
                    "position",
                    false,
                    json!({
                        "type": "string",
                        "enum": CAPTION_POSITIONS,
                        "description": "where it is shown; omit to keep the current place (below for a new caption)",
                    }),
                ),
            ],
        ),
        write(
            DELETE_BLOCK,
            "Deletes a Block and, for Markdown and Mermaid, its text file. An image's file is \
kept. This cannot be undone through this server.",
            true,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                id("blockId", true, BLOCK_ID_HELP),
            ],
        ),
    ]
}
