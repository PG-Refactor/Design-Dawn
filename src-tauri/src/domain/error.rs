use std::fmt;

/// Identifiers returned by `as_str` are shared with TypeScript (`domain-error.ts`).
/// `EntityNotFound` is TypeScript-only because Rust has no domain operations yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainErrorKind {
    InvalidEntityId,
    InvalidDisplayName,
    InvalidCaption,
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
            Self::InvalidCaption => "invalidCaption",
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

    /// Fixed text for the Frontend. `detail` can embed names and paths, so it never leaves
    /// Rust; the exhaustive match forces a decision for every new kind.
    pub fn public_description(&self) -> &'static str {
        match self {
            Self::InvalidEntityId => "the ID is not valid",
            Self::InvalidDisplayName => "the name is not valid",
            Self::InvalidCaption => "the caption is not valid",
            Self::InvalidPosition => "the position is not valid",
            Self::InvalidSize => "the size is not valid",
            Self::UnsupportedBlockType => "the block type is not supported",
            Self::InvalidContentPath => "the content path is not valid",
            Self::InvalidContentExtension => "the content file extension is not valid",
            Self::InvalidSchemaVersion => "the schema version is not valid",
            Self::UnsupportedSchemaVersion => "the schema version is not supported",
            Self::DuplicateId => "the ID is already in use",
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
