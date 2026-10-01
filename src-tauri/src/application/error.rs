use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::domain::error::{DomainError, DomainErrorKind};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};

/// The complete set of error identifiers a Command can return (docs/architecture.md §6.3):
/// domain kinds, persistence kinds, and the session-level kinds defined here.
/// Each identifier is defined exactly once, in its own enum's `as_str`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    Domain(DomainErrorKind),
    Persistence(PersistenceErrorKind),
    /// The entity failed to load, or was never opened in this session.
    NotWritable,
    ProjectNotOpen,
    /// An ID that the session (or the payload's own target) does not know.
    EntityNotFound,
    /// The native folder dialog could not be shown or its result could not be read.
    DialogFailed,
    /// A `selectionId` that is unknown or has been replaced by a newer selection.
    InvalidFolderSelection,
}

impl ErrorKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Domain(kind) => kind.as_str(),
            Self::Persistence(kind) => kind.as_str(),
            Self::NotWritable => "notWritable",
            Self::ProjectNotOpen => "projectNotOpen",
            Self::EntityNotFound => "entityNotFound",
            Self::DialogFailed => "dialogFailed",
            Self::InvalidFolderSelection => "invalidFolderSelection",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationError {
    pub kind: ErrorKind,
    /// Developer-facing only; callers must compare on `kind`.
    pub detail: String,
}

pub type ApplicationResult<T> = Result<T, ApplicationError>;

impl ApplicationError {
    pub fn new(kind: ErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }

    pub fn not_writable(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotWritable, detail)
    }

    pub fn entity_not_found(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::EntityNotFound, detail)
    }

    pub fn project_not_open(detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::ProjectNotOpen, detail)
    }

    pub fn persistence(kind: PersistenceErrorKind, detail: impl Into<String>) -> Self {
        Self::new(ErrorKind::Persistence(kind), detail)
    }
}

impl From<DomainError> for ApplicationError {
    fn from(error: DomainError) -> Self {
        Self::new(ErrorKind::Domain(error.kind), error.detail)
    }
}

impl From<PersistenceError> for ApplicationError {
    fn from(error: PersistenceError) -> Self {
        Self::new(ErrorKind::Persistence(error.kind), error.detail)
    }
}

impl fmt::Display for ApplicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.kind.as_str(), self.detail)
    }
}

impl std::error::Error for ApplicationError {}

/// Wire form: `{ kind, detail }`.
impl Serialize for ApplicationError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("ApplicationError", 2)?;
        state.serialize_field("kind", self.kind.as_str())?;
        state.serialize_field("detail", &self.detail)?;
        state.end()
    }
}
