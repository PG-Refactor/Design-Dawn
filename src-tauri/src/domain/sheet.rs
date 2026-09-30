use super::block::{Block, BlockInput};
use super::display_name::DisplayName;
use super::entity_id::{ensure_unique, BlockId, SheetId};
use super::error::DomainError;
use super::schema_version::{SchemaEntityKind, SchemaVersion};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetInput {
    pub schema_version: i64,
    pub sheet_id: String,
    pub name: String,
    pub blocks: Vec<BlockInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sheet {
    schema_version: SchemaVersion,
    sheet_id: SheetId,
    name: DisplayName,
    /// Array order is z-order: first is backmost, last is frontmost.
    blocks: Vec<Block>,
}

fn build_blocks(inputs: &[BlockInput]) -> Result<Vec<Block>, DomainError> {
    let blocks = inputs
        .iter()
        .map(Block::new)
        .collect::<Result<Vec<Block>, DomainError>>()?;
    let block_ids: Vec<BlockId> = blocks.iter().map(|block| *block.block_id()).collect();
    ensure_unique(&block_ids)?;
    Ok(blocks)
}

impl Sheet {
    pub fn new(input: &SheetInput) -> Result<Self, DomainError> {
        let schema_version = SchemaVersion::parse(SchemaEntityKind::Sheet, input.schema_version)?;
        let sheet_id = SheetId::parse(&input.sheet_id)?;
        let name = DisplayName::new(&input.name)?;
        let blocks = build_blocks(&input.blocks)?;
        Ok(Self {
            schema_version,
            sheet_id,
            name,
            blocks,
        })
    }

    pub fn schema_version(&self) -> SchemaVersion {
        self.schema_version
    }

    pub fn sheet_id(&self) -> &SheetId {
        &self.sheet_id
    }

    pub fn name(&self) -> &DisplayName {
        &self.name
    }

    pub fn blocks(&self) -> &[Block] {
        &self.blocks
    }
}
