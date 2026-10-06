//! Single source of truth for domain limits and format values in Rust.
//! TypeScript mirrors the numeric limits in `src/domain/domain-constants.ts`;
//! shared fixtures (`fixtures/domain/`) keep the two in sync.

pub const DISPLAY_NAME_MAX_CODE_POINTS: usize = 200;

pub const POSITION_MIN: i64 = -2_147_483_648;
pub const POSITION_MAX: i64 = 2_147_483_647;
pub const SIZE_MIN: i64 = 1;
pub const SIZE_MAX: i64 = 2_147_483_647;

pub const MIN_SCHEMA_VERSION: i64 = 1;
/// 2 replaced `documentOrder` with `childOrder` (docs/file-format.md §3.5); 1 is still read.
pub const CURRENT_PROJECT_SCHEMA_VERSION: u32 = 2;
/// The last `project.json` version that stored `documentOrder`.
pub const LEGACY_PROJECT_SCHEMA_VERSION: u32 = 1;
pub const CURRENT_FOLDER_SCHEMA_VERSION: u32 = 1;
pub const CURRENT_DOCUMENT_SCHEMA_VERSION: u32 = 1;
pub const CURRENT_SHEET_SCHEMA_VERSION: u32 = 1;

/// Inclusive code point ranges rejected in display names (C0, DEL, C1, line/paragraph separators).
pub const DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES: [(u32, u32); 3] =
    [(0x0000, 0x001F), (0x007F, 0x009F), (0x2028, 0x2029)];

// Entity ID canonical form: 8-4-4-4-12 lowercase hex, version nibble 7, variant 10xx.
pub const ENTITY_ID_LENGTH: usize = 36;
pub const ENTITY_ID_HYPHEN_POSITIONS: [usize; 4] = [8, 13, 18, 23];
pub const ENTITY_ID_VERSION_POSITION: usize = 14;
pub const ENTITY_ID_VERSION_CHARACTER: u8 = b'7';
pub const ENTITY_ID_VARIANT_POSITION: usize = 19;
pub const ENTITY_ID_VARIANT_CHARACTERS: [u8; 4] = *b"89ab";

// File layout names (docs/file-format.md §2, §6).
pub const SHEETS_DIRECTORY_NAME: &str = "sheets";
pub const BLOCKS_DIRECTORY_NAME: &str = "blocks";
pub const ASSETS_DIRECTORY_NAME: &str = "assets";

pub const PATH_SEPARATOR: char = '/';
pub const WINDOWS_PATH_SEPARATOR: char = '\\';
pub const CURRENT_DIRECTORY_SEGMENT: &str = ".";
pub const PARENT_DIRECTORY_SEGMENT: &str = "..";
pub const EXTENSION_SEPARATOR: char = '.';
pub const DEVICE_NAME_SEPARATOR: char = '.';

/// Characters Windows forbids in file names, plus `:` which also enables NTFS streams.
pub const FORBIDDEN_PATH_CHARACTERS: [char; 7] = ['<', '>', ':', '"', '|', '?', '*'];
pub const FORBIDDEN_PATH_CONTROL_RANGES: [(u32, u32); 2] = [(0x0000, 0x001F), (0x007F, 0x007F)];
pub const FORBIDDEN_SEGMENT_TRAILING_CHARACTERS: [char; 2] = ['.', ' '];

/// Compared case-insensitively against the part of a segment before its first `.`.
pub const RESERVED_DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
