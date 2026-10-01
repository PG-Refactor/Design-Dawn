use std::fmt;

/// Identifiers returned by `as_str` are shared with TypeScript (`domain-error.ts`).
/// `EntityNotFound` is TypeScript-only because Rust has no domain operations yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainErrorKind {
    InvalidEntityId,
    InvalidDisplayName,
    InvalidPosition,
    InvalidSize,
    UnsupportedBlockType,
    InvalidContentPath,
    InvalidContentExtension,
    InvalidSchemaVersion,
    UnsupportedSchemaVersion,
    DuplicateId,
}

impl DomainErrorKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidEntityId => "invalidEntityId",
            Self::InvalidDisplayName => "invalidDisplayName",
            Self::InvalidPosition => "invalidPosition",
            Self::InvalidSize => "invalidSize",
            Self::UnsupportedBlockType => "unsupportedBlockType",
            Self::InvalidContentPath => "invalidContentPath",
            Self::InvalidContentExtension => "invalidContentExtension",
            Self::InvalidSchemaVersion => "invalidSchemaVersion",
            Self::UnsupportedSchemaVersion => "unsupportedSchemaVersion",
            Self::DuplicateId => "duplicateId",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainError {
    pub kind: DomainErrorKind,
    /// Developer-facing only; callers must compare on `kind`.
    pub detail: String,
}

impl DomainError {
    pub fn new(kind: DomainErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.kind.as_str(), self.detail)
    }
}

impl std::error::Error for DomainError {}
