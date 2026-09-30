use super::constants::{
    CURRENT_DOCUMENT_SCHEMA_VERSION, CURRENT_PROJECT_SCHEMA_VERSION, CURRENT_SHEET_SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
};
use super::error::{DomainError, DomainErrorKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchemaEntityKind {
    Project,
    Document,
    Sheet,
}

impl SchemaEntityKind {
    pub fn current_version(&self) -> u32 {
        match self {
            Self::Project => CURRENT_PROJECT_SCHEMA_VERSION,
            Self::Document => CURRENT_DOCUMENT_SCHEMA_VERSION,
            Self::Sheet => CURRENT_SHEET_SCHEMA_VERSION,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchemaVersion(u32);

impl SchemaVersion {
    pub fn parse(entity: SchemaEntityKind, value: i64) -> Result<Self, DomainError> {
        if value < MIN_SCHEMA_VERSION {
            return Err(DomainError::new(
                DomainErrorKind::InvalidSchemaVersion,
                format!("{entity:?} schemaVersion must be >= {MIN_SCHEMA_VERSION}: {value}"),
            ));
        }
        let current = entity.current_version();
        match u32::try_from(value) {
            Ok(version) if version <= current => Ok(Self(version)),
            _ => Err(DomainError::new(
                DomainErrorKind::UnsupportedSchemaVersion,
                format!("{entity:?} schemaVersion {value} is newer than supported {current}"),
            )),
        }
    }

    pub fn get(&self) -> u32 {
        self.0
    }
}
