//! The command list in `commands::COMMAND_NAMES`, `build.rs` (app manifest) and
//! `capabilities/default.json` must stay identical, or a command would be blocked or exposed
//! without anyone noticing.

use design_dawn_lib::commands::COMMAND_NAMES;

const CAPABILITY_FILE: &str = include_str!("../capabilities/default.json");
const BUILD_SCRIPT: &str = include_str!("../build.rs");
const PERMISSION_PREFIX: &str = "allow-";
const ENGINE_PERMISSION_PREFIX: &str = "core:";

#[test]
fn capability_grants_exactly_the_exposed_commands() {
    let capability: serde_json::Value = serde_json::from_str(CAPABILITY_FILE).unwrap();
    let mut granted: Vec<String> = capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_owned())
        .filter(|permission| !permission.starts_with(ENGINE_PERMISSION_PREFIX))
        .collect();
    granted.sort();
    let mut expected: Vec<String> = COMMAND_NAMES
        .iter()
        .map(|name| format!("{PERMISSION_PREFIX}{}", name.replace('_', "-")))
        .collect();
    expected.sort();
    assert_eq!(granted, expected);
}

#[test]
fn the_app_manifest_declares_exactly_the_exposed_commands() {
    for name in COMMAND_NAMES {
        assert!(
            BUILD_SCRIPT.contains(&format!("\"{name}\"")),
            "build.rs does not declare {name}"
        );
    }
    let declared = BUILD_SCRIPT.matches("\",\n").count();
    assert_eq!(
        declared,
        COMMAND_NAMES.len(),
        "build.rs lists extra commands"
    );
}

#[test]
fn import_asset_is_not_exposed_as_a_command() {
    assert!(!COMMAND_NAMES.contains(&"import_asset"));
}
