/// Product name shown to users; must match `productName` in tauri.conf.json.
pub const APP_NAME: &str = "Design Dawn";

/// Label of the first window; must match `label` in tauri.conf.json.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Windows after the first are labelled `window-<n>` (docs/architecture.md §11.0.1). The
/// capability applies to `main` and `window-*`; keep `capabilities/default.json` in sync
/// (checked by tests/command_permissions.rs).
pub const WINDOW_LABEL_PREFIX: &str = "window-";

/// A new window is placed this far (logical pixels, right and down) from the window it
/// was opened from, so it does not sit exactly on top of it. Positions are not remembered
/// (docs/architecture.md §11.0.1).
pub const NEW_WINDOW_CASCADE_OFFSET: f64 = 32.0;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_name_is_not_empty() {
        assert!(!APP_NAME.is_empty());
    }
}
