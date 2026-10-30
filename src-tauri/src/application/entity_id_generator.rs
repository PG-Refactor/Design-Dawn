use uuid::Uuid;

use crate::domain::entity_id::{BlockId, DocumentId, FolderId, ProjectId, SheetId};
use crate::domain::error::DomainError;

// Going through the domain parser guarantees generated IDs satisfy the same rule as
// loaded ones. A failure means the uuid crate broke its contract, so it panics.
fn generate<Id>(parse: fn(&str) -> Result<Id, DomainError>) -> Id {
    let text = Uuid::now_v7().hyphenated().to_string();
    parse(&text).unwrap_or_else(|error| panic!("uuid v7 generator produced an invalid id: {error}"))
}

pub fn generate_project_id() -> ProjectId {
    generate(ProjectId::parse)
}

pub fn generate_document_id() -> DocumentId {
    generate(DocumentId::parse)
}

pub fn generate_folder_id() -> FolderId {
    generate(FolderId::parse)
}

pub fn generate_sheet_id() -> SheetId {
    generate(SheetId::parse)
}

pub fn generate_block_id() -> BlockId {
    generate(BlockId::parse)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUCCESSIVE_ID_COUNT: usize = 1000;
    const EXPECTED_UUID_VERSION: usize = 7;

    #[test]
    fn generates_ids_accepted_by_the_domain_parsers() {
        assert!(ProjectId::parse(&generate_project_id().to_string()).is_ok());
        assert!(DocumentId::parse(&generate_document_id().to_string()).is_ok());
        assert!(SheetId::parse(&generate_sheet_id().to_string()).is_ok());
        assert!(BlockId::parse(&generate_block_id().to_string()).is_ok());
    }

    #[test]
    fn generates_version_7_ids() {
        assert_eq!(
            generate_block_id().as_uuid().get_version_num(),
            EXPECTED_UUID_VERSION
        );
    }

    #[test]
    fn successive_ids_sort_ascending_as_strings() {
        let generated: Vec<String> = (0..SUCCESSIVE_ID_COUNT)
            .map(|_| generate_block_id().to_string())
            .collect();
        let mut sorted = generated.clone();
        sorted.sort();
        assert_eq!(generated, sorted);
        sorted.dedup();
        assert_eq!(sorted.len(), SUCCESSIVE_ID_COUNT);
    }
}
