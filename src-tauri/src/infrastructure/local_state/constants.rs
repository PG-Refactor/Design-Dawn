//! Single source of truth for the local state file names and schema versions.

pub const SETTINGS_FILE_NAME: &str = "settings.json";
pub const SHEET_VIEWPORTS_FILE_NAME: &str = "sheet-viewports.json";

pub const CURRENT_SETTINGS_SCHEMA_VERSION: u32 = 1;
pub const CURRENT_SHEET_VIEWPORTS_SCHEMA_VERSION: u32 = 1;

/// Integers up to 2^53 are exactly representable as `f64` (and as a JavaScript number).
pub const MAX_EXACT_INTEGER_F64: f64 = 9_007_199_254_740_992.0;
