//! Values of the MCP server that are decided in one place (CLAUDE.md §46).

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

/// Shown to the client in `initialize`; it is the AI's first description of what this is.
pub const SERVER_INSTRUCTIONS: &str =
    "Reads and changes one Design Dawn Project made of Documents, Sheets and Blocks. \
Start with getProject, then getDocument, getSheet and getBlock. Blocks are placed on an \
infinite canvas in integer world units. To change a Block's text, call getBlock first and \
pass its contentHash as expectedContentHash to updateBlock; a conflict result means the text \
changed since, so read it again. Write tools exist only when the server was started with \
--allow-write.";

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

/// The SHA-256 hex digest used as `contentHash`.
pub const CONTENT_HASH_HEX_LENGTH: usize = 64;

pub const COMMAND_LINE_PROJECT_OPTION: &str = "--project";
pub const COMMAND_LINE_ALLOW_WRITE_OPTION: &str = "--allow-write";
