use std::fmt;
use std::io;

/// Identifiers returned by `as_str` are part of the Command error contract
/// (docs/architecture.md §6.3) and are mirrored in the TypeScript client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersistenceErrorKind {
    InvalidJson,
    InvalidFileStructure,
    InvalidEncoding,
    PathOutsideRoot,
    FileNotFound,
    AlreadyExists,
    IoError,
}

impl PersistenceErrorKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidJson => "invalidJson",
            Self::InvalidFileStructure => "invalidFileStructure",
            Self::InvalidEncoding => "invalidEncoding",
            Self::PathOutsideRoot => "pathOutsideRoot",
            Self::FileNotFound => "fileNotFound",
            Self::AlreadyExists => "alreadyExists",
            Self::IoError => "ioError",
        }
    }

    /// Fixed text for the Frontend. `detail` can embed absolute paths, so it never leaves
    /// Rust; the exhaustive match forces a decision for every new kind.
    pub fn public_description(&self) -> &'static str {
        match self {
            Self::InvalidJson => "a file does not contain valid JSON",
            Self::InvalidFileStructure => "a file does not have the expected structure",
            Self::InvalidEncoding => "a file is not valid UTF-8 text",
            Self::PathOutsideRoot => "the path is outside the project",
            Self::FileNotFound => "the requested content does not exist",
            Self::AlreadyExists => "the content already exists",
            Self::IoError => "the file could not be read or written",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistenceError {
    pub kind: PersistenceErrorKind,
    /// Developer-facing only; callers must compare on `kind`.
    pub detail: String,
}

impl PersistenceError {
    pub fn new(kind: PersistenceErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }

    /// Maps an I/O failure to the kinds callers branch on; anything else is `ioError`.
    pub fn from_io(context: impl fmt::Display, error: &io::Error) -> Self {
        let kind = match error.kind() {
            io::ErrorKind::NotFound => PersistenceErrorKind::FileNotFound,
            io::ErrorKind::AlreadyExists => PersistenceErrorKind::AlreadyExists,
            _ => PersistenceErrorKind::IoError,
        };
        Self::new(kind, format!("{context}: {error}"))
    }
}

impl fmt::Display for PersistenceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.kind.as_str(), self.detail)
    }
}

impl std::error::Error for PersistenceError {}
