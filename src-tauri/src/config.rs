/// Product name shown to users; must match `productName` in tauri.conf.json.
pub const APP_NAME: &str = "Design Dawn";

/// Label of the first window; must match `label` in tauri.conf.json.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Windows after the first are labelled `window-<n>`. The
/// capability applies to `main` and `window-*`; keep `capabilities/default.json` in sync
/// (checked by tests/command_permissions.rs).
pub const WINDOW_LABEL_PREFIX: &str = "window-";

/// A new window is placed this far (logical pixels, right and down) from the window it
/// was opened from, so it does not sit exactly on top of it. Positions are not remembered.
pub const NEW_WINDOW_CASCADE_OFFSET: f64 = 32.0;

/// The largest Document hand-over (its JSON, as the Frontend sent it) Rust keeps for the
/// receiving window. A Document's loaded texts and history travel in it; this bounds the
/// memory one hand-over can take.
pub const DOCUMENT_TRANSFER_MAX_BYTES: usize = 64 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_name_is_not_empty() {
        assert!(!APP_NAME.is_empty());
    }
}
