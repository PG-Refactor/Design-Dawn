use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize, Serializer};

use super::error::ApplicationError;

/// Load Issue kinds from docs/data-model.md §7.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// A metadata file is written in an older `schemaVersion`; it was migrated in memory and
    /// is written in the current version by its next save.
    OutdatedFormat,
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
            Self::OutdatedFormat => "outdatedFormat",
        }
    }

    /// The only `detail` text the Frontend receives. The internal `detail` can embed I/O
    /// error messages with absolute paths; the Project-relative `path` field already tells
    /// the user which file is concerned. The exhaustive match forces a decision per kind.
    pub fn public_description(&self) -> &'static str {
        match self {
            Self::UnlistedEntity => "the item exists on disk but is not listed by its parent",
            Self::MissingEntity => "the item is listed by its parent but does not exist",
            Self::InvalidOrderEntry => "the order list contains an invalid entry",
            Self::DuplicateEntityId => "the ID is used more than once",
            Self::EntityLoadFailed => "the item could not be loaded",
            Self::MissingContent => "a block refers to content that does not exist",
            Self::OrphanContent => "a content file is not used by any block",
            Self::LeftoverTempFile => "a temporary file was left over from an interrupted save",
            Self::UnrecognizedDirectory => "the directory is not recognized",
            Self::OutdatedFormat => "the file uses an older format and is updated when it is saved",
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
    /// Developer-facing only (may contain absolute paths); never serialized as is.
    pub detail: String,
    /// For `EntityLoadFailed`: the public error kind that stopped the load (for example
    /// `unsupportedSchemaVersion`, which makes the item read-only), so the user is told why.
    pub reason: Option<&'static str>,
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
            reason: None,
        }
    }

    pub fn with_reason(mut self, error: &ApplicationError) -> Self {
        self.reason = Some(error.kind.as_str());
        self
    }
}

impl Serialize for LoadIssue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("LoadIssue", 5)?;
        state.serialize_field("kind", self.kind.as_str())?;
        state.serialize_field("path", &self.path)?;
        state.serialize_field("entityId", &self.entity_id)?;
        state.serialize_field("detail", self.kind.public_description())?;
        state.serialize_field("reason", &self.reason)?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_KINDS: [LoadIssueKind; 10] = [
        LoadIssueKind::UnlistedEntity,
        LoadIssueKind::MissingEntity,
        LoadIssueKind::InvalidOrderEntry,
        LoadIssueKind::DuplicateEntityId,
        LoadIssueKind::EntityLoadFailed,
        LoadIssueKind::MissingContent,
        LoadIssueKind::OrphanContent,
        LoadIssueKind::LeftoverTempFile,
        LoadIssueKind::UnrecognizedDirectory,
        LoadIssueKind::OutdatedFormat,
    ];

    #[test]
    fn a_kind_is_read_back_from_its_wire_name() {
        for kind in ALL_KINDS {
            let parsed: LoadIssueKind = serde_json::from_value(kind.as_str().into()).unwrap();
            assert_eq!(parsed, kind);
        }
    }

    #[test]
    fn serialized_detail_is_the_public_description_and_keeps_the_relative_path() {
        let issue = LoadIssue::new(
            LoadIssueKind::EntityLoadFailed,
            Some("documents/a/document.json"),
            Some("doc-1".to_owned()),
            "read /home/user/project/documents/a/document.json: denied",
        );
        let json = serde_json::to_value(&issue).unwrap();

        assert_eq!(json["path"], "documents/a/document.json");
        assert_eq!(json["entityId"], "doc-1");
        assert!(json["reason"].is_null());
        assert_eq!(
            json["detail"],
            LoadIssueKind::EntityLoadFailed.public_description()
        );
        assert!(!json.to_string().contains("/home/user"));
    }

    #[test]
    fn no_public_description_can_contain_a_path() {
        for kind in ALL_KINDS {
            let description = kind.public_description();
            assert!(!description.is_empty(), "{kind:?}");
            assert!(
                !description.contains('/')
                    && !description.contains('\\')
                    && !description.contains(":\\"),
                "{kind:?}: {description}"
            );
        }
    }
}
