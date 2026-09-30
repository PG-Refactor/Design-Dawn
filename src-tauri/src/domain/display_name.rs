use super::constants::{DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES, DISPLAY_NAME_MAX_CODE_POINTS};
use super::error::{DomainError, DomainErrorKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayName(String);

fn invalid(detail: impl Into<String>) -> DomainError {
    DomainError::new(DomainErrorKind::InvalidDisplayName, detail)
}

fn is_forbidden_code_point(character: char) -> bool {
    let code_point = u32::from(character);
    DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES
        .iter()
        .any(|(first, last)| (*first..=*last).contains(&code_point))
}

impl DisplayName {
    /// Does not trim: normalizing user input belongs to the Application layer.
    pub fn new(value: &str) -> Result<Self, DomainError> {
        if value.is_empty() {
            return Err(invalid("empty"));
        }
        if value.chars().all(char::is_whitespace) {
            return Err(invalid("whitespace only"));
        }
        if let Some(character) = value.chars().find(|c| is_forbidden_code_point(*c)) {
            return Err(invalid(format!(
                "contains control character U+{:04X}",
                u32::from(character)
            )));
        }
        if value.chars().count() > DISPLAY_NAME_MAX_CODE_POINTS {
            return Err(invalid(format!(
                "longer than {DISPLAY_NAME_MAX_CODE_POINTS} code points"
            )));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
