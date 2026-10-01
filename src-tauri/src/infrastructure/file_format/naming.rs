//! Directory and file name generation (docs/file-format.md §5, §9.3).
//! Names are generated once at creation and never renamed afterwards.

use std::collections::HashSet;

use super::constants::{
    ASSET_FALLBACK_STEM, BLOCK_CONTENT_FIRST_NUMBER, BLOCK_CONTENT_NUMBER_SEPARATOR,
    COLLISION_FIRST_SUFFIX, FALLBACK_FIRST_NUMBER, SLUG_MAX_LENGTH, SLUG_SEPARATOR,
};
use crate::domain::block_type::{BlockType, ContentLocation};
use crate::domain::constants::{EXTENSION_SEPARATOR, RESERVED_DEVICE_NAMES};
use crate::domain::error::{DomainError, DomainErrorKind};

/// ASCII lowercase letters and digits only, runs of anything else collapse to one `-`.
/// Restricting to ASCII avoids Windows reserved names and macOS Unicode normalization
/// differences showing up as Git problems.
pub fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut separator_pending = false;
    for character in text.chars().map(|c| c.to_ascii_lowercase()) {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            if separator_pending && !slug.is_empty() {
                slug.push(SLUG_SEPARATOR);
            }
            separator_pending = false;
            slug.push(character);
        } else {
            separator_pending = true;
        }
    }
    // The slug is pure ASCII here, so truncating by byte length cannot split a character.
    slug.truncate(SLUG_MAX_LENGTH);
    slug.truncate(slug.trim_end_matches(SLUG_SEPARATOR).len());
    slug
}

fn is_reserved_device_name(name: &str) -> bool {
    RESERVED_DEVICE_NAMES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(name))
}

/// Collisions are judged case-insensitively because Windows and macOS filesystems are.
fn lowercase_set(existing_names: &[String]) -> HashSet<String> {
    existing_names
        .iter()
        .map(|name| name.to_lowercase())
        .collect()
}

/// Document / Sheet directory name. A slug that is empty or a reserved device name falls
/// back to `<fallback_base>-1`, `-2`, ...; otherwise `slug`, `slug-2`, `slug-3`, ...
pub fn unique_directory_name(
    display_name: &str,
    fallback_base: &str,
    existing_names: &[String],
) -> String {
    let taken = lowercase_set(existing_names);
    let slug = slugify(display_name);
    if slug.is_empty() || is_reserved_device_name(&slug) {
        return (FALLBACK_FIRST_NUMBER..)
            .map(|number| format!("{fallback_base}{SLUG_SEPARATOR}{number}"))
            .find(|candidate| !taken.contains(candidate))
            .expect("an unbounded counter always yields a free name");
    }
    std::iter::once(slug.clone())
        .chain((COLLISION_FIRST_SUFFIX..).map(|number| format!("{slug}{SLUG_SEPARATOR}{number}")))
        .find(|candidate| !taken.contains(&candidate.to_lowercase()))
        .expect("an unbounded counter always yields a free name")
}

/// `<blockType>-<n>.<extension>` with the smallest `n` that does not collide.
/// Only block types whose content lives in a sheet's `blocks/` directory have such files.
pub fn block_content_file_name(
    block_type: BlockType,
    existing_names: &[String],
) -> Result<String, DomainError> {
    let definition = block_type.definition();
    let extension = match (definition.location, definition.extensions.first()) {
        (ContentLocation::SheetBlocks, Some(extension)) => *extension,
        _ => {
            return Err(DomainError::new(
                DomainErrorKind::UnsupportedBlockType,
                format!("{} has no text content file", block_type.as_str()),
            ))
        }
    };
    let taken = lowercase_set(existing_names);
    Ok((BLOCK_CONTENT_FIRST_NUMBER..)
        .map(|number| {
            format!(
                "{}{BLOCK_CONTENT_NUMBER_SEPARATOR}{number}{EXTENSION_SEPARATOR}{extension}",
                block_type.as_str()
            )
        })
        .find(|candidate| !taken.contains(candidate))
        .expect("an unbounded counter always yields a free name"))
}

/// Asset file name: slugified stem (fallback `image`), lowercase extension, `-2`, `-3`, ...
/// on collision. Extensions outside the image definition are refused.
pub fn asset_file_name(
    original_file_name: &str,
    existing_names: &[String],
) -> Result<String, DomainError> {
    let (stem, extension) = original_file_name
        .rsplit_once(EXTENSION_SEPARATOR)
        .unwrap_or((original_file_name, ""));
    let extension = extension.to_ascii_lowercase();
    if !BlockType::Image
        .definition()
        .extensions
        .contains(&extension.as_str())
    {
        return Err(DomainError::new(
            DomainErrorKind::InvalidContentExtension,
            format!("unsupported asset extension: {original_file_name:?}"),
        ));
    }
    let mut slug = slugify(stem);
    if slug.is_empty() || is_reserved_device_name(&slug) {
        slug = ASSET_FALLBACK_STEM.to_owned();
    }
    let taken = lowercase_set(existing_names);
    Ok(
        std::iter::once(format!("{slug}{EXTENSION_SEPARATOR}{extension}"))
            .chain((COLLISION_FIRST_SUFFIX..).map(|number| {
                format!("{slug}{SLUG_SEPARATOR}{number}{EXTENSION_SEPARATOR}{extension}")
            }))
            .find(|candidate| !taken.contains(candidate))
            .expect("an unbounded counter always yields a free name"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn slug_collapses_separators_and_trims() {
        assert_eq!(slugify("  System  Design!! v2 "), "system-design-v2");
        assert_eq!(slugify("--A--"), "a");
    }

    #[test]
    fn slug_truncates_without_trailing_separator() {
        let long = format!("{} tail", "a".repeat(SLUG_MAX_LENGTH - 1));
        let slug = slugify(&long);
        assert_eq!(slug, "a".repeat(SLUG_MAX_LENGTH - 1));
        assert!(slugify(&"b".repeat(SLUG_MAX_LENGTH + 10)).len() == SLUG_MAX_LENGTH);
    }

    #[test]
    fn non_ascii_names_fall_back_to_numbered_names() {
        assert_eq!(
            unique_directory_name("設計書", "document", &[]),
            "document-1"
        );
        assert_eq!(
            unique_directory_name("設計書", "document", &names(&["document-1"])),
            "document-2"
        );
    }

    #[test]
    fn reserved_names_fall_back() {
        assert_eq!(unique_directory_name("CON", "sheet", &[]), "sheet-1");
        assert_eq!(unique_directory_name("com1", "sheet", &[]), "sheet-1");
    }

    #[test]
    fn collisions_ignore_case_and_get_numeric_suffixes() {
        let existing = names(&["Overview", "overview-2"]);
        assert_eq!(
            unique_directory_name("Overview", "sheet", &existing),
            "overview-3"
        );
    }

    #[test]
    fn block_content_names_use_the_smallest_free_number() {
        let existing = names(&["markdown-1.md", "Markdown-2.MD", "markdown-4.md"]);
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &existing).unwrap(),
            "markdown-3.md"
        );
        assert_eq!(
            block_content_file_name(BlockType::Mermaid, &existing).unwrap(),
            "mermaid-1.mmd"
        );
    }

    #[test]
    fn image_blocks_have_no_text_content_file() {
        let error = block_content_file_name(BlockType::Image, &[]).unwrap_err();
        assert_eq!(error.kind, DomainErrorKind::UnsupportedBlockType);
    }

    #[test]
    fn asset_names_are_sanitized_and_deduplicated() {
        assert_eq!(
            asset_file_name("My Photo (1).PNG", &[]).unwrap(),
            "my-photo-1.png"
        );
        assert_eq!(asset_file_name("写真.png", &[]).unwrap(), "image.png");
        assert_eq!(asset_file_name("nul.png", &[]).unwrap(), "image.png");
        assert_eq!(
            asset_file_name("a.png", &names(&["A.png", "a-2.png"])).unwrap(),
            "a-3.png"
        );
    }

    #[test]
    fn unsupported_asset_extensions_are_refused() {
        for name in ["script.exe", "noextension", ".png.txt"] {
            assert_eq!(
                asset_file_name(name, &[]).unwrap_err().kind,
                DomainErrorKind::InvalidContentExtension,
                "{name}"
            );
        }
    }
}
