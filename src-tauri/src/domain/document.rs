use super::display_name::DisplayName;
use super::entity_id::{parse_unique_ids, DocumentId, SheetId};
use super::error::DomainError;
use super::schema_version::{SchemaEntityKind, SchemaVersion};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentInput {
    pub schema_version: i64,
    pub document_id: String,
    pub name: String,
    pub sheet_order: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    schema_version: SchemaVersion,
    document_id: DocumentId,
    name: DisplayName,
    sheet_order: Vec<SheetId>,
}

impl Document {
    pub fn new(input: &DocumentInput) -> Result<Self, DomainError> {
        let schema_version =
            SchemaVersion::parse(SchemaEntityKind::Document, input.schema_version)?;
        let document_id = DocumentId::parse(&input.document_id)?;
        let name = DisplayName::new(&input.name)?;
        let sheet_order = parse_unique_ids(&input.sheet_order, SheetId::parse)?;
        Ok(Self {
            schema_version,
            document_id,
            name,
            sheet_order,
        })
    }

    pub fn schema_version(&self) -> SchemaVersion {
        self.schema_version
    }

    pub fn document_id(&self) -> &DocumentId {
        &self.document_id
    }

    pub fn name(&self) -> &DisplayName {
        &self.name
    }

    pub fn sheet_order(&self) -> &[SheetId] {
        &self.sheet_order
    }
}
