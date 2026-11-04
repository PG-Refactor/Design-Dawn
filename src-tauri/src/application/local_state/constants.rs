//! Single source of truth for local state values. The viewport limits are also
//! Canvas configuration: TypeScript mirrors them in `src/config/canvas-config.ts`, and the
//! shared fixtures (`fixtures/app-state/`) keep the two in sync.

/// Preference that follows the OS theme.
pub const THEME_SYSTEM: &str = "system";
/// Theme definition table: adding a theme means adding its id here (`ThemePreference` is
/// `system` plus these ids). Mirrors `THEME_DEFINITIONS` in `src/application/local-state/theme.ts`.
pub const THEME_IDS: [&str; 2] = ["light", "dark"];
pub const DEFAULT_THEME_PREFERENCE: &str = THEME_SYSTEM;

/// Preference that follows the WebView's language (resolved in the Frontend).
pub const LANGUAGE_SYSTEM: &str = "system";
/// Display languages. Mirrors `LANGUAGE_PREFERENCES` in `src/config/language-config.ts`.
pub const LANGUAGE_IDS: [&str; 2] = ["en", "ja"];
pub const DEFAULT_LANGUAGE_PREFERENCE: &str = LANGUAGE_SYSTEM;

/// Text size of the application's own UI (not of the Document content). Mirrors
/// `TEXT_SIZES` in `src/config/text-size-config.ts`, which also maps each id to a size.
pub const TEXT_SIZE_IDS: [&str; 4] = ["small", "medium", "large", "xlarge"];
pub const DEFAULT_TEXT_SIZE: &str = "medium";

/// Mirrors `DEFAULT_AUTO_SAVE_ENABLED` in `src/config/app-config.ts` (or wherever TS keeps it).
pub const DEFAULT_AUTO_SAVE: bool = true;

/// Width of the Project Tree panel in CSS pixels. Mirrors `PROJECT_TREE_WIDTH_MIN_PX` /
/// `_MAX_PX` / `DEFAULT_PROJECT_TREE_WIDTH_PX` in `src/config/layout-config.ts`; the shared
/// fixtures (`fixtures/ipc/`) keep the two in sync.
pub const PROJECT_TREE_WIDTH_MIN: u32 = 160;
pub const PROJECT_TREE_WIDTH_MAX: u32 = 640;
pub const DEFAULT_PROJECT_TREE_WIDTH: u32 = 320;

pub const VIEWPORT_PAN_LIMIT: f64 = 100_000_000_000.0;
pub const VIEWPORT_ZOOM_MIN: f64 = 0.1;
pub const VIEWPORT_ZOOM_MAX: f64 = 8.0;

/// Oldest saved viewports are dropped beyond this, so the file cannot grow without bound.
pub const MAX_SHEET_VIEWPORT_ENTRIES: usize = 1000;

/// Window size limits in logical pixels for the recorded size (`settings.json` `windowSize`).
/// Wide enough for any real display; they only keep a hand-edited file sane.
pub const WINDOW_WIDTH_MIN: u32 = 400;
pub const WINDOW_WIDTH_MAX: u32 = 16_384;
pub const WINDOW_HEIGHT_MIN: u32 = 300;
pub const WINDOW_HEIGHT_MAX: u32 = 16_384;

/// Projects kept in `ai-access.json`; the ones opened longest ago are dropped beyond this,
/// so the list stays short enough to read and cannot grow without bound.
pub const MAX_AI_ACCESS_PROJECTS: usize = 50;

/// The file name of the MCP server without its platform suffix (`.exe` on Windows). It is
/// installed next to the app, so the app finds it beside its own executable. Must match
/// the `[[bin]]` name of `design-dawn-mcp` in Cargo.toml.
pub const MCP_SERVER_EXECUTABLE_STEM: &str = "design-dawn-mcp";

/// The app's identifier, which names its settings folder (`<OS config folder>/<identifier>`,
/// where Tauri puts `settings.json` and `ai-access.json`). The MCP server finds the app's
/// AI access list there. Must equal `identifier` in tauri.conf.json (checked by a test).
pub const APP_IDENTIFIER: &str = "com.pgrefactor.designdawn";
