//! How a Markdown or Mermaid Block shows its content: at a size the user chose (a percent of
//! the content as written), or fitted to the Block (the largest size at which all of it is
//! inside). Each is stored only when it differs from the Block type's default, so files of
//! Blocks nobody resized keep no such keys.

use super::block_type::BlockType;
use super::constants::{CONTENT_SCALE_MAX_PERCENT, CONTENT_SCALE_MIN_PERCENT};
use super::error::{DomainError, DomainErrorKind};

fn invalid(detail: impl Into<String>) -> DomainError {
    DomainError::new(DomainErrorKind::InvalidContentScale, detail)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentScale(i64);

impl ContentScale {
    pub fn new(percent: i64) -> Result<Self, DomainError> {
        if !(CONTENT_SCALE_MIN_PERCENT..=CONTENT_SCALE_MAX_PERCENT).contains(&percent) {
            return Err(invalid(format!(
                "{percent} is outside {CONTENT_SCALE_MIN_PERCENT}..={CONTENT_SCALE_MAX_PERCENT}"
            )));
        }
        Ok(Self(percent))
    }

    pub fn percent(self) -> i64 {
        self.0
    }
}

/// Only text and diagram Blocks have a display size: an image is shown fitted to its Block.
pub fn check_scalable(block_type: BlockType) -> Result<(), DomainError> {
    match block_type {
        BlockType::Markdown | BlockType::Mermaid => Ok(()),
        BlockType::Image => Err(invalid("an image Block has no display size")),
    }
}

/// Whether a Block of this type fits its content to the Block when the file says nothing:
/// diagrams do (they cannot wrap), text does not.
pub fn default_auto_fit(block_type: BlockType) -> bool {
    matches!(block_type, BlockType::Mermaid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_scale_is_a_percent_between_the_bounds() {
        assert_eq!(ContentScale::new(100).unwrap().percent(), 100);
        assert!(ContentScale::new(CONTENT_SCALE_MIN_PERCENT).is_ok());
        assert!(ContentScale::new(CONTENT_SCALE_MAX_PERCENT).is_ok());
        assert!(ContentScale::new(CONTENT_SCALE_MIN_PERCENT - 1).is_err());
        assert!(ContentScale::new(CONTENT_SCALE_MAX_PERCENT + 1).is_err());
    }

    #[test]
    fn diagrams_fit_by_default_and_images_have_no_display_size() {
        assert!(default_auto_fit(BlockType::Mermaid));
        assert!(!default_auto_fit(BlockType::Markdown));
        assert!(check_scalable(BlockType::Markdown).is_ok());
        assert_eq!(
            check_scalable(BlockType::Image).unwrap_err().kind,
            DomainErrorKind::InvalidContentScale
        );
    }
}
