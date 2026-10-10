use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::domain::error::{DomainError, DomainErrorKind};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::image_validation::ImageContentError;

/// Error conversion boundary (Rust side of the chain; the TypeScript side is `toCommandError`):
///
/// ```text
/// DomainError / PersistenceError  --From-->  ApplicationError { kind, detail }
///   --Serialize-->  { "kind": "<identifier>", "detail": "<text>" }   (Tauri rejection payload)
///   --TS toCommandError-->  CommandError { kind, detail }
/// ```
///
/// Only `kind` is a stable contract; the wire `detail` is a fixed per-kind description (the
/// internal `detail` can contain paths and stays in Rust). Errors Tauri raises itself
/// before a command runs (bad arguments, ACL) are NOT this shape: they are plain strings, and
/// the client maps them to `unexpectedCommandError`. `fixtures/ipc/` pins both cases.
///
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
    /// A `dropId` that is unknown or has been replaced by a newer drop.
    InvalidDropSelection,
    /// An image whose content is not a valid image of the format its extension names, or
    /// something that is not a regular file.
    InvalidImageContent,
    /// An asset larger than `ASSET_MAX_BYTES`.
    AssetTooLarge,
    /// A theme preference that is not `system` or a defined theme id.
    InvalidThemePreference,
    /// A language preference that is not `system`, `en` or `ja`.
    InvalidLanguagePreference,
    /// `delete_folder` on a folder that holds anything besides `folder.json` and temp files.
    FolderNotEmpty,
    /// `move_entry` that is not allowed: into itself or a descendant, or an entry that is
    /// open (or holds an open Document).
    InvalidMove,
    /// A viewport with a non-finite or out-of-range `panX` / `panY` / `zoom`.
    InvalidViewport,
    /// A Project Tree width that is not an integer within the allowed range.
    InvalidProjectTreeWidth,
    /// The Project is already open in another window (docs/architecture.md §11.0.1).
    ProjectOpenInOtherWindow,
    /// A git process failed in a way that is not a repository state (non-zero exit of a
    /// ready repository, unreadable output, the process could not be started).
    GitCommandFailed,
    /// A git process exceeded its time limit and was killed.
    GitTimeout,
    /// A Project-relative path for git that is empty, absolute, contains `..`, a drive
    /// letter, a UNC prefix, a backslash or NUL.
    InvalidGitPath,
    /// A git operation was requested while the repository is not `ready` (no git, not a
    /// repository, unsupported layout, broken repository).
    GitNotReady,
    /// A commit message that is empty, contains control characters or is too long.
    InvalidCommitMessage,
    /// Commit requested while nothing is staged.
    NothingToCommit,
    /// Commit requested while files are unmerged (a conflict is unresolved).
    GitUnmergedChanges,
    /// Commit requested during a merge / cherry-pick / revert / rebase.
    GitOperationInProgress,
    /// `user.name` / `user.email` are not configured.
    GitIdentityMissing,
    /// git refused the commit (a hook failed, signing failed, ...).
    GitCommitRejected,
    /// A History request with a page size or cursor that is out of range, malformed, or
    /// names a commit that no longer exists.
    InvalidHistoryRequest,
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
            Self::InvalidDropSelection => "invalidDropSelection",
            Self::InvalidImageContent => "invalidImageContent",
            Self::AssetTooLarge => "assetTooLarge",
            Self::InvalidThemePreference => "invalidThemePreference",
            Self::InvalidLanguagePreference => "invalidLanguagePreference",
            Self::FolderNotEmpty => "folderNotEmpty",
            Self::InvalidMove => "invalidMove",
            Self::InvalidViewport => "invalidViewport",
            Self::InvalidProjectTreeWidth => "invalidProjectTreeWidth",
            Self::ProjectOpenInOtherWindow => "projectOpenInOtherWindow",
            Self::GitCommandFailed => "gitCommandFailed",
            Self::GitTimeout => "gitTimeout",
            Self::InvalidGitPath => "invalidGitPath",
            Self::GitNotReady => "gitNotReady",
            Self::InvalidCommitMessage => "invalidCommitMessage",
            Self::NothingToCommit => "nothingToCommit",
            Self::GitUnmergedChanges => "gitUnmergedChanges",
            Self::GitOperationInProgress => "gitOperationInProgress",
            Self::GitIdentityMissing => "gitIdentityMissing",
            Self::GitCommitRejected => "gitCommitRejected",
            Self::InvalidHistoryRequest => "invalidHistoryRequest",
        }
    }

    /// The only `detail` text the Frontend receives: fixed per kind, with no interpolated
    /// values, so absolute paths, Project roots and internal file names never cross the IPC
    /// boundary. The full `detail` stays in Rust (Display / Debug / logs). The exhaustive
    /// match forces a decision for every new kind.
    pub fn public_description(&self) -> &'static str {
        match self {
            Self::Domain(kind) => kind.public_description(),
            Self::Persistence(kind) => kind.public_description(),
            Self::NotWritable => "the content is not open for writing",
            Self::ProjectNotOpen => "the project is not open",
            Self::EntityNotFound => "the requested item is not known or not open",
            Self::DialogFailed => "the folder dialog failed",
            Self::InvalidFolderSelection => "the folder selection is no longer valid",
            Self::InvalidDropSelection => "the dropped files selection is no longer valid",
            Self::InvalidImageContent => "the file is not a valid image",
            Self::AssetTooLarge => "the image file is too large",
            Self::InvalidThemePreference => "the theme preference is not valid",
            Self::InvalidLanguagePreference => "the language preference is not valid",
            Self::FolderNotEmpty => "the folder is not empty",
            Self::InvalidMove => "the item cannot be moved there",
            Self::InvalidViewport => "the viewport is not valid",
            Self::InvalidProjectTreeWidth => "the project tree width is not valid",
            Self::ProjectOpenInOtherWindow => "the project is open in another window",
            Self::GitCommandFailed => "the git command failed",
            Self::GitTimeout => "the git command did not finish in time",
            Self::InvalidGitPath => "the path is not valid for git",
            Self::GitNotReady => "the repository is not ready for git operations",
            Self::InvalidCommitMessage => "the commit message is not valid",
            Self::NothingToCommit => "there are no staged changes to commit",
            Self::GitUnmergedChanges => "there are unresolved conflicts",
            Self::GitOperationInProgress => "a merge or similar operation is in progress",
            Self::GitIdentityMissing => "the git user name or email is not configured",
            Self::GitCommitRejected => "git rejected the commit",
            Self::InvalidHistoryRequest => "the history request is not valid",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationError {
    pub kind: ErrorKind,
    /// Developer-facing only (may contain paths); never serialized as is. Callers must
    /// compare on `kind`.
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

impl From<ImageContentError> for ApplicationError {
    fn from(error: ImageContentError) -> Self {
        Self::new(ErrorKind::InvalidImageContent, error.detail)
    }
}

impl fmt::Display for ApplicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.kind.as_str(), self.detail)
    }
}

impl std::error::Error for ApplicationError {}

/// Wire form: `{ kind, detail }`, where `detail` is `ErrorKind::public_description`.
impl Serialize for ApplicationError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("ApplicationError", 2)?;
        state.serialize_field("kind", self.kind.as_str())?;
        state.serialize_field("detail", self.kind.public_description())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_KINDS: [ErrorKind; 43] = [
        ErrorKind::Domain(DomainErrorKind::InvalidEntityId),
        ErrorKind::Domain(DomainErrorKind::InvalidDisplayName),
        ErrorKind::Domain(DomainErrorKind::InvalidPosition),
        ErrorKind::Domain(DomainErrorKind::InvalidSize),
        ErrorKind::Domain(DomainErrorKind::UnsupportedBlockType),
        ErrorKind::Domain(DomainErrorKind::InvalidContentPath),
        ErrorKind::Domain(DomainErrorKind::InvalidContentExtension),
        ErrorKind::Domain(DomainErrorKind::InvalidSchemaVersion),
        ErrorKind::Domain(DomainErrorKind::UnsupportedSchemaVersion),
        ErrorKind::Domain(DomainErrorKind::DuplicateId),
        ErrorKind::Persistence(PersistenceErrorKind::InvalidJson),
        ErrorKind::Persistence(PersistenceErrorKind::InvalidFileStructure),
        ErrorKind::Persistence(PersistenceErrorKind::InvalidEncoding),
        ErrorKind::Persistence(PersistenceErrorKind::PathOutsideRoot),
        ErrorKind::Persistence(PersistenceErrorKind::FileNotFound),
        ErrorKind::Persistence(PersistenceErrorKind::AlreadyExists),
        ErrorKind::Persistence(PersistenceErrorKind::IoError),
        ErrorKind::NotWritable,
        ErrorKind::ProjectNotOpen,
        ErrorKind::EntityNotFound,
        ErrorKind::DialogFailed,
        ErrorKind::InvalidFolderSelection,
        ErrorKind::InvalidDropSelection,
        ErrorKind::InvalidImageContent,
        ErrorKind::AssetTooLarge,
        ErrorKind::InvalidThemePreference,
        ErrorKind::InvalidLanguagePreference,
        ErrorKind::FolderNotEmpty,
        ErrorKind::InvalidMove,
        ErrorKind::InvalidViewport,
        ErrorKind::InvalidProjectTreeWidth,
        ErrorKind::ProjectOpenInOtherWindow,
        ErrorKind::GitCommandFailed,
        ErrorKind::GitTimeout,
        ErrorKind::InvalidGitPath,
        ErrorKind::GitNotReady,
        ErrorKind::InvalidCommitMessage,
        ErrorKind::NothingToCommit,
        ErrorKind::GitUnmergedChanges,
        ErrorKind::GitOperationInProgress,
        ErrorKind::GitIdentityMissing,
        ErrorKind::GitCommitRejected,
        ErrorKind::InvalidHistoryRequest,
    ];

    /// A Windows drive path (`C:\`) or any separator would mean a path leaked.
    pub(crate) fn looks_like_path(text: &str) -> bool {
        text.contains('/') || text.contains('\\') || text.contains(":\\")
    }

    #[test]
    fn serialized_detail_is_the_public_description_not_the_internal_detail() {
        let internal = PersistenceError::from_io(
            "read /home/user/project/documents/secret/document.json",
            &std::io::Error::from(std::io::ErrorKind::NotFound),
        );
        let json = serde_json::to_value(ApplicationError::from(internal)).unwrap();

        assert_eq!(json["kind"], "fileNotFound");
        assert_eq!(
            json["detail"],
            PersistenceErrorKind::FileNotFound.public_description()
        );
        assert!(!json.to_string().contains("secret"));
        assert!(!looks_like_path(json["detail"].as_str().unwrap()));
    }

    #[test]
    fn display_keeps_the_internal_detail_for_developers() {
        let error = ApplicationError::new(ErrorKind::NotWritable, "read /tmp/x");
        assert_eq!(error.to_string(), "notWritable: read /tmp/x");
    }

    #[test]
    fn no_public_description_can_contain_a_path() {
        for kind in ALL_KINDS {
            let description = kind.public_description();
            assert!(!description.is_empty(), "{kind:?}");
            assert!(!looks_like_path(description), "{kind:?}: {description}");
        }
    }
}
