//! Schema migration registry.
//!
//! Every metadata file carries a `schemaVersion`. Reading an older file runs the registered
//! steps `vN -> vN+1` over its JSON, in order, before the DTO is parsed, so the rest of the
//! app only ever sees the current shape. Steps are pure functions of the JSON value: they
//! touch no file and know no other file. Loading never writes the migrated value back; the
//! entity is written in the current version by its next save (or an explicit "update all").
//!
//! To add a step for an entity kind: raise its `CURRENT_*_SCHEMA_VERSION`, append a
//! `Registered { from: <old version>, step }` to that kind's list below, and add a fixture
//! and a test. `registry_covers_every_version_up_to_current` fails if a version is skipped.

use serde_json::{Number, Value};

use super::constants::{
    CURRENT_ENTRY_POINT_SCHEMA_VERSION, DOCUMENT_FILE_NAME, FOLDER_FILE_NAME, PROJECT_FILE_NAME,
    SHEET_FILE_NAME,
};
use super::dto::schema_version_value;
use crate::domain::constants::MIN_SCHEMA_VERSION;
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::domain::schema_version::{SchemaEntityKind, SchemaVersion};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};

const SCHEMA_VERSION_KEY: &str = "schemaVersion";
const LEGACY_PROJECT_ORDER_KEY: &str = "documentOrder";
const PROJECT_ORDER_KEY: &str = "childOrder";

/// The file kinds that have a `schemaVersion`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationTarget {
    Project,
    Folder,
    Document,
    Sheet,
    /// The `.dawn` entry point.
    EntryPoint,
}

impl MigrationTarget {
    pub fn current_version(&self) -> u32 {
        match self {
            Self::Project => SchemaEntityKind::Project.current_version(),
            Self::Folder => SchemaEntityKind::Folder.current_version(),
            Self::Document => SchemaEntityKind::Document.current_version(),
            Self::Sheet => SchemaEntityKind::Sheet.current_version(),
            Self::EntryPoint => CURRENT_ENTRY_POINT_SCHEMA_VERSION,
        }
    }

    /// The kind of metadata file with this name (not path), if it is one.
    pub fn for_file_name(file_name: &str) -> Option<Self> {
        match file_name {
            PROJECT_FILE_NAME => Some(Self::Project),
            FOLDER_FILE_NAME => Some(Self::Folder),
            DOCUMENT_FILE_NAME => Some(Self::Document),
            SHEET_FILE_NAME => Some(Self::Sheet),
            _ => None,
        }
    }

    fn schema_entity(&self) -> Option<SchemaEntityKind> {
        match self {
            Self::Project => Some(SchemaEntityKind::Project),
            Self::Folder => Some(SchemaEntityKind::Folder),
            Self::Document => Some(SchemaEntityKind::Document),
            Self::Sheet => Some(SchemaEntityKind::Sheet),
            Self::EntryPoint => None,
        }
    }

    fn steps(&self) -> &'static [Registered] {
        match self {
            Self::Project => PROJECT_STEPS,
            Self::Folder | Self::Document | Self::Sheet | Self::EntryPoint => NO_STEPS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationError {
    Domain(DomainError),
    Persistence(PersistenceError),
}

impl From<DomainError> for MigrationError {
    fn from(error: DomainError) -> Self {
        Self::Domain(error)
    }
}

impl From<PersistenceError> for MigrationError {
    fn from(error: PersistenceError) -> Self {
        Self::Persistence(error)
    }
}

/// One `vN -> vN+1` step. It receives the value in version `N` and returns it in `N+1`; the
/// runner sets `schemaVersion`, so a step only reshapes the other keys.
type MigrationStep = fn(Value) -> Result<Value, MigrationError>;

struct Registered {
    /// The version the step reads.
    from: u32,
    step: MigrationStep,
}

const NO_STEPS: &[Registered] = &[];

/// `documentOrder` became `childOrder` when Folders were introduced.
const PROJECT_STEPS: &[Registered] = &[Registered {
    from: 1,
    step: project_v1_to_v2,
}];

fn project_v1_to_v2(mut value: Value) -> Result<Value, MigrationError> {
    let invalid = |detail: &str| {
        MigrationError::Persistence(PersistenceError::new(
            PersistenceErrorKind::InvalidFileStructure,
            detail.to_owned(),
        ))
    };
    // The key is decided by the version: a version 1 file holding `childOrder` is a damaged
    // file and not guessed at, exactly as before the registry existed.
    let object = value
        .as_object_mut()
        .ok_or_else(|| invalid("project.json is not a JSON object"))?;
    if object.contains_key(PROJECT_ORDER_KEY) {
        return Err(invalid(
            "schemaVersion 1 project.json must not have childOrder",
        ));
    }
    let order = object
        .remove(LEGACY_PROJECT_ORDER_KEY)
        .ok_or_else(|| invalid("schemaVersion 1 project.json must have documentOrder"))?;
    object.insert(PROJECT_ORDER_KEY.to_owned(), order);
    Ok(value)
}

/// The migrated value and the version it was read in.
#[derive(Debug, Clone, PartialEq)]
pub struct Migrated {
    pub value: Value,
    /// `Some(version)` when at least one step ran; the file on disk is in that version.
    pub migrated_from: Option<u32>,
}

/// Brings `value` to the current version of `target`. A missing or non-numeric
/// `schemaVersion` is left for the DTO parse to report. A version below the minimum or
/// newer than supported is an error before the (unknown) structure is looked at, so a newer
/// file is never half-read. The `.dawn` is the exception: its own validator reports its
/// version problems.
pub fn migrate_to_current(
    target: MigrationTarget,
    mut value: Value,
) -> Result<Migrated, MigrationError> {
    let Some(number) = value.get(SCHEMA_VERSION_KEY).and_then(Value::as_number) else {
        return Ok(Migrated {
            value,
            migrated_from: None,
        });
    };
    let raw_version = schema_version_value(number);
    let current = target.current_version();
    let version = match target.schema_entity() {
        Some(entity) => SchemaVersion::parse(entity, raw_version)?.get(),
        None => match u32::try_from(raw_version) {
            Ok(version) if raw_version >= MIN_SCHEMA_VERSION && version <= current => version,
            _ => {
                return Ok(Migrated {
                    value,
                    migrated_from: None,
                })
            }
        },
    };
    let from_version = version;
    let mut version = version;
    while version < current {
        let registered = target
            .steps()
            .iter()
            .find(|registered| registered.from == version)
            .ok_or_else(|| {
                DomainError::new(
                    DomainErrorKind::UnsupportedSchemaVersion,
                    format!("no migration from {target:?} schemaVersion {version}"),
                )
            })?;
        value = (registered.step)(value)?;
        version += 1;
        if let Some(object) = value.as_object_mut() {
            object.insert(
                SCHEMA_VERSION_KEY.to_owned(),
                Value::Number(Number::from(version)),
            );
        }
    }
    Ok(Migrated {
        value,
        migrated_from: (from_version < current).then_some(from_version),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ALL_TARGETS: [MigrationTarget; 5] = [
        MigrationTarget::Project,
        MigrationTarget::Folder,
        MigrationTarget::Document,
        MigrationTarget::Sheet,
        MigrationTarget::EntryPoint,
    ];

    #[test]
    fn registry_covers_every_version_up_to_current() {
        for target in ALL_TARGETS {
            let froms: Vec<u32> = target.steps().iter().map(|step| step.from).collect();
            let expected: Vec<u32> =
                (MIN_SCHEMA_VERSION as u32..target.current_version()).collect();
            assert_eq!(
                froms, expected,
                "{target:?} must register one step per version below the current one, in order"
            );
        }
    }

    fn legacy_project() -> Value {
        json!({
            "schemaVersion": 1,
            "projectId": "01928f3a-5b6c-7d8e-9f01-23456789abcd",
            "name": "Old",
            "documentOrder": ["01928f3a-6c7d-7e8f-a012-3456789abcde"]
        })
    }

    #[test]
    fn project_v1_is_reshaped_to_the_current_version() {
        let migrated = migrate_to_current(MigrationTarget::Project, legacy_project()).unwrap();
        assert_eq!(migrated.migrated_from, Some(1));
        assert_eq!(
            migrated.value,
            json!({
                "schemaVersion": 2,
                "projectId": "01928f3a-5b6c-7d8e-9f01-23456789abcd",
                "name": "Old",
                "childOrder": ["01928f3a-6c7d-7e8f-a012-3456789abcde"]
            })
        );
    }

    #[test]
    fn migration_is_idempotent() {
        let once = migrate_to_current(MigrationTarget::Project, legacy_project()).unwrap();
        let twice = migrate_to_current(MigrationTarget::Project, once.value.clone()).unwrap();
        assert_eq!(twice.value, once.value);
        assert_eq!(twice.migrated_from, None);
    }

    #[test]
    fn a_current_file_is_returned_untouched() {
        let current = json!({"schemaVersion": 1, "folderId": "x", "name": "n", "childOrder": []});
        let migrated = migrate_to_current(MigrationTarget::Folder, current.clone()).unwrap();
        assert_eq!(migrated.value, current);
        assert_eq!(migrated.migrated_from, None);
    }

    #[test]
    fn project_v1_with_the_wrong_order_key_is_an_invalid_structure() {
        for value in [
            json!({"schemaVersion": 1, "projectId": "p", "name": "n", "childOrder": []}),
            json!({"schemaVersion": 1, "projectId": "p", "name": "n"}),
        ] {
            let Err(MigrationError::Persistence(error)) =
                migrate_to_current(MigrationTarget::Project, value)
            else {
                panic!("expected a persistence error");
            };
            assert_eq!(error.kind, PersistenceErrorKind::InvalidFileStructure);
        }
    }

    #[test]
    fn a_newer_version_is_refused_before_its_structure_is_read() {
        for target in [
            MigrationTarget::Project,
            MigrationTarget::Folder,
            MigrationTarget::Document,
            MigrationTarget::Sheet,
        ] {
            let newer = json!({"schemaVersion": target.current_version() + 1, "unknown": true});
            let Err(MigrationError::Domain(error)) = migrate_to_current(target, newer) else {
                panic!("expected a domain error for {target:?}");
            };
            assert_eq!(error.kind, DomainErrorKind::UnsupportedSchemaVersion);
        }
    }

    #[test]
    fn an_invalid_version_is_refused() {
        for text in ["0", "-1", "1.5"] {
            let value = json!({ "schemaVersion": serde_json::from_str::<Value>(text).unwrap() });
            let Err(MigrationError::Domain(error)) =
                migrate_to_current(MigrationTarget::Sheet, value)
            else {
                panic!("expected a domain error for {text}");
            };
            assert_eq!(error.kind, DomainErrorKind::InvalidSchemaVersion);
        }
    }

    #[test]
    fn a_missing_version_is_left_to_the_dto_parse() {
        let value = json!({"name": "no version"});
        let migrated = migrate_to_current(MigrationTarget::Document, value.clone()).unwrap();
        assert_eq!(migrated.value, value);
    }

    #[test]
    fn the_entry_point_leaves_version_errors_to_its_own_validator() {
        let newer = json!({"schemaVersion": 9, "documentId": "d", "path": "p"});
        let migrated = migrate_to_current(MigrationTarget::EntryPoint, newer.clone()).unwrap();
        assert_eq!(migrated.value, newer);
    }
}
