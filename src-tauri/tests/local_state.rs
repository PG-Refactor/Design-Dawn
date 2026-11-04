//! Application Local State behaviour on a real filesystem (temporary directories). The shared validation fixtures
//! are run by `app_state_fixtures.rs`; the command boundary by `ipc_contract.rs`.

mod support;

use std::fs;
use std::path::PathBuf;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::local_state::constants::{
    DEFAULT_PROJECT_TREE_WIDTH, DEFAULT_TEXT_SIZE, LANGUAGE_IDS, LANGUAGE_SYSTEM,
    MAX_SHEET_VIEWPORT_ENTRIES, PROJECT_TREE_WIDTH_MAX, PROJECT_TREE_WIDTH_MIN, TEXT_SIZE_IDS,
    THEME_IDS, THEME_SYSTEM,
};
use design_dawn_lib::application::local_state::operations::{LocalState, LocalStateDirectories};
use design_dawn_lib::application::local_state::window_size::WindowSize;
use design_dawn_lib::infrastructure::local_state::constants::{
    SETTINGS_FILE_NAME, SHEET_VIEWPORTS_FILE_NAME,
};
use serde_json::{json, Number, Value};
use support::*;

const SECOND_PROJECT_ID: &str = "01928f3a-5b6c-7d8e-9f01-23456789abce";
const SECOND_DOCUMENT_ID: &str = "01928f3a-6c7d-7e8f-a012-3456789abcdf";

struct Fixture {
    temp: TempDir,
    state: LocalState,
    settings_path: PathBuf,
    viewports_path: PathBuf,
}

/// Both directories are nested and do not exist yet, as on a first run.
fn fixture() -> Fixture {
    let temp = TempDir::new();
    let config_dir = temp.path().join("config").join("app");
    let local_data_dir = temp.path().join("data").join("app");
    let settings_path = config_dir.join(SETTINGS_FILE_NAME);
    let viewports_path = local_data_dir.join(SHEET_VIEWPORTS_FILE_NAME);
    let state = LocalState::new(LocalStateDirectories {
        config_dir,
        local_data_dir,
    });
    Fixture {
        temp,
        state,
        settings_path,
        viewports_path,
    }
}

fn viewport(pan_x: f64, pan_y: f64, zoom: f64) -> Value {
    json!({ "panX": pan_x, "panY": pan_y, "zoom": zoom })
}

fn save(fixture: &Fixture, ids: [&str; 3], value: Value) {
    fixture
        .state
        .save_sheet_viewport(ids[0], ids[1], ids[2], value)
        .expect("save viewport");
}

fn ids() -> [&'static str; 3] {
    [PROJECT_ID, DOCUMENT_ID, OVERVIEW_SHEET_ID]
}

fn get_viewport_json(fixture: &Fixture, ids: [&str; 3]) -> Value {
    let result = fixture
        .state
        .get_sheet_viewport(ids[0], ids[1], ids[2])
        .expect("get viewport");
    serde_json::to_value(result).expect("serialize")
}

fn issue_kind(value: &Value) -> &str {
    value["loadIssue"]["kind"].as_str().expect("a load issue")
}

// ---- theme preference ----

#[test]
fn settings_default_to_system_without_an_issue_and_a_get_writes_nothing() {
    let fixture = fixture();
    let settings = fixture.state.get_app_settings();
    assert_eq!(settings.theme_preference.as_str(), THEME_SYSTEM);
    assert_eq!(settings.load_issue, None);
    assert!(!fixture.settings_path.exists());
    assert!(tree_snapshot(fixture.temp.path()).is_empty());
}

#[test]
fn every_theme_preference_round_trips() {
    for preference in std::iter::once(THEME_SYSTEM).chain(THEME_IDS) {
        let fixture = fixture();
        let set = fixture.state.set_theme_preference(preference).unwrap();
        assert_eq!(set.theme_preference.as_str(), preference);
        assert_eq!(set.load_issue, None);
        let got = fixture.state.get_app_settings();
        assert_eq!(got.theme_preference.as_str(), preference);
        assert_eq!(got.load_issue, None);
    }
}

#[test]
fn settings_file_has_exactly_the_documented_bytes() {
    let fixture = fixture();
    fixture.state.set_theme_preference("dark").unwrap();
    assert_eq!(
        fs::read(&fixture.settings_path).unwrap(),
        b"{\n  \"schemaVersion\": 7,\n  \"themePreference\": \"dark\",\n  \"languagePreference\": \"system\",\n  \"textSize\": \"medium\",\n  \"autoSave\": true,\n  \"projectTreeWidth\": 320\n}\n"
    );
}

#[test]
fn an_invalid_preference_is_rejected_and_the_file_is_unchanged() {
    let fixture = fixture();
    fixture.state.set_theme_preference("light").unwrap();
    let before = fs::read(&fixture.settings_path).unwrap();
    for invalid in ["Dark", "sepia", "", "dark "] {
        let error = fixture.state.set_theme_preference(invalid).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidThemePreference, "{invalid:?}");
    }
    assert_eq!(fs::read(&fixture.settings_path).unwrap(), before);
}

#[test]
fn an_invalid_preference_does_not_create_the_file() {
    let fixture = fixture();
    fixture.state.set_theme_preference("sepia").unwrap_err();
    assert!(tree_snapshot(fixture.temp.path()).is_empty());
}

fn assert_broken_settings(content: &[u8], expected_kind: &str) {
    let fixture = fixture();
    fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
    fs::write(&fixture.settings_path, content).unwrap();

    let settings = serde_json::to_value(fixture.state.get_app_settings()).unwrap();
    assert_eq!(settings["themePreference"], THEME_SYSTEM, "{expected_kind}");
    assert_eq!(issue_kind(&settings), expected_kind);
    assert!(!settings["loadIssue"]["detail"].as_str().unwrap().is_empty());
    assert_eq!(
        fs::read(&fixture.settings_path).unwrap(),
        content,
        "a get must not touch the broken file"
    );

    let saved = fixture.state.set_theme_preference("dark").unwrap();
    assert_eq!(saved.theme_preference.as_str(), "dark");
    let after = fixture.state.get_app_settings();
    assert_eq!(after.theme_preference.as_str(), "dark");
    assert_eq!(after.load_issue, None);
}

#[test]
fn broken_settings_files_give_defaults_with_a_load_issue_and_a_save_replaces_them() {
    assert_broken_settings(b"{ not json", "invalidJson");
    assert_broken_settings(
        b"{\"schemaVersion\":1,\"themePreference\":\"system\",\"extra\":1}",
        "invalidFileStructure",
    );
    assert_broken_settings(b"{\"schemaVersion\":1}", "invalidFileStructure");
    assert_broken_settings(
        b"{\"schemaVersion\":1,\"themePreference\":\"sepia\"}",
        "invalidThemePreference",
    );
    assert_broken_settings(
        b"{\"schemaVersion\":8,\"themePreference\":\"dark\",\"autoSave\":true}",
        "unsupportedSchemaVersion",
    );
    assert_broken_settings(
        b"{\"schemaVersion\":0,\"themePreference\":\"dark\"}",
        "invalidSchemaVersion",
    );
    assert_broken_settings(
        b"{\"schemaVersion\":2,\"themePreference\":\"dark\",\"autoSave\":\"yes\"}",
        "invalidFileStructure",
    );
    for width in ["159", "641", "-1", "320.0", "400.5", "1e2"] {
        assert_broken_settings(
            format!(
                "{{\"schemaVersion\":3,\"themePreference\":\"dark\",\"autoSave\":true,\"projectTreeWidth\":{width}}}"
            )
            .as_bytes(),
            "invalidProjectTreeWidth",
        );
    }
    assert_broken_settings(
        b"{\"schemaVersion\":3,\"themePreference\":\"dark\",\"autoSave\":true,\"projectTreeWidth\":\"wide\"}",
        "invalidFileStructure",
    );
    assert_broken_settings(
        b"{\"schemaVersion\":6,\"themePreference\":\"dark\",\"textSize\":\"huge\"}",
        "invalidTextSize",
    );
    assert_broken_settings(&[0xFF, 0xFE, 0x41], "invalidEncoding");
}

#[test]
fn a_settings_path_that_is_a_directory_is_an_io_issue() {
    let fixture = fixture();
    fs::create_dir_all(&fixture.settings_path).unwrap();
    let settings = serde_json::to_value(fixture.state.get_app_settings()).unwrap();
    assert_eq!(issue_kind(&settings), "ioError");
    assert_eq!(settings["themePreference"], THEME_SYSTEM);
}

// ---- language preference ----

#[test]
fn language_defaults_to_system() {
    let fixture = fixture();
    let settings = fixture.state.get_app_settings();
    assert_eq!(settings.language_preference.as_str(), LANGUAGE_SYSTEM);
    assert_eq!(settings.load_issue, None);
}

#[test]
fn every_language_preference_round_trips_and_keeps_the_other_settings() {
    for preference in std::iter::once(LANGUAGE_SYSTEM).chain(LANGUAGE_IDS) {
        let fixture = fixture();
        fixture.state.set_theme_preference("dark").unwrap();
        let set = fixture.state.set_language_preference(preference).unwrap();
        assert_eq!(set.language_preference.as_str(), preference);
        let got = fixture.state.get_app_settings();
        assert_eq!(got.language_preference.as_str(), preference);
        assert_eq!(got.theme_preference.as_str(), "dark");
        assert_eq!(got.load_issue, None);
        assert_eq!(
            serde_json::to_value(&got).unwrap()["languagePreference"],
            preference
        );
    }
}

#[test]
fn settings_files_before_version_5_load_with_the_system_language() {
    for content in [
        &b"{\"schemaVersion\":1,\"themePreference\":\"dark\"}"[..],
        &b"{\"schemaVersion\":3,\"themePreference\":\"dark\",\"autoSave\":false,\"projectTreeWidth\":400}"[..],
        &b"{\"schemaVersion\":4,\"themePreference\":\"dark\",\"autoSave\":true,\"projectTreeWidth\":320,\"windowSize\":{\"width\":1200,\"height\":800,\"maximized\":false}}"[..],
    ] {
        let fixture = fixture();
        fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
        fs::write(&fixture.settings_path, content).unwrap();
        let settings = fixture.state.get_app_settings();
        assert_eq!(settings.language_preference.as_str(), LANGUAGE_SYSTEM);
        assert_eq!(settings.theme_preference.as_str(), "dark");
        assert_eq!(settings.load_issue, None);
    }
}

#[test]
fn an_invalid_language_is_rejected_and_the_file_is_unchanged() {
    let fixture = fixture();
    fixture.state.set_language_preference("ja").unwrap();
    let before = fs::read(&fixture.settings_path).unwrap();
    for invalid in ["JA", "fr", "", "ja-JP", "en "] {
        let error = fixture.state.set_language_preference(invalid).unwrap_err();
        assert_eq!(
            error.kind,
            ErrorKind::InvalidLanguagePreference,
            "{invalid:?}"
        );
    }
    assert_eq!(fs::read(&fixture.settings_path).unwrap(), before);
}

#[test]
fn a_stored_invalid_language_is_a_load_issue() {
    assert_broken_settings(
        b"{\"schemaVersion\":5,\"themePreference\":\"dark\",\"languagePreference\":\"fr\"}",
        "invalidLanguagePreference",
    );
}

// ---- auto-save ----

#[test]
fn auto_save_defaults_to_on() {
    let fixture = fixture();
    assert!(fixture.state.get_app_settings().auto_save);
}

#[test]
fn a_version_1_settings_file_loads_with_auto_save_on() {
    let fixture = fixture();
    fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
    fs::write(
        &fixture.settings_path,
        b"{\"schemaVersion\":1,\"themePreference\":\"dark\"}",
    )
    .unwrap();
    let settings = fixture.state.get_app_settings();
    assert_eq!(settings.theme_preference.as_str(), "dark");
    assert!(settings.auto_save);
    assert_eq!(settings.load_issue, None);
}

// ---- text size ----

#[test]
fn text_size_defaults_to_the_default_size() {
    let fixture = fixture();
    let settings = fixture.state.get_app_settings();
    assert_eq!(settings.text_size.as_str(), DEFAULT_TEXT_SIZE);
    assert_eq!(settings.load_issue, None);
}

#[test]
fn every_text_size_round_trips_and_keeps_the_other_settings() {
    for size in TEXT_SIZE_IDS {
        let fixture = fixture();
        fixture.state.set_theme_preference("dark").unwrap();
        fixture.state.set_language_preference("ja").unwrap();
        let set = fixture.state.set_text_size(size).unwrap();
        assert_eq!(set.text_size.as_str(), size);
        let got = fixture.state.get_app_settings();
        assert_eq!(got.text_size.as_str(), size);
        assert_eq!(got.theme_preference.as_str(), "dark");
        assert_eq!(got.language_preference.as_str(), "ja");
        assert_eq!(got.load_issue, None);
        assert_eq!(serde_json::to_value(&got).unwrap()["textSize"], size);
        // Changing another setting keeps the size.
        fixture.state.set_auto_save(false).unwrap();
        assert_eq!(fixture.state.get_app_settings().text_size.as_str(), size);
    }
}

#[test]
fn settings_files_before_version_6_load_with_the_default_text_size() {
    for content in [
        &b"{\"schemaVersion\":1,\"themePreference\":\"dark\"}"[..],
        &b"{\"schemaVersion\":5,\"themePreference\":\"dark\",\"languagePreference\":\"ja\",\"autoSave\":true,\"projectTreeWidth\":320}"[..],
    ] {
        let fixture = fixture();
        fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
        fs::write(&fixture.settings_path, content).unwrap();
        let settings = fixture.state.get_app_settings();
        assert_eq!(settings.text_size.as_str(), DEFAULT_TEXT_SIZE);
        assert_eq!(settings.theme_preference.as_str(), "dark");
        assert_eq!(settings.load_issue, None);
    }
}

#[test]
fn an_invalid_text_size_is_rejected_and_the_file_is_unchanged() {
    let fixture = fixture();
    fixture.state.set_text_size("large").unwrap();
    let before = fs::read(&fixture.settings_path).unwrap();
    for invalid in ["Large", "huge", "", "system", " large"] {
        let error = fixture.state.set_text_size(invalid).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidTextSize, "{invalid:?}");
    }
    assert_eq!(fs::read(&fixture.settings_path).unwrap(), before);
}

#[test]
fn auto_save_round_trips_through_a_current_file() {
    let fixture = fixture();
    let set = fixture.state.set_auto_save(false).unwrap();
    assert!(!set.auto_save);
    assert_eq!(set.load_issue, None);
    assert!(!fixture.state.get_app_settings().auto_save);
    assert_eq!(
        read_json(&fixture.settings_path),
        json!({ "schemaVersion": 7, "themePreference": "system", "languagePreference": "system", "textSize": "medium", "autoSave": false, "projectTreeWidth": 320 })
    );
    assert!(fixture.state.set_auto_save(true).unwrap().auto_save);
    assert!(fixture.state.get_app_settings().auto_save);
}

#[test]
fn version_1_and_2_settings_files_load_with_the_default_width() {
    for content in [
        &b"{\"schemaVersion\":1,\"themePreference\":\"dark\"}"[..],
        &b"{\"schemaVersion\":2,\"themePreference\":\"dark\",\"autoSave\":false}"[..],
    ] {
        let fixture = fixture();
        fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
        fs::write(&fixture.settings_path, content).unwrap();
        let settings = fixture.state.get_app_settings();
        assert_eq!(settings.project_tree_width, DEFAULT_PROJECT_TREE_WIDTH);
        assert_eq!(settings.theme_preference.as_str(), "dark");
        assert_eq!(settings.load_issue, None);
    }
}

#[test]
fn project_tree_width_round_trips_at_the_limits_and_is_serialized_in_the_wire_form() {
    for width in [PROJECT_TREE_WIDTH_MIN, 400, PROJECT_TREE_WIDTH_MAX] {
        let fixture = fixture();
        let set = fixture
            .state
            .set_project_tree_width(&Number::from(width))
            .unwrap();
        assert_eq!(set.project_tree_width, width);
        assert_eq!(fixture.state.get_app_settings().project_tree_width, width);
        assert_eq!(read_json(&fixture.settings_path)["projectTreeWidth"], width);
        let wire = serde_json::to_value(fixture.state.get_app_settings()).unwrap();
        assert_eq!(wire["projectTreeWidth"], width);
    }
}

#[test]
fn setting_the_width_keeps_theme_and_auto_save_and_they_keep_the_width() {
    let fixture = fixture();
    fixture.state.set_theme_preference("dark").unwrap();
    fixture.state.set_auto_save(false).unwrap();
    let saved = fixture
        .state
        .set_project_tree_width(&Number::from(480))
        .unwrap();
    assert_eq!(saved.theme_preference.as_str(), "dark");
    assert!(!saved.auto_save);
    let after = fixture.state.set_auto_save(true).unwrap();
    assert_eq!(after.project_tree_width, 480);
    let after = fixture.state.set_theme_preference("light").unwrap();
    assert_eq!(after.project_tree_width, 480);
}

#[test]
fn an_invalid_width_is_rejected_and_the_file_is_unchanged() {
    let fixture = fixture();
    fixture
        .state
        .set_project_tree_width(&Number::from(400))
        .unwrap();
    let before = fs::read(&fixture.settings_path).unwrap();
    let invalid: [Number; 4] = [
        Number::from(PROJECT_TREE_WIDTH_MIN - 1),
        Number::from(PROJECT_TREE_WIDTH_MAX + 1),
        Number::from(-1),
        Number::from_f64(400.5).unwrap(),
    ];
    for width in invalid {
        let error = fixture.state.set_project_tree_width(&width).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidProjectTreeWidth, "{width}");
    }
    assert_eq!(fs::read(&fixture.settings_path).unwrap(), before);
}

#[test]
fn auto_save_and_theme_do_not_overwrite_each_other() {
    let fixture = fixture();
    fixture.state.set_theme_preference("dark").unwrap();
    let after_auto_save = fixture.state.set_auto_save(false).unwrap();
    assert_eq!(after_auto_save.theme_preference.as_str(), "dark");
    let after_theme = fixture.state.set_theme_preference("light").unwrap();
    assert_eq!(after_theme.theme_preference.as_str(), "light");
    assert!(!after_theme.auto_save);
    let got = fixture.state.get_app_settings();
    assert_eq!(got.theme_preference.as_str(), "light");
    assert!(!got.auto_save);
}

#[test]
fn setting_auto_save_upgrades_a_version_1_file_and_keeps_its_theme() {
    let fixture = fixture();
    fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
    fs::write(
        &fixture.settings_path,
        b"{\"schemaVersion\":1,\"themePreference\":\"dark\"}",
    )
    .unwrap();
    fixture.state.set_auto_save(false).unwrap();
    assert_eq!(
        read_json(&fixture.settings_path),
        json!({ "schemaVersion": 7, "themePreference": "dark", "languagePreference": "system", "textSize": "medium", "autoSave": false, "projectTreeWidth": 320 })
    );
}

#[test]
fn setting_auto_save_over_a_broken_file_replaces_it_with_defaults_for_the_theme() {
    let fixture = fixture();
    fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
    fs::write(&fixture.settings_path, b"{ not json").unwrap();
    let saved = fixture.state.set_auto_save(false).unwrap();
    assert_eq!(saved.theme_preference.as_str(), THEME_SYSTEM);
    assert!(!saved.auto_save);
    assert_eq!(fixture.state.get_app_settings().load_issue, None);
}

// ---- window size ----

fn recorded(width: u32, height: u32, maximized: bool) -> WindowSize {
    WindowSize {
        width,
        height,
        maximized,
    }
}

#[test]
fn no_window_size_is_recorded_by_default_and_the_wire_form_does_not_carry_it() {
    let fixture = fixture();
    assert_eq!(fixture.state.get_app_settings().window_size, None);
    let wire = serde_json::to_value(fixture.state.get_app_settings()).unwrap();
    assert!(wire.get("windowSize").is_none());
}

#[test]
fn version_1_to_3_settings_files_load_without_a_window_size() {
    for content in [
        &b"{\"schemaVersion\":1,\"themePreference\":\"dark\"}"[..],
        &b"{\"schemaVersion\":2,\"themePreference\":\"dark\",\"autoSave\":false}"[..],
        &b"{\"schemaVersion\":3,\"themePreference\":\"dark\",\"autoSave\":false,\"projectTreeWidth\":400}"[..],
    ] {
        let fixture = fixture();
        fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
        fs::write(&fixture.settings_path, content).unwrap();
        let settings = fixture.state.get_app_settings();
        assert_eq!(settings.window_size, None);
        assert_eq!(settings.load_issue, None);
        assert_eq!(settings.theme_preference.as_str(), "dark");
    }
}

#[test]
fn the_window_size_round_trips_and_is_written_in_the_documented_form() {
    let fixture = fixture();
    fixture
        .state
        .set_window_size(recorded(1440, 900, true))
        .unwrap();
    assert_eq!(
        fixture.state.get_app_settings().window_size,
        Some(recorded(1440, 900, true))
    );
    assert_eq!(
        read_json(&fixture.settings_path),
        json!({
            "schemaVersion": 7,
            "themePreference": "system",
            "languagePreference": "system",
            "textSize": "medium",
            "autoSave": true,
            "projectTreeWidth": 320,
            "windowSize": { "width": 1440, "height": 900, "maximized": true }
        })
    );
}

#[test]
fn recording_the_window_size_keeps_the_other_settings_and_they_keep_the_size() {
    let fixture = fixture();
    fixture.state.set_theme_preference("dark").unwrap();
    fixture.state.set_auto_save(false).unwrap();
    fixture
        .state
        .set_project_tree_width(&Number::from(480))
        .unwrap();
    let saved = fixture
        .state
        .set_window_size(recorded(1000, 700, false))
        .unwrap();
    assert_eq!(saved.theme_preference.as_str(), "dark");
    assert!(!saved.auto_save);
    assert_eq!(saved.project_tree_width, 480);
    let after = fixture.state.set_auto_save(true).unwrap();
    assert_eq!(after.window_size, Some(recorded(1000, 700, false)));
    let after = fixture.state.set_theme_preference("light").unwrap();
    assert_eq!(after.window_size, Some(recorded(1000, 700, false)));
    let after = fixture
        .state
        .set_project_tree_width(&Number::from(300))
        .unwrap();
    assert_eq!(after.window_size, Some(recorded(1000, 700, false)));
}

#[test]
fn a_null_window_size_is_read_as_not_recorded() {
    let fixture = fixture();
    fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
    fs::write(
        &fixture.settings_path,
        b"{\"schemaVersion\":4,\"themePreference\":\"dark\",\"windowSize\":null}",
    )
    .unwrap();
    let settings = fixture.state.get_app_settings();
    assert_eq!(settings.window_size, None);
    assert_eq!(settings.load_issue, None);
}

#[test]
fn an_invalid_window_size_is_a_broken_file_with_defaults_and_a_load_issue() {
    for window_size in [
        r#"{"width":399,"height":800,"maximized":false}"#,
        r#"{"width":1280,"height":299,"maximized":false}"#,
        r#"{"width":16385,"height":800,"maximized":false}"#,
        r#"{"width":1280.5,"height":800,"maximized":false}"#,
        r#"{"width":-1,"height":800,"maximized":false}"#,
    ] {
        assert_broken_settings(
            format!(
                "{{\"schemaVersion\":4,\"themePreference\":\"dark\",\"windowSize\":{window_size}}}"
            )
            .as_bytes(),
            "invalidFileStructure",
        );
    }
    for window_size in [
        r#"{"width":1280,"height":800}"#,
        r#"{"width":1280,"height":800,"maximized":"yes"}"#,
        r#"{"width":1280,"height":800,"maximized":false,"x":1}"#,
        r#""big""#,
    ] {
        assert_broken_settings(
            format!(
                "{{\"schemaVersion\":4,\"themePreference\":\"dark\",\"windowSize\":{window_size}}}"
            )
            .as_bytes(),
            "invalidFileStructure",
        );
    }
}

#[test]
fn a_broken_file_gives_no_window_size() {
    let fixture = fixture();
    fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
    fs::write(&fixture.settings_path, b"{ not json").unwrap();
    assert_eq!(fixture.state.get_app_settings().window_size, None);
}

// ---- sheet viewports ----

#[test]
fn an_unsaved_key_has_no_viewport_and_a_get_writes_nothing() {
    let fixture = fixture();
    assert_eq!(
        get_viewport_json(&fixture, ids()),
        json!({ "viewport": null, "loadIssue": null })
    );
    assert!(tree_snapshot(fixture.temp.path()).is_empty());
}

#[test]
fn a_saved_viewport_is_returned() {
    let fixture = fixture();
    save(&fixture, ids(), viewport(120.5, -48.0, 1.25));
    assert_eq!(
        get_viewport_json(&fixture, ids()),
        json!({ "viewport": { "panX": 120.5, "panY": -48.0, "zoom": 1.25 }, "loadIssue": null })
    );
}

#[test]
fn viewports_file_has_exactly_the_documented_bytes() {
    let fixture = fixture();
    save(&fixture, ids(), viewport(120.5, -48.0, 1.25));
    let expected = format!(
        "{{\n  \"schemaVersion\": 1,\n  \"viewports\": [\n    {{\n      \"projectId\": \"{PROJECT_ID}\",\n      \"documentId\": \"{DOCUMENT_ID}\",\n      \"sheetId\": \"{OVERVIEW_SHEET_ID}\",\n      \"panX\": 120.5,\n      \"panY\": -48,\n      \"zoom\": 1.25\n    }}\n  ]\n}}\n"
    );
    assert_eq!(
        fs::read_to_string(&fixture.viewports_path).unwrap(),
        expected
    );
}

#[test]
fn viewports_are_separated_by_project_document_and_sheet() {
    let fixture = fixture();
    let keys = [
        ids(),
        [SECOND_PROJECT_ID, DOCUMENT_ID, OVERVIEW_SHEET_ID],
        [PROJECT_ID, SECOND_DOCUMENT_ID, OVERVIEW_SHEET_ID],
        [PROJECT_ID, DOCUMENT_ID, DETAILS_SHEET_ID],
    ];
    for (index, key) in keys.iter().enumerate() {
        save(&fixture, *key, viewport(index as f64, 0.0, 1.0));
    }
    for (index, key) in keys.iter().enumerate() {
        assert_eq!(
            get_viewport_json(&fixture, *key)["viewport"]["panX"],
            json!(index as f64),
            "{key:?}"
        );
    }
}

#[test]
fn saving_an_existing_key_moves_it_to_the_end_without_duplicates() {
    let fixture = fixture();
    let other = [PROJECT_ID, DOCUMENT_ID, DETAILS_SHEET_ID];
    save(&fixture, ids(), viewport(1.0, 0.0, 1.0));
    save(&fixture, other, viewport(2.0, 0.0, 1.0));
    save(&fixture, ids(), viewport(3.0, 0.0, 2.0));

    let file = read_json(&fixture.viewports_path);
    let entries = file["viewports"].as_array().unwrap();
    let sheet_ids: Vec<&str> = entries
        .iter()
        .map(|entry| entry["sheetId"].as_str().unwrap())
        .collect();
    assert_eq!(sheet_ids, [DETAILS_SHEET_ID, OVERVIEW_SHEET_ID]);
    assert_eq!(entries[1]["panX"], json!(3));
    assert_eq!(entries[1]["zoom"], json!(2));
}

#[test]
fn the_oldest_entries_are_dropped_beyond_the_limit() {
    let fixture = fixture();
    // Written directly: saving 1000 entries one command at a time would only test the loop.
    let numbered_sheet_id = |number: usize| format!("01928f3a-0000-7000-8000-{number:012x}");
    let entries: Vec<Value> = (0..MAX_SHEET_VIEWPORT_ENTRIES)
        .map(|number| {
            json!({
                "projectId": PROJECT_ID, "documentId": DOCUMENT_ID,
                "sheetId": numbered_sheet_id(number),
                "panX": 0, "panY": 0, "zoom": 1
            })
        })
        .collect();
    fs::create_dir_all(fixture.viewports_path.parent().unwrap()).unwrap();
    write_json(
        &fixture.viewports_path,
        &json!({ "schemaVersion": 1, "viewports": entries }),
    );

    save(&fixture, ids(), viewport(5.0, 0.0, 1.0));

    let file = read_json(&fixture.viewports_path);
    let saved = file["viewports"].as_array().unwrap();
    assert_eq!(saved.len(), MAX_SHEET_VIEWPORT_ENTRIES);
    assert_eq!(saved[0]["sheetId"], json!(numbered_sheet_id(1)));
    assert_eq!(saved.last().unwrap()["sheetId"], json!(OVERVIEW_SHEET_ID));
    assert_eq!(
        get_viewport_json(&fixture, [PROJECT_ID, DOCUMENT_ID, &numbered_sheet_id(0)])["viewport"],
        Value::Null
    );
}

#[test]
fn invalid_input_is_rejected_and_nothing_is_written() {
    let fixture = fixture();
    let cases = [
        (ids(), viewport(0.0, 0.0, 0.09), ErrorKind::InvalidViewport),
        (ids(), viewport(0.0, 0.0, 8.01), ErrorKind::InvalidViewport),
        (
            ids(),
            viewport(1e11 + 1e5, 0.0, 1.0),
            ErrorKind::InvalidViewport,
        ),
        (
            ids(),
            json!({ "panX": 0, "panY": 0 }),
            ErrorKind::Persistence(
                design_dawn_lib::infrastructure::error::PersistenceErrorKind::InvalidFileStructure,
            ),
        ),
        (
            ids(),
            json!({ "panX": "0", "panY": 0, "zoom": 1 }),
            ErrorKind::Persistence(
                design_dawn_lib::infrastructure::error::PersistenceErrorKind::InvalidFileStructure,
            ),
        ),
        (
            ["not-an-id", DOCUMENT_ID, OVERVIEW_SHEET_ID],
            viewport(0.0, 0.0, 1.0),
            ErrorKind::Domain(design_dawn_lib::domain::error::DomainErrorKind::InvalidEntityId),
        ),
    ];
    for (key, payload, expected) in cases {
        let error = fixture
            .state
            .save_sheet_viewport(key[0], key[1], key[2], payload.clone())
            .unwrap_err();
        assert_eq!(error.kind, expected, "{payload}");
    }
    let error = fixture
        .state
        .get_sheet_viewport("x", DOCUMENT_ID, OVERVIEW_SHEET_ID)
        .unwrap_err();
    assert_eq!(error.kind.as_str(), "invalidEntityId");
    assert!(tree_snapshot(fixture.temp.path()).is_empty());
}

fn assert_broken_viewports(content: &[u8], expected_kind: &str) {
    let fixture = fixture();
    fs::create_dir_all(fixture.viewports_path.parent().unwrap()).unwrap();
    fs::write(&fixture.viewports_path, content).unwrap();

    assert_eq!(
        issue_kind(&get_viewport_json(&fixture, ids())),
        expected_kind
    );
    assert_eq!(get_viewport_json(&fixture, ids())["viewport"], Value::Null);
    assert_eq!(
        fs::read(&fixture.viewports_path).unwrap(),
        content,
        "a get must not touch the broken file"
    );

    save(&fixture, ids(), viewport(7.0, 0.0, 1.0));
    let after = get_viewport_json(&fixture, ids());
    assert_eq!(after["loadIssue"], Value::Null);
    assert_eq!(after["viewport"]["panX"], json!(7.0));
    assert_eq!(
        read_json(&fixture.viewports_path)["viewports"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "the broken file is replaced, not merged"
    );
}

fn entry_text(overrides: &str) -> String {
    format!(
        "{{\"schemaVersion\":1,\"viewports\":[{{\"projectId\":\"{PROJECT_ID}\",\"documentId\":\"{DOCUMENT_ID}\",\"sheetId\":\"{OVERVIEW_SHEET_ID}\",{overrides}}}]}}"
    )
}

#[test]
fn broken_viewport_files_give_defaults_with_a_load_issue_and_a_save_replaces_them() {
    assert_broken_viewports(b"[1,", "invalidJson");
    assert_broken_viewports(
        b"{\"schemaVersion\":1,\"viewports\":[],\"extra\":true}",
        "invalidFileStructure",
    );
    assert_broken_viewports(
        entry_text("\"panX\":0,\"panY\":0,\"zoom\":1,\"extra\":1").as_bytes(),
        "invalidFileStructure",
    );
    assert_broken_viewports(
        entry_text("\"panX\":0,\"panY\":0,\"zoom\":99").as_bytes(),
        "invalidViewport",
    );
    assert_broken_viewports(
        b"{\"schemaVersion\":1,\"viewports\":[{\"projectId\":\"x\",\"documentId\":\"x\",\"sheetId\":\"x\",\"panX\":0,\"panY\":0,\"zoom\":1}]}",
        "invalidEntityId",
    );
    assert_broken_viewports(
        b"{\"schemaVersion\":2,\"viewports\":[]}",
        "unsupportedSchemaVersion",
    );
    assert_broken_viewports(&[0xFF, 0xFE], "invalidEncoding");
}

#[test]
fn only_the_two_injected_directories_are_written() {
    let fixture = fixture();
    fixture.state.set_theme_preference("dark").unwrap();
    save(&fixture, ids(), viewport(1.0, 2.0, 1.0));

    let written: Vec<String> = tree_snapshot(fixture.temp.path())
        .into_iter()
        .filter(|(_, content)| content.is_some())
        .map(|(path, _)| path)
        .collect();
    assert_eq!(
        written,
        [
            format!("config/app/{SETTINGS_FILE_NAME}"),
            format!("data/app/{SHEET_VIEWPORTS_FILE_NAME}"),
        ]
    );
}

#[test]
fn concurrent_saves_of_different_sheets_do_not_lose_updates() {
    let fixture = fixture();
    let sheet_ids: Vec<String> = (0..16)
        .map(|number| format!("01928f3a-0000-7000-8000-{number:012x}"))
        .collect();
    std::thread::scope(|scope| {
        for sheet_id in &sheet_ids {
            let state = &fixture.state;
            scope.spawn(move || {
                state
                    .save_sheet_viewport(PROJECT_ID, DOCUMENT_ID, sheet_id, viewport(1.0, 1.0, 1.0))
                    .unwrap();
            });
        }
    });
    assert_eq!(
        read_json(&fixture.viewports_path)["viewports"]
            .as_array()
            .unwrap()
            .len(),
        sheet_ids.len()
    );
}

// ---- theme settings and project data ----

#[test]
fn theme_operations_leave_an_open_project_untouched_and_write_only_to_the_config_dir() {
    let opened = open_copy();
    let project_before = tree_snapshot(&opened.root);
    let fixture = fixture();

    fixture.state.get_app_settings();
    for preference in std::iter::once(THEME_SYSTEM).chain(THEME_IDS) {
        fixture.state.set_theme_preference(preference).unwrap();
        fixture.state.get_app_settings();
    }

    assert_eq!(tree_snapshot(&opened.root), project_before);
    let written: Vec<String> = tree_snapshot(fixture.temp.path()).into_keys().collect();
    assert!(
        written
            .iter()
            .all(|path| path == "config" || path.starts_with("config/")),
        "unexpected writes: {written:?}"
    );
    assert!(fixture.settings_path.exists());
}

#[test]
fn the_last_project_folder_round_trips_and_keeps_the_other_settings() {
    let fixture = fixture();
    fixture.state.set_auto_save(false).unwrap();
    assert_eq!(fixture.state.get_app_settings().last_project_folder, None);
    let folder = PathBuf::from("/projects/order-service");
    fixture.state.set_last_project_folder(&folder).unwrap();
    let settings = fixture.state.get_app_settings();
    assert_eq!(settings.last_project_folder, Some(folder));
    assert!(!settings.auto_save);
    assert_eq!(
        read_json(&fixture.settings_path)["lastProjectFolder"],
        json!("/projects/order-service")
    );
    // Changing another setting keeps it.
    fixture.state.set_auto_save(true).unwrap();
    assert!(fixture
        .state
        .get_app_settings()
        .last_project_folder
        .is_some());
}

#[test]
fn a_version_6_settings_file_loads_without_a_last_project_folder() {
    let fixture = fixture();
    fs::create_dir_all(fixture.settings_path.parent().unwrap()).unwrap();
    fs::write(
        &fixture.settings_path,
        json!({ "schemaVersion": 6, "themePreference": "dark", "languagePreference": "system", "textSize": "medium", "autoSave": true, "projectTreeWidth": 320 }).to_string(),
    )
    .unwrap();
    let settings = fixture.state.get_app_settings();
    assert_eq!(settings.load_issue, None);
    assert_eq!(settings.theme_preference.as_str(), "dark");
    assert_eq!(settings.last_project_folder, None);
}
