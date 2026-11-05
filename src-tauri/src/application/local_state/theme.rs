use serde::{Serialize, Serializer};

use super::constants::{DARK_THEME_IDS, DEFAULT_THEME_PREFERENCE, THEME_IDS, THEME_SYSTEM};

/// How the window's own title bar is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowAppearance {
    Light,
    Dark,
}
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

    /// The title bar for this preference; `None` follows the OS (`system`).
    pub fn window_appearance(&self) -> Option<WindowAppearance> {
        if self.0 == THEME_SYSTEM {
            None
        } else if DARK_THEME_IDS.contains(&self.0) {
            Some(WindowAppearance::Dark)
        } else {
            Some(WindowAppearance::Light)
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_title_bar_follows_the_os_for_system_and_the_theme_otherwise() {
        let appearance = |value| ThemePreference::parse(value).unwrap().window_appearance();
        assert_eq!(appearance("system"), None);
        assert_eq!(appearance("light"), Some(WindowAppearance::Light));
        assert_eq!(appearance("dark"), Some(WindowAppearance::Dark));
    }
}
