//! The webview configuration the asset protocol and the IPC boundary depend on
//! (`tauri.conf.json`). A change here that no test notices would break image display or open
//! a path from the webview to the filesystem.

use design_dawn_lib::commands::ASSET_URL_SCHEME;
use serde_json::Value;

const CONFIG_FILE: &str = include_str!("../tauri.conf.json");
/// Windows serves custom protocols as `http://<scheme>.localhost` unless `useHttpsScheme` is on.
const WINDOWS_ASSET_ORIGIN_SUFFIX: &str = ".localhost";

fn config() -> Value {
    serde_json::from_str(CONFIG_FILE).unwrap()
}

fn img_src(policy: &str) -> Vec<&str> {
    policy
        .split(';')
        .map(str::trim)
        .find_map(|directive| directive.strip_prefix("img-src "))
        .unwrap_or_else(|| panic!("no img-src in {policy}"))
        .split_whitespace()
        .collect()
}

#[test]
fn both_policies_allow_the_asset_scheme_on_every_platform() {
    let config = config();
    let security = &config["app"]["security"];
    let unix_source = format!("{ASSET_URL_SCHEME}:");
    let windows_source = format!("http://{ASSET_URL_SCHEME}{WINDOWS_ASSET_ORIGIN_SUFFIX}");
    for key in ["csp", "devCsp"] {
        let policy = security[key].as_str().unwrap();
        let sources = img_src(policy);
        assert!(sources.contains(&unix_source.as_str()), "{key}: {policy}");
        assert!(
            sources.contains(&windows_source.as_str()),
            "{key}: {policy}"
        );
    }
}

/// With `useHttpsScheme`, `convertFileSrc` yields `https://dawn-asset.localhost`, which the
/// policies above do not allow.
#[test]
fn no_window_uses_the_https_scheme() {
    let config = config();
    for window in config["app"]["windows"].as_array().unwrap() {
        assert_ne!(window["useHttpsScheme"], Value::Bool(true), "{window}");
    }
}

#[test]
fn the_webview_has_no_global_tauri_object_and_no_asset_protocol() {
    let config = config();
    assert_ne!(config["app"]["withGlobalTauri"], Value::Bool(true));
    let enabled = &config["app"]["security"]["assetProtocol"]["enable"];
    assert_ne!(*enabled, Value::Bool(true));
}

#[test]
fn the_mcp_server_looks_for_the_app_settings_under_the_configured_identifier() {
    // The MCP server finds `ai-access.json` in `<config folder>/<identifier>`, where Tauri
    // keeps the app's settings.
    assert_eq!(
        config()["identifier"],
        design_dawn_lib::application::local_state::constants::APP_IDENTIFIER
    );
}
