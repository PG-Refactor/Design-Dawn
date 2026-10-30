//! The failure of a tool call as the AI sees it: `{ "error": { "kind", "message" } }` in a
//! result with `isError: true`. Messages are fixed per kind, so no path, Project root or file
//! content can leak through an error (docs/security.md §4).

use serde_json::{json, Value};

use crate::application::authoring::AuthoringError;
use crate::application::error::ApplicationError;
use crate::domain::error::DomainError;
use crate::infrastructure::error::PersistenceError;

pub const KIND_INVALID_ARGUMENTS: &str = "invalidArguments";
pub const KIND_WRITE_DISABLED: &str = "writeDisabled";
pub const KIND_CONFLICT: &str = "conflict";
pub const KIND_CONTENT_TOO_LARGE: &str = "contentTooLarge";
pub const KIND_PROJECT_CHANGED: &str = "projectChanged";
pub const KIND_SHEET_NOT_LOADED: &str = "sheetNotLoaded";
pub const KIND_INTERNAL: &str = "internalError";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    pub kind: String,
    pub message: String,
}

impl ToolError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_owned(),
            message: message.into(),
        }
    }

    /// The caller's own mistake in the arguments. `message` names the argument, never a value.
    pub fn invalid_arguments(message: impl Into<String>) -> Self {
        Self::new(KIND_INVALID_ARGUMENTS, message)
    }

    pub fn to_value(&self) -> Value {
        json!({ "error": { "kind": self.kind, "message": self.message } })
    }
}

impl From<ApplicationError> for ToolError {
    fn from(error: ApplicationError) -> Self {
        Self::new(error.kind.as_str(), error.kind.public_description())
    }
}

impl From<DomainError> for ToolError {
    fn from(error: DomainError) -> Self {
        Self::new(error.kind.as_str(), error.kind.public_description())
    }
}

impl From<PersistenceError> for ToolError {
    fn from(error: PersistenceError) -> Self {
        Self::new(error.kind.as_str(), error.kind.public_description())
    }
}

impl From<AuthoringError> for ToolError {
    fn from(error: AuthoringError) -> Self {
        match error {
            AuthoringError::Conflict => Self::new(
                KIND_CONFLICT,
                "the content changed on disk since it was read; read it again and retry",
            ),
            AuthoringError::TextTooLarge { limit_bytes } => Self::new(
                KIND_CONTENT_TOO_LARGE,
                format!("the text is larger than {limit_bytes} bytes"),
            ),
            AuthoringError::Failed(error) => error.into(),
        }
    }
}
