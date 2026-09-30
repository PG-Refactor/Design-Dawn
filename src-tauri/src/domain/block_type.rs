use super::error::{DomainError, DomainErrorKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BlockType {
    Markdown,
    Mermaid,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentLocation {
    /// `sheets/<sheet-dir>/blocks/<file>`
    SheetBlocks,
    /// `assets/<file>`
    Assets,
}

#[derive(Debug)]
pub struct BlockTypeDefinition {
    pub block_type: BlockType,
    pub identifier: &'static str,
    pub location: ContentLocation,
    /// Lowercase, without the dot; matched case-insensitively.
    pub extensions: &'static [&'static str],
}

/// Add a row here to introduce a new block type; do not branch on identifiers elsewhere.
pub const BLOCK_TYPE_DEFINITIONS: [BlockTypeDefinition; 3] = [
    BlockTypeDefinition {
        block_type: BlockType::Markdown,
        identifier: "markdown",
        location: ContentLocation::SheetBlocks,
        extensions: &["md"],
    },
    BlockTypeDefinition {
        block_type: BlockType::Mermaid,
        identifier: "mermaid",
        location: ContentLocation::SheetBlocks,
        extensions: &["mmd"],
    },
    BlockTypeDefinition {
        block_type: BlockType::Image,
        identifier: "image",
        location: ContentLocation::Assets,
        extensions: &["png", "jpg", "jpeg", "webp", "svg", "gif"],
    },
];

impl BlockType {
    pub fn parse(value: &str) -> Result<Self, DomainError> {
        BLOCK_TYPE_DEFINITIONS
            .iter()
            .find(|definition| definition.identifier == value)
            .map(|definition| definition.block_type)
            .ok_or_else(|| {
                DomainError::new(
                    DomainErrorKind::UnsupportedBlockType,
                    format!("unknown block type: {value:?}"),
                )
            })
    }

    pub fn definition(&self) -> &'static BlockTypeDefinition {
        // The table is exhaustive over `BlockType`; the unit test below enforces that.
        BLOCK_TYPE_DEFINITIONS
            .iter()
            .find(|definition| definition.block_type == *self)
            .expect("every BlockType has a definition")
    }

    pub fn as_str(&self) -> &'static str {
        self.definition().identifier
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_block_type_has_exactly_one_definition() {
        for block_type in [BlockType::Markdown, BlockType::Mermaid, BlockType::Image] {
            let count = BLOCK_TYPE_DEFINITIONS
                .iter()
                .filter(|definition| definition.block_type == block_type)
                .count();
            assert_eq!(count, 1, "{block_type:?}");
            assert_eq!(BlockType::parse(block_type.as_str()).unwrap(), block_type);
        }
    }
}
