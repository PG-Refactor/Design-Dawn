//! serde DTOs for the local state files. Field order is the key order written to disk.
//! Numbers stay `serde_json::Number` so out-of-range values reach the application-layer
//! validators and produce the same error kinds as in TypeScript.

use serde::{Deserialize, Serialize};
use serde_json::Number;

use super::constants::MAX_EXACT_INTEGER_F64;
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsFileDto {
    pub schema_version: Number,
    pub theme_preference: String,
    /// Absent in schema versions 1 to 4 (read as `system`).
    #[serde(default)]
    pub language_preference: Option<String>,
    /// Absent in schema versions 1 to 5 (read as the default size).
    #[serde(default)]
    pub text_size: Option<String>,
    /// Absent in schema version 1.
    #[serde(default)]
    pub auto_save: Option<bool>,
    /// Absent in schema versions 1 and 2. A `Number` so that an out-of-range or
    /// non-integer value reaches the validator and gets its own error kind.
    #[serde(default)]
    pub project_tree_width: Option<Number>,
    /// Absent in schema versions 1 to 3 and until a window has been closed. Left out of the
    /// file when there is none (a `null` is accepted when reading).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_size: Option<WindowSizeDto>,
    /// Absent in schema versions 1 to 6 and until a Project was opened from the folder
    /// dialog. Left out of the file when there is none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_project_folder: Option<String>,
    /// Absent in schema versions 1 to 6 and until the user chose a default place for new
    /// Projects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_project_location: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSizeDto {
    pub width: Number,
    pub height: Number,
    pub maximized: bool,
}

/// `ai-access.json`: the Projects opened in the app, newest first, with whether an AI may
/// change each one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiAccessFileDto {
    pub schema_version: Number,
    /// The Project of the app window used last; absent when none was opened yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_project_id: Option<String>,
    pub projects: Vec<AiAccessProjectDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiAccessProjectDto {
    pub project_id: String,
    /// The Project folder (the one holding `project.json`).
    pub folder: String,
    pub allow_write: bool,
}

/// The `viewport` argument of `save_sheet_viewport`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewportDto {
    pub pan_x: Number,
    pub pan_y: Number,
    pub zoom: Number,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetViewportEntryDto {
    pub project_id: String,
    pub document_id: String,
    pub sheet_id: String,
    pub pan_x: Number,
    pub pan_y: Number,
    pub zoom: Number,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetViewportsFileDto {
    pub schema_version: Number,
    pub viewports: Vec<SheetViewportEntryDto>,
}

/// Whole values are written as integers (`-48`, not `-48.0`) to match the documented format
/// and keep Git diffs free of float noise.
pub fn number_from_f64(value: f64) -> Result<Number, PersistenceError> {
    if value.fract() == 0.0 && value.abs() < MAX_EXACT_INTEGER_F64 {
        // Exactly representable, so the cast loses nothing.
        return Ok(Number::from(value as i64));
    }
    Number::from_f64(value).ok_or_else(|| {
        PersistenceError::new(
            PersistenceErrorKind::IoError,
            format!("cannot serialize a non-finite number: {value}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_values_are_written_as_integers() {
        assert_eq!(number_from_f64(-48.0).unwrap().to_string(), "-48");
        assert_eq!(number_from_f64(1.25).unwrap().to_string(), "1.25");
        assert_eq!(number_from_f64(-0.0).unwrap().to_string(), "0");
    }

    #[test]
    fn non_finite_values_are_rejected() {
        assert!(number_from_f64(f64::NAN).is_err());
        assert!(number_from_f64(f64::INFINITY).is_err());
    }
}
