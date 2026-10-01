use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Load Issue kinds from docs/data-model.md §7.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LoadIssueKind {
    UnlistedEntity,
    MissingEntity,
    InvalidOrderEntry,
    DuplicateEntityId,
    EntityLoadFailed,
    MissingContent,
    OrphanContent,
    LeftoverTempFile,
    UnrecognizedDirectory,
}

impl LoadIssueKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UnlistedEntity => "unlistedEntity",
            Self::MissingEntity => "missingEntity",
            Self::InvalidOrderEntry => "invalidOrderEntry",
            Self::DuplicateEntityId => "duplicateEntityId",
            Self::EntityLoadFailed => "entityLoadFailed",
            Self::MissingContent => "missingContent",
            Self::OrphanContent => "orphanContent",
            Self::LeftoverTempFile => "leftoverTempFile",
            Self::UnrecognizedDirectory => "unrecognizedDirectory",
        }
    }
}

/// A warning or error found while loading. Loading never modifies files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadIssue {
    pub kind: LoadIssueKind,
    /// Project-root-relative path (`/`-separated) of the file or directory concerned.
    pub path: Option<String>,
    pub entity_id: Option<String>,
    /// Developer-facing only; callers must compare on `kind`.
    pub detail: String,
}

impl LoadIssue {
    pub fn new(
        kind: LoadIssueKind,
        path: Option<&str>,
        entity_id: Option<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            path: path.map(str::to_owned),
            entity_id,
            detail: detail.into(),
        }
    }
}

impl Serialize for LoadIssue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("LoadIssue", 4)?;
        state.serialize_field("kind", self.kind.as_str())?;
        state.serialize_field("path", &self.path)?;
        state.serialize_field("entityId", &self.entity_id)?;
        state.serialize_field("detail", &self.detail)?;
        state.end()
    }
}
