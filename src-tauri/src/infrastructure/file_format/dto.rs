//! serde DTOs for `project.json`, `folder.json`, `document.json`, `sheet.json` and `.dawn`.
//!
//! Field order is the key order written to disk. Numbers are
//! kept as `serde_json::Number` so that fractional or out-of-range values reach the
//! domain validators and produce the same error kinds as in TypeScript.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};

use super::constants::{CURRENT_ENTRY_POINT_SCHEMA_VERSION, JSON_TRAILING_NEWLINE};
use crate::domain::block::{Block, BlockInput};
use crate::domain::constants::{MIN_SCHEMA_VERSION, POSITION_MAX, SIZE_MIN};
use crate::domain::document::{Document, DocumentInput};
use crate::domain::entity_id::DocumentId;
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::domain::folder::{Folder, FolderInput};
use crate::domain::geometry::{Position, Size};
use crate::domain::project::{Project, ProjectInput};
use crate::domain::schema_version::{SchemaEntityKind, SchemaVersion};
use crate::domain::sheet::{Sheet, SheetInput};
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectDto {
    pub schema_version: Number,
    pub project_id: String,
    pub name: String,
    pub child_order: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FolderDto {
    pub schema_version: Number,
    pub folder_id: String,
    pub name: String,
    pub child_order: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentDto {
    pub schema_version: Number,
    pub document_id: String,
    pub name: String,
    pub sheet_order: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PositionDto {
    pub x: Number,
    pub y: Number,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SizeDto {
    pub width: Number,
    pub height: Number,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockDto {
    pub block_id: String,
    pub block_type: String,
    pub position: PositionDto,
    pub size: SizeDto,
    pub content_path: String,
    /// Absent when the Block has no caption (and in every version 1 file).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    /// `"above"` or `"below"`; absent means below.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption_position: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SheetDto {
    pub schema_version: Number,
    pub sheet_id: String,
    pub name: String,
    pub blocks: Vec<BlockDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryPointDto {
    pub schema_version: Number,
    pub document_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IntegerProblem {
    NotInteger,
    TooLargePositive,
    TooLargeNegative,
}

// A whole-valued float such as `1.0` or `1e3` is accepted as that integer: it is
// representable as one, and JavaScript cannot tell the two apart either.
fn number_as_integer(number: &Number) -> Result<i64, IntegerProblem> {
    if let Some(value) = number.as_i64() {
        return Ok(value);
    }
    if number.as_u64().is_some() {
        return Err(IntegerProblem::TooLargePositive);
    }
    let value = number.as_f64().unwrap_or(f64::NAN);
    if !value.is_finite() || value.fract() != 0.0 {
        return Err(IntegerProblem::NotInteger);
    }
    // `i64::MAX as f64` rounds up to 2^63, which is exactly the first unrepresentable value.
    if value >= i64::MAX as f64 {
        Err(IntegerProblem::TooLargePositive)
    } else if value < i64::MIN as f64 {
        Err(IntegerProblem::TooLargeNegative)
    } else {
        Ok(value as i64)
    }
}

// The domain constructors take `i64` and report the error in file-format key order.
// A value that is not an integer is replaced by a sentinel the domain rejects, so this
// conversion never has to decide which error wins over an earlier field's error.
fn integer_or_sentinel(number: &Number, not_integer_sentinel: i64) -> i64 {
    match number_as_integer(number) {
        Ok(value) => value,
        Err(IntegerProblem::NotInteger) => not_integer_sentinel,
        Err(IntegerProblem::TooLargePositive) => i64::MAX,
        Err(IntegerProblem::TooLargeNegative) => i64::MIN,
    }
}

fn position_axis(number: &Number) -> i64 {
    integer_or_sentinel(number, POSITION_MAX + 1)
}

fn size_axis(number: &Number) -> i64 {
    integer_or_sentinel(number, SIZE_MIN - 1)
}

/// Fractional and hugely negative values are `invalidSchemaVersion`; a huge positive
/// integer is a newer version than this app supports.
pub fn schema_version_value(number: &Number) -> i64 {
    integer_or_sentinel(number, MIN_SCHEMA_VERSION - 1)
}

impl PositionDto {
    pub fn to_domain(&self) -> Result<Position, DomainError> {
        Position::new(position_axis(&self.x), position_axis(&self.y))
    }
}

impl SizeDto {
    pub fn to_domain(&self) -> Result<Size, DomainError> {
        Size::new(size_axis(&self.width), size_axis(&self.height))
    }
}

/// Validates a JSON `schemaVersion` value for the given entity kind.
pub fn parse_schema_version(
    entity: SchemaEntityKind,
    number: &Number,
) -> Result<SchemaVersion, DomainError> {
    SchemaVersion::parse(entity, schema_version_value(number))
}

impl ProjectDto {
    pub fn to_domain(&self) -> Result<Project, DomainError> {
        Project::new(&ProjectInput {
            schema_version: schema_version_value(&self.schema_version),
            project_id: self.project_id.clone(),
            name: self.name.clone(),
            child_order: self.child_order.clone(),
        })
    }

    pub fn from_domain(project: &Project) -> Self {
        Self {
            schema_version: Number::from(project.schema_version().get()),
            project_id: project.project_id().to_string(),
            name: project.name().as_str().to_owned(),
            child_order: project
                .child_order()
                .iter()
                .map(ToString::to_string)
                .collect(),
        }
    }
}

impl FolderDto {
    pub fn to_domain(&self) -> Result<Folder, DomainError> {
        Folder::new(&FolderInput {
            schema_version: schema_version_value(&self.schema_version),
            folder_id: self.folder_id.clone(),
            name: self.name.clone(),
            child_order: self.child_order.clone(),
        })
    }

    pub fn from_domain(folder: &Folder) -> Self {
        Self {
            schema_version: Number::from(folder.schema_version().get()),
            folder_id: folder.folder_id().to_string(),
            name: folder.name().as_str().to_owned(),
            child_order: folder
                .child_order()
                .iter()
                .map(ToString::to_string)
                .collect(),
        }
    }
}

impl DocumentDto {
    pub fn to_domain(&self) -> Result<Document, DomainError> {
        Document::new(&DocumentInput {
            schema_version: schema_version_value(&self.schema_version),
            document_id: self.document_id.clone(),
            name: self.name.clone(),
            sheet_order: self.sheet_order.clone(),
        })
    }

    pub fn from_domain(document: &Document) -> Self {
        Self {
            schema_version: Number::from(document.schema_version().get()),
            document_id: document.document_id().to_string(),
            name: document.name().as_str().to_owned(),
            sheet_order: document
                .sheet_order()
                .iter()
                .map(ToString::to_string)
                .collect(),
        }
    }
}

impl BlockDto {
    fn to_input(&self) -> BlockInput {
        BlockInput {
            block_id: self.block_id.clone(),
            block_type: self.block_type.clone(),
            x: position_axis(&self.position.x),
            y: position_axis(&self.position.y),
            width: size_axis(&self.size.width),
            height: size_axis(&self.size.height),
            content_path: self.content_path.clone(),
            caption: self.caption.clone(),
            caption_position: self.caption_position.clone(),
        }
    }

    pub fn to_domain(&self) -> Result<Block, DomainError> {
        Block::new(&self.to_input())
    }

    pub fn from_domain(block: &Block) -> Self {
        Self {
            block_id: block.block_id().to_string(),
            block_type: block.block_type().as_str().to_owned(),
            position: PositionDto {
                x: Number::from(block.position().x()),
                y: Number::from(block.position().y()),
            },
            size: SizeDto {
                width: Number::from(block.size().width()),
                height: Number::from(block.size().height()),
            },
            content_path: block.content_path().as_str().to_owned(),
            caption: block.caption().map(|caption| caption.as_str().to_owned()),
            caption_position: block
                .caption_position()
                .map(|position| position.as_str().to_owned()),
        }
    }
}

impl SheetDto {
    pub fn to_domain(&self) -> Result<Sheet, DomainError> {
        let block_inputs = self.blocks.iter().map(BlockDto::to_input).collect();
        Sheet::new(&SheetInput {
            schema_version: schema_version_value(&self.schema_version),
            sheet_id: self.sheet_id.clone(),
            name: self.name.clone(),
            blocks: block_inputs,
        })
    }

    pub fn from_domain(sheet: &Sheet) -> Self {
        Self {
            schema_version: Number::from(sheet.schema_version().get()),
            sheet_id: sheet.sheet_id().to_string(),
            name: sheet.name().as_str().to_owned(),
            blocks: sheet.blocks().iter().map(BlockDto::from_domain).collect(),
        }
    }
}

impl EntryPointDto {
    /// Validates `schemaVersion` and `documentId`. The `path` is checked by the caller,
    /// because an unusable path is a miss that falls back to an ID scan, not an error.
    pub fn validated_document_id(&self) -> Result<DocumentId, DomainError> {
        let version = schema_version_value(&self.schema_version);
        if version < MIN_SCHEMA_VERSION {
            return Err(DomainError::new(
                DomainErrorKind::InvalidSchemaVersion,
                format!("entry point schemaVersion must be >= {MIN_SCHEMA_VERSION}"),
            ));
        }
        if u32::try_from(version).map_or(true, |value| value > CURRENT_ENTRY_POINT_SCHEMA_VERSION) {
            return Err(DomainError::new(
                DomainErrorKind::UnsupportedSchemaVersion,
                format!(
                    "entry point schemaVersion is newer than supported {CURRENT_ENTRY_POINT_SCHEMA_VERSION}"
                ),
            ));
        }
        DocumentId::parse(&self.document_id)
    }
}

/// Distinguishes broken JSON syntax from JSON of the wrong shape.
pub fn parse_json_text(text: &str) -> Result<Value, PersistenceError> {
    serde_json::from_str(text).map_err(|error| {
        PersistenceError::new(PersistenceErrorKind::InvalidJson, error.to_string())
    })
}

/// Missing or mistyped keys and unknown keys are `invalidFileStructure`; unknown keys are
/// rejected because silently dropping them would lose data on the next save.
pub fn parse_dto<T: DeserializeOwned>(value: Value) -> Result<T, PersistenceError> {
    serde_json::from_value(value).map_err(|error| {
        PersistenceError::new(
            PersistenceErrorKind::InvalidFileStructure,
            error.to_string(),
        )
    })
}

/// Pretty-printed JSON with 2-space indentation and a trailing newline.
pub fn to_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, PersistenceError> {
    let mut text = serde_json::to_string_pretty(value).map_err(|error| {
        PersistenceError::new(PersistenceErrorKind::IoError, format!("serialize: {error}"))
    })?;
    text.push_str(JSON_TRAILING_NEWLINE);
    Ok(text.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number(text: &str) -> Number {
        serde_json::from_str(text).expect("valid JSON number")
    }

    #[test]
    fn fractional_numbers_are_not_integers() {
        assert_eq!(
            number_as_integer(&number("1.5")),
            Err(IntegerProblem::NotInteger)
        );
    }

    #[test]
    fn whole_floats_are_accepted_as_integers() {
        assert_eq!(number_as_integer(&number("2.0")), Ok(2));
        assert_eq!(number_as_integer(&number("1e3")), Ok(1000));
    }

    #[test]
    fn huge_values_are_classified_by_sign() {
        assert_eq!(
            number_as_integer(&number("99999999999999999999")),
            Err(IntegerProblem::TooLargePositive)
        );
        assert_eq!(
            number_as_integer(&number("-99999999999999999999")),
            Err(IntegerProblem::TooLargeNegative)
        );
        assert_eq!(
            number_as_integer(&number("18446744073709551615")),
            Err(IntegerProblem::TooLargePositive)
        );
    }

    #[test]
    fn schema_version_problems_map_to_the_right_kinds() {
        let dto = |text: &str| ProjectDto {
            schema_version: number(text),
            project_id: "01928f3a-5b6c-7d8e-9f01-23456789abcd".to_owned(),
            name: "P".to_owned(),
            child_order: Vec::new(),
        };
        let kind = |text: &str| dto(text).to_domain().unwrap_err().kind;
        assert_eq!(kind("1.5"), DomainErrorKind::InvalidSchemaVersion);
        assert_eq!(kind("0"), DomainErrorKind::InvalidSchemaVersion);
        assert_eq!(
            kind("-99999999999999999999"),
            DomainErrorKind::InvalidSchemaVersion
        );
        assert_eq!(kind("3"), DomainErrorKind::UnsupportedSchemaVersion);
        assert_eq!(
            kind("99999999999999999999"),
            DomainErrorKind::UnsupportedSchemaVersion
        );
    }
}

#[cfg(test)]
mod caption_tests {
    use serde_json::json;

    use super::*;

    fn sheet_with(block_extra: Value) -> Value {
        let mut block = json!({
            "blockId": "01928f3a-b1c2-7d34-b567-89abcdef0123",
            "blockType": "mermaid",
            "position": {"x": 0, "y": 0},
            "size": {"width": 320, "height": 240},
            "contentPath": "sheets/details/blocks/mermaid-1.mmd",
        });
        if let (Some(target), Some(extra)) = (block.as_object_mut(), block_extra.as_object()) {
            target.extend(extra.clone());
        }
        json!({
            "schemaVersion": 2,
            "sheetId": "01928f3a-7d8f-7f90-b123-456789abcdef",
            "name": "Details",
            "blocks": [block],
        })
    }

    #[test]
    fn a_caption_goes_through_the_domain_and_back() {
        let dto: SheetDto =
            serde_json::from_value(sheet_with(json!({"caption": "Figure 1: flow"}))).unwrap();
        let sheet = dto.to_domain().unwrap();
        assert_eq!(
            sheet.blocks()[0].caption().map(|caption| caption.as_str()),
            Some("Figure 1: flow")
        );
        let written = serde_json::to_value(SheetDto::from_domain(&sheet)).unwrap();
        assert_eq!(written["blocks"][0]["caption"], "Figure 1: flow");
    }

    #[test]
    fn a_caption_position_goes_through_the_domain_and_back() {
        let dto: SheetDto = serde_json::from_value(sheet_with(
            json!({"caption": "Figure 1", "captionPosition": "above"}),
        ))
        .unwrap();
        let written =
            serde_json::to_value(SheetDto::from_domain(&dto.to_domain().unwrap())).unwrap();
        assert_eq!(written["blocks"][0]["captionPosition"], "above");
    }

    #[test]
    fn an_unknown_caption_position_is_an_invalid_caption() {
        let dto: SheetDto =
            serde_json::from_value(sheet_with(json!({"captionPosition": "left"}))).unwrap();
        assert_eq!(
            dto.to_domain().unwrap_err().kind,
            DomainErrorKind::InvalidCaption
        );
    }

    #[test]
    fn a_block_without_a_caption_writes_no_caption_key() {
        let dto: SheetDto = serde_json::from_value(sheet_with(json!({}))).unwrap();
        let written =
            serde_json::to_value(SheetDto::from_domain(&dto.to_domain().unwrap())).unwrap();
        assert!(written["blocks"][0].get("caption").is_none());
    }
}
