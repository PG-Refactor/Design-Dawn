//! The tool list: names, descriptions and JSON Schema of the inputs. The handlers are in
//! `tools.rs`; the argument names used there must match the properties declared here, which
//! `Arguments` enforces by refusing any key not declared.

use serde_json::{json, Map, Value};

use super::config::{BLOCK_MAX_HEIGHT, BLOCK_MAX_WIDTH, BLOCK_MIN_HEIGHT, BLOCK_MIN_WIDTH};
use crate::domain::constants::{CONTENT_SCALE_MAX_PERCENT, CONTENT_SCALE_MIN_PERCENT};

pub const LIST_PROJECTS: &str = "listProjects";
pub const SELECT_PROJECT: &str = "selectProject";
pub const ADD_PROJECT: &str = "addProject";
pub const SET_WRITE_ACCESS: &str = "setWriteAccess";
pub const GET_PROJECT: &str = "getProject";
pub const GET_DOCUMENT: &str = "getDocument";
pub const GET_SHEET: &str = "getSheet";
pub const GET_BLOCK: &str = "getBlock";
pub const SEARCH_PROJECT: &str = "searchProject";
pub const EXPORT_MARKDOWN: &str = "exportMarkdown";
pub const CREATE_DOCUMENT: &str = "createDocument";
pub const CREATE_SHEET: &str = "createSheet";
pub const CREATE_BLOCK: &str = "createBlock";
pub const UPDATE_DOCUMENT: &str = "updateDocument";
pub const UPDATE_SHEET: &str = "updateSheet";
pub const UPDATE_BLOCK: &str = "updateBlock";
pub const MOVE_BLOCK: &str = "moveBlock";
pub const UPDATE_BLOCK_CAPTION: &str = "updateBlockCaption";
pub const UPDATE_BLOCK_DISPLAY: &str = "updateBlockDisplay";
pub const DELETE_BLOCK: &str = "deleteBlock";
pub const IMPORT_IMAGE: &str = "importImage";
pub const LIST_TEMPLATES: &str = "listTemplates";
pub const CREATE_FROM_TEMPLATE: &str = "createFromTemplate";

/// Where a template is kept, and what it makes (as the app's templates name them).
pub const TEMPLATE_SCOPES: [&str; 3] = ["shared", "project", "global"];
pub const TEMPLATE_KINDS: [&str; 4] = ["markdown", "mermaid", "sheet", "document"];

/// Where a caption can be shown, as `updateBlockCaption` takes it.
pub const CAPTION_POSITIONS: [&str; 2] = ["below", "above"];

/// Block types createBlock makes from text (an image comes in with importImage).
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
    /// Write tools are refused unless the Project may be changed (its permission in the AI
    /// access list).
    pub writes: bool,
    /// Changes the AI access list itself (which Projects are offered, which may be changed);
    /// the user approves such a call in the AI client, and it is kept in the AI history.
    pub changes_access: bool,
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
        let read_only = !self.writes && !self.changes_access;
        let mut annotations = json!({ "readOnlyHint": read_only, "openWorldHint": false });
        if !read_only {
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

fn flag(name: &'static str, description: &str) -> Property {
    property(
        name,
        false,
        json!({ "type": "boolean", "description": description }),
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

const DOCUMENT_ID_HELP: &str =
    "ID of the Document (a documentId from getProject's documents; not the projectId)";
const SHEET_ID_HELP: &str = "ID of the Sheet (from getDocument)";
const BLOCK_ID_HELP: &str = "ID of the Block (from getSheet)";
const WORLD_UNITS_HELP: &str = "integer world units";

pub fn tool_definitions() -> Vec<ToolDefinition> {
    let read = |name, description, properties| ToolDefinition {
        name,
        description,
        writes: false,
        destructive: false,
        changes_access: false,
        properties,
    };
    let write = |name, description, destructive, properties| ToolDefinition {
        name,
        description,
        writes: true,
        destructive,
        changes_access: false,
        properties,
    };
    let access = |name, description, properties| ToolDefinition {
        name,
        description,
        writes: false,
        destructive: false,
        changes_access: true,
        properties,
    };
    vec![
        read(
            LIST_PROJECTS,
            "The Projects Design Dawn offers to AI, most recently opened first: projectId, name, \
folder name, whether it is the Project used last in the app (lastUsedInApp, also while the app \
is closed), whether the other tools use it now (inUse) and \
whether it may be changed (writable). Without selectProject the tools use the Project open in \
the app.",
            vec![],
        ),
        read(
            SELECT_PROJECT,
            "Chooses the Project the other tools work on, by projectId from listProjects. Omit \
projectId to follow the Project open in the app again. Only for this session.",
            vec![id(
                "projectId",
                false,
                "ID of the Project (from listProjects); omit to follow the app",
            )],
        ),
        access(
            ADD_PROJECT,
            "Offers a Project to AI: the Project in folder (an absolute path of the folder \
holding project.json) joins the list that listProjects shows and that Design Dawn's AI \
integration screen shows, read-only. Call it only when the user asked to work on that Project; \
already offered: nothing changes.",
            vec![text(
                "folder",
                true,
                "absolute path of the Project folder (the one holding project.json)",
            )],
        ),
        access(
            SET_WRITE_ACCESS,
            "Allows (writable true) or stops (false) AI changes to an offered Project: the one \
in use, or projectId. Call it only when the user asked for changes to that Project, and tell \
them; Design Dawn shows the setting and keeps the call in its AI history.",
            vec![
                property(
                    "writable",
                    true,
                    json!({ "type": "boolean", "description": "true allows changes, false makes it read-only" }),
                ),
                id(
                    "projectId",
                    false,
                    "ID of the Project (from listProjects); omit for the Project in use",
                ),
            ],
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
        read(
            LIST_TEMPLATES,
            "The templates the user saved in the app: scope (shared = in the Project, shared through Git; project = the user's own for this Project; global = the user's own for every Project), kind (markdown / mermaid: one Block; sheet; document), templateId and name. Make something from one with createFromTemplate.",
            vec![],
        ),
        read(
            SEARCH_PROJECT,
            "Finds text in every Markdown and Mermaid Block and every caption of the Project: \
each match with its documentId, sheetId, blockId, line and the line around it (at most 500; \
truncated tells if there were more). Use it to find the Block to read with getBlock instead \
of reading every Block.",
            vec![
                text(
                    "query",
                    true,
                    "the text to find: plain text, or a regular expression when regex is true",
                ),
                flag(
                    "matchCase",
                    "true to tell upper and lower case apart (default false)",
                ),
                flag(
                    "regex",
                    "true to read query as a regular expression (Rust regex syntax: no look-around \
or back-references), matched within each line (default false). An invalid one is the error \
invalidSearchPattern",
                ),
            ],
        ),
        read(
            EXPORT_MARKDOWN,
            "A whole Document as one Markdown text, to read it in one call: the Document name \
as #, each Sheet as ##, the Blocks of a Sheet in reading order (rows from the top, left to \
right), Mermaid as fenced code, images as image references and captions next to their figure. \
Nothing is written.",
            vec![id("documentId", true, DOCUMENT_ID_HELP)],
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
placed below the lowest existing Block; without size it is 480 x 320. The result has the new \
blockId and contentHash. To give a Mermaid Block a caption, call updateBlockCaption next.",
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
                    &format!(
                        "{WORLD_UNITS_HELP}, from {BLOCK_MIN_WIDTH} x {BLOCK_MIN_HEIGHT} to {BLOCK_MAX_WIDTH} x {BLOCK_MAX_HEIGHT} (width x height)"
                    ),
                ),
            ],
        ),
        write(
            CREATE_FROM_TEMPLATE,
            "Makes a new Block (kind markdown / mermaid: needs documentId and sheetId), Sheet (kind sheet: needs documentId) or Document (kind document; folderId optional) from a template of listTemplates, with the template's texts, layout and captions. name renames the new Sheet or Document. Image Blocks are made too: the template's images are copied into the Document (an identical image of the same name there is used as it is).",
            false,
            vec![
                property(
                    "scope",
                    true,
                    json!({ "type": "string", "enum": TEMPLATE_SCOPES }),
                ),
                property(
                    "kind",
                    true,
                    json!({ "type": "string", "enum": TEMPLATE_KINDS }),
                ),
                id("templateId", true, "ID of the template (from listTemplates)"),
                id("documentId", false, DOCUMENT_ID_HELP),
                id("sheetId", false, SHEET_ID_HELP),
                id(
                    "folderId",
                    false,
                    "ID of the Folder for a new Document (from getProject); omit for the root",
                ),
                text("name", false, "display name of the new Sheet or Document"),
                pair(
                    "position",
                    false,
                    "x",
                    "y",
                    &format!("top-left corner of a new Block, {WORLD_UNITS_HELP}"),
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
            "Replaces the whole text of a Markdown or Mermaid Block (send the full new text; \
there is no partial edit). Nothing is written (result conflict) if the text changed since you \
read it.",
            true,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                id("blockId", true, BLOCK_ID_HELP),
                text("text", true, "the new text"),
                text(
                    "expectedContentHash",
                    true,
                    "the contentHash of the text you based the change on: from getBlock, or from \
createBlock / updateBlock for text you wrote yourself",
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
                    &format!(
                        "{WORLD_UNITS_HELP}, from {BLOCK_MIN_WIDTH} x {BLOCK_MIN_HEIGHT} to {BLOCK_MAX_WIDTH} x {BLOCK_MAX_HEIGHT} (width x height)"
                    ),
                ),
            ],
        ),
        write(
            UPDATE_BLOCK_DISPLAY,
            "Sets how large a Markdown or Mermaid Block shows its content: contentScalePercent \
(100 is as written) and/or autoFit (true: the largest size at which all of the content fits \
the Block, recomputed when the Block is resized; the scale is then not used). Mermaid Blocks \
fit by default, Markdown Blocks do not. getSheet and getBlock show both. Image Blocks always \
fit their Block.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                id("blockId", true, BLOCK_ID_HELP),
                property(
                    "contentScalePercent",
                    false,
                    json!({
                        "type": "integer",
                        "minimum": CONTENT_SCALE_MIN_PERCENT,
                        "maximum": CONTENT_SCALE_MAX_PERCENT,
                        "description": "the content's size in percent; omit to keep it",
                    }),
                ),
                flag("autoFit", "fit the content to the Block; omit to keep it"),
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
        write(
            IMPORT_IMAGE,
            "Adds an image file of this computer to a Sheet as an Image Block, as dropping it \
in Design Dawn does: the file (PNG, JPEG, WebP, SVG or GIF, up to 20 MiB) is copied into the \
Document's assets folder. Only for a file the user asked to add.",
            false,
            vec![
                id("documentId", true, DOCUMENT_ID_HELP),
                id("sheetId", true, SHEET_ID_HELP),
                text(
                    "path",
                    true,
                    "absolute path of the image file on this computer",
                ),
                pair(
                    "position",
                    false,
                    "x",
                    "y",
                    "where the image's top-left corner goes; omit to put it below the Blocks",
                ),
                text("caption", false, "an optional one-line caption"),
            ],
        ),
    ]
}
