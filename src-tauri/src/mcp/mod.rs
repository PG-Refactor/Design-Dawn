//! MCP server: lets an AI client read and change a Project through
//! the same Application layer the app uses. It speaks JSON-RPC 2.0 over stdio, opens no
//! network port and starts no Tauri runtime.

pub mod arguments;
pub mod cli;
pub mod config;
pub mod protocol;
pub mod server;
pub mod tool_definitions;
pub mod tool_error;
pub mod tools;
pub mod workspace;
