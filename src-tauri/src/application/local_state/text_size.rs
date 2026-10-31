use serde::{Serialize, Serializer};

use super::constants::{DEFAULT_TEXT_SIZE, TEXT_SIZE_IDS};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};

/// One of `TEXT_SIZE_IDS`. Holds the identifier taken from the definition table, so a
/// value that is not in the table cannot exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextSize(&'static str);

impl TextSize {
    /// Case-sensitive, no trimming: the stored and transmitted form is exact.
    pub fn parse(value: &str) -> ApplicationResult<Self> {
        TEXT_SIZE_IDS
            .into_iter()
            .find(|candidate| *candidate == value)
            .map(Self)
            .ok_or_else(|| {
                ApplicationError::new(
                    ErrorKind::InvalidTextSize,
                    format!("not a text size: {value:?}"),
                )
            })
    }

    pub fn as_str(&self) -> &'static str {
        self.0
    }
}

impl Default for TextSize {
    fn default() -> Self {
        Self(DEFAULT_TEXT_SIZE)
    }
}

impl Serialize for TextSize {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_defined_id_parses_and_the_default_is_one_of_them() {
        for id in TEXT_SIZE_IDS {
            assert_eq!(TextSize::parse(id).unwrap().as_str(), id);
        }
        assert!(TEXT_SIZE_IDS.contains(&TextSize::default().as_str()));
    }

    #[test]
    fn other_values_are_invalid_text_sizes() {
        for value in ["", "Medium", " medium", "huge", "system"] {
            let error = TextSize::parse(value).unwrap_err();
            assert_eq!(error.kind, ErrorKind::InvalidTextSize);
        }
    }
}
