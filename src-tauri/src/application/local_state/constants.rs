//! Single source of truth for local state values. The viewport limits are also
//! Canvas configuration: TypeScript mirrors them in `src/config/canvas-config.ts`, and the
//! shared fixtures (`fixtures/app-state/`) keep the two in sync.

/// Preference that follows the OS theme.
pub const THEME_SYSTEM: &str = "system";
/// Theme definition table: adding a theme means adding its id here (`ThemePreference` is
/// `system` plus these ids). Mirrors `THEME_DEFINITIONS` in `src/application/local-state/theme.ts`.
pub const THEME_IDS: [&str; 2] = ["light", "dark"];
pub const DEFAULT_THEME_PREFERENCE: &str = THEME_SYSTEM;

pub const VIEWPORT_PAN_LIMIT: f64 = 100_000_000_000.0;
pub const VIEWPORT_ZOOM_MIN: f64 = 0.1;
pub const VIEWPORT_ZOOM_MAX: f64 = 8.0;

/// Oldest saved viewports are dropped beyond this, so the file cannot grow without bound.
pub const MAX_SHEET_VIEWPORT_ENTRIES: usize = 1000;
