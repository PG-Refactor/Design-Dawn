use super::display_name::DisplayName;
use super::entity_id::{parse_unique_ids, DocumentId, ProjectId};
use super::error::DomainError;
use super::schema_version::{SchemaEntityKind, SchemaVersion};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectInput {
    pub schema_version: i64,
    pub project_id: String,
    pub name: String,
    pub document_order: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    schema_version: SchemaVersion,
    project_id: ProjectId,
    name: DisplayName,
    document_order: Vec<DocumentId>,
}

impl Project {
    pub fn new(input: &ProjectInput) -> Result<Self, DomainError> {
        let schema_version = SchemaVersion::parse(SchemaEntityKind::Project, input.schema_version)?;
        let project_id = ProjectId::parse(&input.project_id)?;
        let name = DisplayName::new(&input.name)?;
        let document_order = parse_unique_ids(&input.document_order, DocumentId::parse)?;
        Ok(Self {
            schema_version,
            project_id,
            name,
            document_order,
        })
    }

    pub fn schema_version(&self) -> SchemaVersion {
        self.schema_version
    }

    pub fn project_id(&self) -> &ProjectId {
        &self.project_id
    }

    pub fn name(&self) -> &DisplayName {
        &self.name
    }

    pub fn document_order(&self) -> &[DocumentId] {
        &self.document_order
    }
}
