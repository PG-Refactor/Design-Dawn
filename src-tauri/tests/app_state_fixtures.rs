//! Runs the shared fixtures in `fixtures/app-state/` against the Rust local state validators
//! (docs/testing.md §8, §12). The viewport goes through the same JSON -> DTO -> validation
//! path as the `save_sheet_viewport` payload.

use design_dawn_lib::application::error::ApplicationError;
use design_dawn_lib::application::local_state::operations::parse_viewport_payload;
use design_dawn_lib::application::local_state::theme::ThemePreference;
use serde_json::Value;

const CURRENT_LANGUAGE: &str = "rust";
const KNOWN_LANGUAGES: [&str; 2] = ["ts", "rust"];
const SUPPORTED_FIXTURE_VERSION: i64 = 1;
const FIXTURE_DIRECTORY: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/app-state");

macro_rules! fixture {
    ($file:literal) => {
        (
            $file,
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../fixtures/app-state/",
                $file
            )),
        )
    };
}

const FIXTURE_FILES: [(&str, &str); 2] =
    [fixture!("theme-preference.json"), fixture!("viewport.json")];

/// Outer `Err` means the fixture itself is malformed; inner is the validator's verdict.
type Verdict = Result<Result<(), ApplicationError>, String>;

fn run_subject(subject: &str, input: &Value) -> Verdict {
    match subject {
        "themePreference" => {
            let text = input.as_str().ok_or("input is not a string")?;
            Ok(ThemePreference::parse(text).map(|_| ()))
        }
        "viewport" => Ok(parse_viewport_payload(input.clone()).map(|_| ())),
        other => Err(format!("unknown subject {other:?}")),
    }
}

fn applies_to_rust(case: &Value) -> Result<bool, String> {
    let Some(targets) = case.get("targets") else {
        return Ok(true);
    };
    let targets = targets.as_array().ok_or("targets is not an array")?;
    let mut applies = false;
    for target in targets {
        let target = target.as_str().ok_or("target is not a string")?;
        if !KNOWN_LANGUAGES.contains(&target) {
            return Err(format!("unknown target {target:?}"));
        }
        applies |= target == CURRENT_LANGUAGE;
    }
    Ok(applies)
}

fn check_case(subject: &str, case: &Value) -> Result<(), String> {
    let input = case.get("input").ok_or("missing input")?;
    let expected = case.get("expected").ok_or("missing expected")?;
    let verdict = run_subject(subject, input)?;
    match (expected.get("result").and_then(Value::as_str), verdict) {
        (Some("accept"), Ok(())) => Ok(()),
        (Some("accept"), Err(error)) => Err(format!("expected accept, got {error}")),
        (Some("reject"), Ok(())) => Err("expected reject, got accept".to_owned()),
        (Some("reject"), Err(error)) => {
            let expected_kind = expected
                .get("errorKind")
                .and_then(Value::as_str)
                .ok_or("missing errorKind")?;
            if error.kind.as_str() == expected_kind {
                Ok(())
            } else {
                Err(format!("expected {expected_kind}, got {error}"))
            }
        }
        _ => Err("unknown expected result".to_owned()),
    }
}

#[test]
fn every_fixture_file_is_covered_by_the_runner() {
    let mut on_disk: Vec<String> = std::fs::read_dir(FIXTURE_DIRECTORY)
        .expect("fixture directory is readable")
        .map(|entry| {
            entry
                .expect("directory entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    on_disk.sort();
    let mut included: Vec<String> = FIXTURE_FILES
        .iter()
        .map(|(name, _)| (*name).to_owned())
        .collect();
    included.sort();
    assert_eq!(on_disk, included, "add new fixture files to FIXTURE_FILES");
}

#[test]
fn app_state_fixtures_match_expectations() {
    let mut executed = 0;
    let mut failures = Vec::new();
    for (file_name, content) in FIXTURE_FILES {
        let fixture: Value = serde_json::from_str(content).expect("valid fixture JSON");
        assert_eq!(
            fixture["fixtureVersion"].as_i64(),
            Some(SUPPORTED_FIXTURE_VERSION),
            "{file_name}"
        );
        let subject = fixture["subject"].as_str().expect("subject");
        for case in fixture["cases"].as_array().expect("cases") {
            let label = format!("{file_name} / {subject}: {}", case["name"]);
            match applies_to_rust(case) {
                Ok(false) => continue,
                Ok(true) => {
                    executed += 1;
                    if let Err(message) = check_case(subject, case) {
                        failures.push(format!("{label}: {message}"));
                    }
                }
                Err(message) => failures.push(format!("{label}: fixture error: {message}")),
            }
        }
    }
    println!("app-state fixture cases executed: {executed}");
    assert!(executed > 0, "no fixture case was executed");
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
