use serde::{Serialize, Serializer};

use super::constants::{DEFAULT_THEME_PREFERENCE, THEME_IDS, THEME_SYSTEM};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};

/// `system` or one of `THEME_IDS`. Holds the identifier taken from the definition table,
/// so a value that is not in the table cannot exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThemePreference(&'static str);

impl ThemePreference {
    /// Case-sensitive, no trimming: the stored and transmitted form is exact.
    pub fn parse(value: &str) -> ApplicationResult<Self> {
        std::iter::once(THEME_SYSTEM)
            .chain(THEME_IDS)
            .find(|candidate| *candidate == value)
            .map(Self)
            .ok_or_else(|| {
                ApplicationError::new(
                    ErrorKind::InvalidThemePreference,
                    format!("not a theme preference: {value:?}"),
                )
            })
    }

    pub fn as_str(&self) -> &'static str {
        self.0
    }
}

impl Default for ThemePreference {
    fn default() -> Self {
        Self(DEFAULT_THEME_PREFERENCE)
    }
}

impl Serialize for ThemePreference {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0)
    }
}
