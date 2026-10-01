//! Single source of truth for on-disk file format values (docs/file-format.md).
//! Layout names shared with the domain's path rules (`sheets`, `blocks`, `assets`)
//! live in `crate::domain::constants`.

pub const PROJECT_FILE_NAME: &str = "project.json";
pub const DOCUMENT_FILE_NAME: &str = "document.json";
pub const SHEET_FILE_NAME: &str = "sheet.json";
pub const DOCUMENTS_DIRECTORY_NAME: &str = "documents";

pub const GITATTRIBUTES_FILE_NAME: &str = ".gitattributes";
/// Generated once at project creation; never overwritten (file-format.md §8).
pub const GITATTRIBUTES_CONTENT: &str =
    "* text=auto eol=lf\n*.png binary\n*.jpg binary\n*.jpeg binary\n*.webp binary\n*.gif binary\n";

/// `.dawn` has no `SchemaEntityKind` in the domain, so its supported version lives here.
pub const CURRENT_ENTRY_POINT_SCHEMA_VERSION: u32 = 1;

/// Atomic Save temp file: `.<file-name>.dawn-tmp` next to the target (file-format.md §9).
pub const TEMP_FILE_PREFIX: &str = ".";
pub const TEMP_FILE_SUFFIX: &str = ".dawn-tmp";

pub const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
pub const CRLF: &str = "\r\n";
pub const LF: &str = "\n";
pub const JSON_TRAILING_NEWLINE: &str = "\n";

// Naming (file-format.md §9.3).
pub const SLUG_MAX_LENGTH: usize = 64;
pub const SLUG_SEPARATOR: char = '-';
pub const DOCUMENT_NAME_BASE: &str = "document";
pub const SHEET_NAME_BASE: &str = "sheet";
pub const ASSET_FALLBACK_STEM: &str = "image";
/// Numbered fallback names start at 1 (`document-1`).
pub const FALLBACK_FIRST_NUMBER: u32 = 1;
/// A collision suffix starts at 2 (`name-2`); the unsuffixed name is implicitly number 1.
pub const COLLISION_FIRST_SUFFIX: u32 = 2;
/// Block content files are numbered from 1 (`markdown-1.md`).
pub const BLOCK_CONTENT_FIRST_NUMBER: u64 = 1;
pub const BLOCK_CONTENT_NUMBER_SEPARATOR: char = '-';
