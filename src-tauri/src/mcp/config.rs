//! Values of the MCP server that are decided in one place.

use crate::application::authoring::BLOCK_TEXT_MAX_BYTES;
use crate::domain::constants::{
    DEFAULT_NEW_BLOCK_GAP, DEFAULT_NEW_BLOCK_HEIGHT, DEFAULT_NEW_BLOCK_WIDTH, DEFAULT_NEW_BLOCK_X,
    DEFAULT_NEW_BLOCK_Y,
};

pub const SERVER_NAME: &str = "design-dawn-mcp";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Newest first. `initialize` answers with the client's version when it is in this list and
/// with the first entry otherwise, and the client then decides whether it can continue.
pub const SUPPORTED_PROTOCOL_VERSIONS: [&str; 2] = ["2025-06-18", "2025-03-26"];

/// What every session is told about the Project's structure and safe editing.
macro_rules! common_instructions {
    () => {
        "A Project holds Documents (optionally in Folders); a Document holds Sheets; a Sheet \
is a free-form canvas of Blocks (Markdown, Mermaid or Image) placed in integer world units, \
unbounded in every direction. Read top-down: getProject, getDocument, getSheet, then getBlock \
for a Block's text. To change a Block's text, call getBlock first and pass its contentHash as \
expectedContentHash to updateBlock; a conflict result means someone changed it since, so read \
it again and redo the change on the new text. Prefer small changes to one Block over rewriting \
many. A Mermaid Block holds Mermaid source; keep it valid Mermaid. A Markdown Block can show \
an image file of its own Document's assets folder, written relative to the Markdown file: \
![alt](../../../assets/<file name>) (the file name of an Image Block's getBlock); any other \
image source shows only its alt text. A figure (a Mermaid or Image \
Block) may have a one-line caption, set with updateBlockCaption. Changes appear in the \
Design Dawn app at once if it has the Project open; they cannot be undone through this \
server, but the user can review them with Git. Never guess IDs: take them from the read tools."
    };
}

/// Shown to the client in `initialize`.
pub const APP_MODE_INSTRUCTIONS: &str = concat!(
    "Reads and changes the Design Dawn Projects offered to AI. ",
    "By default the tools work on the Project open in the Design Dawn app (the one used \
last), if it is offered. When the user names another Project, or you are unsure which one is \
meant, call listProjects and then selectProject with its projectId; selectProject without \
projectId follows the app again. A Project that is not listed can be offered with addProject \
and its folder. getProject tells which Project you are working on and whether it is writable. \
A Project is read-only for AI until changes are allowed: a writeDisabled result means that (it \
is given before the arguments are checked). Call setWriteAccess only when the user asked you \
to change that Project, and tell them you did; the user approves addProject, setWriteAccess \
and every change in the AI client, and Design Dawn keeps them in its AI history. ",
    common_instructions!()
);

/// One JSON-RPC message per line; a longer line is refused instead of buffered.
pub const MESSAGE_MAX_BYTES: usize = 8 * 1024 * 1024;

/// A Block's text may not exceed this (the same bound the app applies to comparisons).
pub const TEXT_MAX_BYTES: u64 = BLOCK_TEXT_MAX_BYTES;

/// What a new Block starts with when the caller gives no position or size
/// (`domain::constants::DEFAULT_NEW_BLOCK_*`, shared with the app's repair of orphan files).
pub const DEFAULT_BLOCK_WIDTH: i64 = DEFAULT_NEW_BLOCK_WIDTH;
pub const DEFAULT_BLOCK_HEIGHT: i64 = DEFAULT_NEW_BLOCK_HEIGHT;
pub const DEFAULT_BLOCK_X: i64 = DEFAULT_NEW_BLOCK_X;
pub const DEFAULT_BLOCK_GAP: i64 = DEFAULT_NEW_BLOCK_GAP;
pub const DEFAULT_BLOCK_Y: i64 = DEFAULT_NEW_BLOCK_Y;

/// The smallest Block an AI may make: the same lower bound as resizing in the app
/// (`CANVAS_CONFIG.block.minSize` in the Frontend), so an AI cannot make a Block the app
/// itself would not. A file edited by hand may still hold a smaller one (the format accepts
/// any size from 1); it is shown and can be resized back.
pub const BLOCK_MIN_WIDTH: i64 = 48;
pub const BLOCK_MIN_HEIGHT: i64 = 32;
/// The largest Block an AI may make: the app's upper bound of a resize
/// (`CANVAS_CONFIG.block.maxSize`).
pub const BLOCK_MAX_WIDTH: i64 = 10_000;
pub const BLOCK_MAX_HEIGHT: i64 = 10_000;

/// The SHA-256 hex digest used as `contentHash`.
pub const CONTENT_HASH_HEX_LENGTH: usize = 64;

pub const COMMAND_LINE_APP_CONFIG_DIR_OPTION: &str = "--app-config-dir";
