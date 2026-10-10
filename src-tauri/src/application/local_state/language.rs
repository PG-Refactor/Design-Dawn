use serde::{Serialize, Serializer};

use super::constants::{DEFAULT_LANGUAGE_PREFERENCE, LANGUAGE_IDS, LANGUAGE_SYSTEM};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};

/// `system` or one of `LANGUAGE_IDS`. Holds the identifier taken from the definition
/// table, so a value that is not in the table cannot exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LanguagePreference(&'static str);

impl LanguagePreference {
    /// Case-sensitive, no trimming: the stored and transmitted form is exact.
    pub fn parse(value: &str) -> ApplicationResult<Self> {
        std::iter::once(LANGUAGE_SYSTEM)
            .chain(LANGUAGE_IDS)
            .find(|candidate| *candidate == value)
            .map(Self)
            .ok_or_else(|| {
                ApplicationError::new(
                    ErrorKind::InvalidLanguagePreference,
                    format!("not a language preference: {value:?}"),
                )
            })
    }

    pub fn as_str(&self) -> &'static str {
        self.0
    }
}

impl Default for LanguagePreference {
    fn default() -> Self {
        Self(DEFAULT_LANGUAGE_PREFERENCE)
    }
}

impl Serialize for LanguagePreference {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0)
    }
}
