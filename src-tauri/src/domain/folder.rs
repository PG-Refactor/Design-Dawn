use super::display_name::DisplayName;
use super::entity_id::{parse_unique_ids, EntryId, FolderId};
use super::error::DomainError;
use super::schema_version::{SchemaEntityKind, SchemaVersion};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderInput {
    pub schema_version: i64,
    pub folder_id: String,
    pub name: String,
    pub child_order: Vec<String>,
}

/// A directory under `documents/` that groups Folders and Documents (docs/data-model.md §2.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folder {
    schema_version: SchemaVersion,
    folder_id: FolderId,
    name: DisplayName,
    child_order: Vec<EntryId>,
}

impl Folder {
    pub fn new(input: &FolderInput) -> Result<Self, DomainError> {
        let schema_version = SchemaVersion::parse(SchemaEntityKind::Folder, input.schema_version)?;
        let folder_id = FolderId::parse(&input.folder_id)?;
        let name = DisplayName::new(&input.name)?;
        let child_order = parse_unique_ids(&input.child_order, EntryId::parse)?;
        Ok(Self {
            schema_version,
            folder_id,
            name,
            child_order,
        })
    }

    pub fn schema_version(&self) -> SchemaVersion {
        self.schema_version
    }

    pub fn folder_id(&self) -> &FolderId {
        &self.folder_id
    }

    pub fn name(&self) -> &DisplayName {
        &self.name
    }

    pub fn child_order(&self) -> &[EntryId] {
        &self.child_order
    }
}
