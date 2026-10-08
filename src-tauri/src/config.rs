/// Product name shown to users; must match `productName` in tauri.conf.json.
pub const APP_NAME: &str = "Design Dawn";

/// Label of the first window; must match `label` in tauri.conf.json.
pub const MAIN_WINDOW_LABEL: &str = "main";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_name_is_not_empty() {
        assert!(!APP_NAME.is_empty());
    }
}
