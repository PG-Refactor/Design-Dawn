use serde_json::Number;

use super::constants::{PROJECT_TREE_WIDTH_MAX, PROJECT_TREE_WIDTH_MIN};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};

/// Accepts integers only (`Number::as_u64` is `None` for `320.0` and for fractions), so a
/// hand-edited file cannot smuggle in a width the UI would then have to round.
pub fn parse_project_tree_width(number: &Number) -> ApplicationResult<u32> {
    number
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| (PROJECT_TREE_WIDTH_MIN..=PROJECT_TREE_WIDTH_MAX).contains(value))
        .ok_or_else(|| {
            ApplicationError::new(
                ErrorKind::InvalidProjectTreeWidth,
                format!(
                    "project tree width {number} must be an integer within \
                     [{PROJECT_TREE_WIDTH_MIN}, {PROJECT_TREE_WIDTH_MAX}]"
                ),
            )
        })
}
