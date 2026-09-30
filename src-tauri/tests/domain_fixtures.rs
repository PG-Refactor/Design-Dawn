//! Runs the shared fixtures in `fixtures/domain/` against the Rust domain (docs/testing.md §8).

use design_dawn_lib::domain::block::{Block, BlockInput};
use design_dawn_lib::domain::block_type::BlockType;
use design_dawn_lib::domain::content_path::ContentPath;
use design_dawn_lib::domain::display_name::DisplayName;
use design_dawn_lib::domain::document::{Document, DocumentInput};
use design_dawn_lib::domain::entity_id::ProjectId;
use design_dawn_lib::domain::error::DomainError;
use design_dawn_lib::domain::geometry::{Position, Size};
use design_dawn_lib::domain::project::{Project, ProjectInput};
use design_dawn_lib::domain::schema_version::{SchemaEntityKind, SchemaVersion};
use design_dawn_lib::domain::sheet::{Sheet, SheetInput};
use serde_json::Value;

const CURRENT_LANGUAGE: &str = "rust";
const KNOWN_LANGUAGES: [&str; 2] = ["ts", "rust"];
const SUPPORTED_FIXTURE_VERSION: i64 = 1;
const FIXTURE_DIRECTORY: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/domain");

macro_rules! fixture {
    ($file:literal) => {
        (
            $file,
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../fixtures/domain/",
                $file
            )),
        )
    };
}

const FIXTURE_FILES: [(&str, &str); 8] = [
    fixture!("block-type.json"),
    fixture!("content-path.json"),
    fixture!("display-name.json"),
    fixture!("entity-id.json"),
    fixture!("entity.json"),
    fixture!("position.json"),
    fixture!("schema-version.json"),
    fixture!("size.json"),
];

/// Outer `Err` means the fixture itself is malformed; inner is the domain verdict.
type Verdict = Result<Result<(), DomainError>, String>;

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a Value, String> {
    value.get(key).ok_or_else(|| format!("missing key {key:?}"))
}

fn text(value: &Value, key: &str) -> Result<String, String> {
    field(value, key)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("{key:?} is not a string"))
}

fn integer(value: &Value, key: &str) -> Result<i64, String> {
    field(value, key)?
        .as_i64()
        .ok_or_else(|| format!("{key:?} is not an integer"))
}

fn text_list(value: &Value, key: &str) -> Result<Vec<String>, String> {
    field(value, key)?
        .as_array()
        .ok_or_else(|| format!("{key:?} is not an array"))?
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("{key:?} contains a non-string"))
        })
        .collect()
}

fn block_input(value: &Value) -> Result<BlockInput, String> {
    let position = field(value, "position")?;
    let size = field(value, "size")?;
    Ok(BlockInput {
        block_id: text(value, "blockId")?,
        block_type: text(value, "blockType")?,
        x: integer(position, "x")?,
        y: integer(position, "y")?,
        width: integer(size, "width")?,
        height: integer(size, "height")?,
        content_path: text(value, "contentPath")?,
    })
}

fn schema_entity(name: &str) -> Result<SchemaEntityKind, String> {
    match name {
        "project" => Ok(SchemaEntityKind::Project),
        "document" => Ok(SchemaEntityKind::Document),
        "sheet" => Ok(SchemaEntityKind::Sheet),
        other => Err(format!("unknown schema entity {other:?}")),
    }
}

fn run_entity(input: &Value) -> Verdict {
    let entity = text(input, "entity")?;
    let value = field(input, "value")?;
    let verdict = match entity.as_str() {
        "project" => Project::new(&ProjectInput {
            schema_version: integer(value, "schemaVersion")?,
            project_id: text(value, "projectId")?,
            name: text(value, "name")?,
            document_order: text_list(value, "documentOrder")?,
        })
        .map(|_| ()),
        "document" => Document::new(&DocumentInput {
            schema_version: integer(value, "schemaVersion")?,
            document_id: text(value, "documentId")?,
            name: text(value, "name")?,
            sheet_order: text_list(value, "sheetOrder")?,
        })
        .map(|_| ()),
        "sheet" => {
            let blocks = field(value, "blocks")?
                .as_array()
                .ok_or("\"blocks\" is not an array")?
                .iter()
                .map(block_input)
                .collect::<Result<Vec<_>, _>>()?;
            Sheet::new(&SheetInput {
                schema_version: integer(value, "schemaVersion")?,
                sheet_id: text(value, "sheetId")?,
                name: text(value, "name")?,
                blocks,
            })
            .map(|_| ())
        }
        "block" => Block::new(&block_input(value)?).map(|_| ()),
        other => return Err(format!("unknown entity kind {other:?}")),
    };
    Ok(verdict)
}

fn run_subject(subject: &str, input: &Value) -> Verdict {
    let verdict = match subject {
        "entityId" => ProjectId::parse(input.as_str().ok_or("input is not a string")?).map(|_| ()),
        "displayName" => {
            DisplayName::new(input.as_str().ok_or("input is not a string")?).map(|_| ())
        }
        "position" => Position::new(integer(input, "x")?, integer(input, "y")?).map(|_| ()),
        "size" => Size::new(integer(input, "width")?, integer(input, "height")?).map(|_| ()),
        "blockType" => BlockType::parse(input.as_str().ok_or("input is not a string")?).map(|_| ()),
        "schemaVersion" => SchemaVersion::parse(
            schema_entity(&text(input, "entity")?)?,
            integer(input, "value")?,
        )
        .map(|_| ()),
        "contentPath" => {
            // Mirrors production order: the block type is validated before the path.
            match BlockType::parse(&text(input, "blockType")?) {
                Ok(block_type) => ContentPath::parse(block_type, &text(input, "path")?).map(|_| ()),
                Err(error) => Err(error),
            }
        }
        "entity" => return run_entity(input),
        other => return Err(format!("unknown subject {other:?}")),
    };
    Ok(verdict)
}

fn targets_of(case: &Value) -> Result<Vec<String>, String> {
    match case.get("targets") {
        None => Ok(KNOWN_LANGUAGES.iter().map(|t| (*t).to_owned()).collect()),
        Some(_) => text_list(case, "targets"),
    }
}

fn check_expectation(case: &Value, verdict: Result<(), DomainError>) -> Result<(), String> {
    let expected = field(case, "expected")?;
    match (text(expected, "result")?.as_str(), verdict) {
        ("accept", Ok(())) => Ok(()),
        ("accept", Err(error)) => Err(format!("expected accept, got {error}")),
        ("reject", Ok(())) => Err("expected reject, got accept".to_owned()),
        ("reject", Err(error)) => {
            let expected_kind = text(expected, "errorKind")?;
            if error.kind.as_str() == expected_kind {
                Ok(())
            } else {
                Err(format!("expected {expected_kind}, got {error}"))
            }
        }
        (other, _) => Err(format!("unknown expected result {other:?}")),
    }
}

/// Returns `Some(result)` when the case applies to Rust, `None` when it is skipped.
fn run_case(subject: &str, case: &Value) -> Result<Option<Result<(), String>>, String> {
    let targets = targets_of(case)?;
    if let Some(unknown) = targets
        .iter()
        .find(|t| !KNOWN_LANGUAGES.contains(&t.as_str()))
    {
        return Err(format!("unknown target {unknown:?}"));
    }
    if !targets.iter().any(|t| t == CURRENT_LANGUAGE) {
        return Ok(None);
    }
    let verdict = run_subject(subject, field(case, "input")?)?;
    Ok(Some(check_expectation(case, verdict)))
}

#[derive(Default)]
struct Totals {
    executed: usize,
    skipped: usize,
    failures: Vec<String>,
}

fn run_file(file_name: &str, content: &str, totals: &mut Totals) {
    let fixture: Value = match serde_json::from_str(content) {
        Ok(value) => value,
        Err(error) => {
            totals
                .failures
                .push(format!("{file_name}: invalid JSON: {error}"));
            return;
        }
    };
    if fixture.get("fixtureVersion").and_then(Value::as_i64) != Some(SUPPORTED_FIXTURE_VERSION) {
        totals
            .failures
            .push(format!("{file_name}: unsupported fixtureVersion"));
        return;
    }
    let Some(subject) = fixture.get("subject").and_then(Value::as_str) else {
        totals
            .failures
            .push(format!("{file_name}: missing subject"));
        return;
    };
    let Some(cases) = fixture.get("cases").and_then(Value::as_array) else {
        totals.failures.push(format!("{file_name}: missing cases"));
        return;
    };
    for case in cases {
        let name = case
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("<unnamed>");
        let label = format!("{file_name} / {subject}: {name}");
        match run_case(subject, case) {
            Ok(Some(Ok(()))) => totals.executed += 1,
            Ok(Some(Err(message))) => {
                totals.executed += 1;
                totals.failures.push(format!("{label}: {message}"));
            }
            Ok(None) => totals.skipped += 1,
            Err(message) => totals
                .failures
                .push(format!("{label}: fixture error: {message}")),
        }
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
fn domain_fixtures_match_expectations() {
    let mut totals = Totals::default();
    for (file_name, content) in FIXTURE_FILES {
        run_file(file_name, content, &mut totals);
    }
    println!(
        "fixture cases executed: {}, skipped (other target): {}",
        totals.executed, totals.skipped
    );
    assert!(totals.executed > 0, "no fixture case was executed");
    assert!(
        totals.failures.is_empty(),
        "{} fixture failure(s):\n{}",
        totals.failures.len(),
        totals.failures.join("\n")
    );
}
