//! The caption of a Block: one line of text shown under a figure (a diagram or an image).

use super::constants::{CAPTION_MAX_CODE_POINTS, DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES};
use super::error::{DomainError, DomainErrorKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caption(String);

fn invalid(detail: impl Into<String>) -> DomainError {
    DomainError::new(DomainErrorKind::InvalidCaption, detail)
}

impl Caption {
    /// Same character rules as a display name (no control or line-separator characters, so
    /// it stays one line), longer. "No caption" is the absence of one, never an empty text.
    pub fn new(value: &str) -> Result<Self, DomainError> {
        if value.chars().all(char::is_whitespace) {
            return Err(invalid("empty or whitespace only"));
        }
        if let Some(character) = value.chars().find(|character| {
            let code_point = u32::from(*character);
            DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES
                .iter()
                .any(|(first, last)| (*first..=*last).contains(&code_point))
        }) {
            return Err(invalid(format!(
                "contains control character U+{:04X}",
                u32::from(character)
            )));
        }
        if value.chars().count() > CAPTION_MAX_CODE_POINTS {
            return Err(invalid(format!(
                "longer than {CAPTION_MAX_CODE_POINTS} code points"
            )));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Where a caption is shown relative to its figure. Below is the default and is not
/// written to the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptionPosition {
    Below,
    Above,
}

const CAPTION_POSITIONS: [(CaptionPosition, &str); 2] = [
    (CaptionPosition::Below, "below"),
    (CaptionPosition::Above, "above"),
];

impl CaptionPosition {
    pub fn parse(value: &str) -> Result<Self, DomainError> {
        CAPTION_POSITIONS
            .iter()
            .find(|(_, name)| *name == value)
            .map(|(position, _)| *position)
            .ok_or_else(|| invalid(format!("unknown caption position: {value:?}")))
    }

    pub fn as_str(self) -> &'static str {
        CAPTION_POSITIONS
            .iter()
            .find(|(position, _)| *position == self)
            .map(|(_, name)| *name)
            .expect("every CaptionPosition has a name")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_caption_is_one_line_of_text() {
        assert_eq!(
            Caption::new("Figure: login flow").unwrap().as_str(),
            "Figure: login flow"
        );
        for refused in ["", "   ", "two\nlines", "tab\there"] {
            let error = Caption::new(refused).unwrap_err();
            assert_eq!(error.kind, DomainErrorKind::InvalidCaption, "{refused:?}");
        }
        assert!(Caption::new(&"x".repeat(CAPTION_MAX_CODE_POINTS)).is_ok());
        assert!(Caption::new(&"x".repeat(CAPTION_MAX_CODE_POINTS + 1)).is_err());
    }

    #[test]
    fn a_caption_position_is_below_or_above() {
        for name in ["below", "above"] {
            assert_eq!(CaptionPosition::parse(name).unwrap().as_str(), name);
        }
        for invalid_name in ["", "Above", "left"] {
            assert_eq!(
                CaptionPosition::parse(invalid_name).unwrap_err().kind,
                DomainErrorKind::InvalidCaption
            );
        }
    }
}
