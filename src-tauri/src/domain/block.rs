use super::block_type::BlockType;
use super::caption::{Caption, CaptionPosition};
use super::content_path::ContentPath;
use super::entity_id::BlockId;
use super::error::DomainError;
use super::geometry::{Position, Size};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockInput {
    pub block_id: String,
    pub block_type: String,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub content_path: String,
    /// None: the Block has no caption.
    pub caption: Option<String>,
    /// None: the default place (below the figure).
    pub caption_position: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    block_id: BlockId,
    block_type: BlockType,
    position: Position,
    size: Size,
    content_path: ContentPath,
    caption: Option<Caption>,
    caption_position: Option<CaptionPosition>,
}

impl Block {
    /// Reports the first error in file-format key order.
    pub fn new(input: &BlockInput) -> Result<Self, DomainError> {
        let block_id = BlockId::parse(&input.block_id)?;
        let block_type = BlockType::parse(&input.block_type)?;
        let position = Position::new(input.x, input.y)?;
        let size = Size::new(input.width, input.height)?;
        let content_path = ContentPath::parse(block_type, &input.content_path)?;
        let caption = input.caption.as_deref().map(Caption::new).transpose()?;
        let caption_position = input
            .caption_position
            .as_deref()
            .map(CaptionPosition::parse)
            .transpose()?;
        Ok(Self {
            block_id,
            block_type,
            position,
            size,
            content_path,
            caption,
            caption_position,
        })
    }

    pub fn block_id(&self) -> &BlockId {
        &self.block_id
    }

    pub fn block_type(&self) -> BlockType {
        self.block_type
    }

    pub fn position(&self) -> &Position {
        &self.position
    }

    pub fn size(&self) -> &Size {
        &self.size
    }

    pub fn content_path(&self) -> &ContentPath {
        &self.content_path
    }

    pub fn caption(&self) -> Option<&Caption> {
        self.caption.as_ref()
    }

    /// As written in the file: None when it was left out (the default place).
    pub fn caption_position(&self) -> Option<CaptionPosition> {
        self.caption_position
    }
}
