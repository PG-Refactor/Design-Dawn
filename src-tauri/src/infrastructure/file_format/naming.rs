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

/// Directory name for an existing Folder / Document directory that moves into another
/// parent: the name is kept as is (it is never re-derived from the display name, so a
/// hand-made name survives); only a case-insensitive collision adds `-2`, `-3`, ...
pub fn moved_directory_name(current_name: &str, existing_names: &[String]) -> String {
    let taken = lowercase_set(existing_names);
    std::iter::once(current_name.to_owned())
        .chain(
            (COLLISION_FIRST_SUFFIX..)
                .map(|number| format!("{current_name}{SLUG_SEPARATOR}{number}")),
        )
        .find(|candidate| !taken.contains(&candidate.to_lowercase()))
        .expect("an unbounded counter always yields a free name")
}

/// The extension of a text block type's content files. Only block types whose content
/// lives in a sheet's `blocks/` directory have such files.
fn text_content_extension(block_type: BlockType) -> Result<&'static str, DomainError> {
    let definition = block_type.definition();
    match (definition.location, definition.extensions.first()) {
        (ContentLocation::SheetBlocks, Some(extension)) => Ok(*extension),
        _ => Err(DomainError::new(
            DomainErrorKind::UnsupportedBlockType,
            format!("{} has no text content file", block_type.as_str()),
        )),
    }
}

/// The `<n>` of a `<blockType>-<n>.<ext>` file name, or `None` if the name does not follow
/// that pattern for this block type. The identifier and extension are compared
/// case-insensitively because collisions are (file-format.md §9.3); leading zeros are
/// accepted and a number that does not fit `u64` is treated as no match.
pub fn block_content_number(block_type: BlockType, file_name: &str) -> Option<u64> {
    let (stem, extension) = file_name.rsplit_once(EXTENSION_SEPARATOR)?;
    let extension_matches = block_type
        .definition()
        .extensions
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(extension));
    let (identifier, digits) = stem.rsplit_once(BLOCK_CONTENT_NUMBER_SEPARATOR)?;
    // `u64::from_str` would also accept a leading `+`, which is not part of the pattern.
    let is_number = !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit());
    if extension_matches && is_number && identifier.eq_ignore_ascii_case(block_type.as_str()) {
        digits.parse().ok()
    } else {
        None
    }
}

/// Largest number among the existing content files of this block type.
pub fn highest_block_content_number(
    block_type: BlockType,
    existing_names: &[String],
) -> Option<u64> {
    existing_names
        .iter()
        .filter_map(|name| block_content_number(block_type, name))
        .max()
}

/// `<blockType>-<n>.<extension>` with `n` = largest known number + 1, so a deleted number is
/// never handed out again (file-format.md §9.3). The largest known number is the larger of
/// the files on disk and `session_high_water` (what this Project Session has already
/// issued, restored or deleted). A name that is nevertheless taken is skipped.
pub fn block_content_file_name(
    block_type: BlockType,
    existing_names: &[String],
    session_high_water: Option<u64>,
) -> Result<String, DomainError> {
    let extension = text_content_extension(block_type)?;
    let highest = highest_block_content_number(block_type, existing_names).max(session_high_water);
    let first_candidate = highest.map_or(BLOCK_CONTENT_FIRST_NUMBER, |number| {
        number.saturating_add(1)
    });
    let taken = lowercase_set(existing_names);
    (first_candidate..=u64::MAX)
        .map(|number| {
            format!(
                "{}{BLOCK_CONTENT_NUMBER_SEPARATOR}{number}{EXTENSION_SEPARATOR}{extension}",
                block_type.as_str()
            )
        })
        .find(|candidate| !taken.contains(candidate))
        .ok_or_else(|| {
            DomainError::new(
                DomainErrorKind::InvalidContentPath,
                format!("no free {} content number left", block_type.as_str()),
            )
        })
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
    fn a_moved_directory_keeps_its_name_unless_it_collides() {
        assert_eq!(moved_directory_name("My Docs", &[]), "My Docs");
        assert_eq!(
            moved_directory_name("api", &names(&["API", "api-2"])),
            "api-3"
        );
    }

    #[test]
    fn block_content_names_use_the_largest_number_plus_one() {
        let existing = names(&["markdown-1.md", "Markdown-2.MD", "markdown-4.md"]);
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &existing, None).unwrap(),
            "markdown-5.md"
        );
        assert_eq!(
            block_content_file_name(BlockType::Mermaid, &existing, None).unwrap(),
            "mermaid-1.mmd"
        );
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &[], None).unwrap(),
            "markdown-1.md"
        );
    }

    #[test]
    fn gaps_are_not_filled() {
        let existing = names(&["markdown-1.md", "markdown-3.md"]);
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &existing, None).unwrap(),
            "markdown-4.md"
        );
    }

    #[test]
    fn the_session_high_water_mark_wins_when_it_is_larger() {
        let existing = names(&["markdown-1.md", "markdown-3.md"]);
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &existing, Some(7)).unwrap(),
            "markdown-8.md"
        );
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &existing, Some(2)).unwrap(),
            "markdown-4.md"
        );
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &[], Some(4)).unwrap(),
            "markdown-5.md"
        );
    }

    #[test]
    fn only_names_of_the_exact_pattern_count() {
        let ignored = names(&[
            "markdown-.md",
            "markdown-x.md",
            "markdown-+9.md",
            "markdown--9.md",
            "markdown-9.txt",
            "markdown-9.mmd",
            "markdown-9",
            "markdown9.md",
            "notes-9.md",
            "mermaid-9.md",
            "xmarkdown-9.md",
            "markdown-9.md.bak",
            ".markdown-9.md.dawn-tmp",
            "markdown-99999999999999999999999.md",
        ]);
        assert_eq!(
            highest_block_content_number(BlockType::Markdown, &ignored),
            None
        );
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &ignored, None).unwrap(),
            "markdown-1.md"
        );
    }

    #[test]
    fn numbers_ignore_case_and_leading_zeros_and_parse_as_u64() {
        assert_eq!(
            block_content_number(BlockType::Markdown, "MARKDOWN-007.Md"),
            Some(7)
        );
        assert_eq!(
            block_content_number(BlockType::Mermaid, "mermaid-18446744073709551615.mmd"),
            Some(u64::MAX)
        );
        assert_eq!(
            block_content_number(BlockType::Mermaid, "mermaid-18446744073709551616.mmd"),
            None
        );
    }

    #[test]
    fn an_exhausted_number_space_is_an_error_not_a_wrap_around() {
        let existing = names(&["markdown-18446744073709551615.md"]);
        assert_eq!(
            block_content_file_name(BlockType::Markdown, &existing, None)
                .unwrap_err()
                .kind,
            DomainErrorKind::InvalidContentPath
        );
    }

    #[test]
    fn image_blocks_have_no_text_content_file() {
        let error = block_content_file_name(BlockType::Image, &[], None).unwrap_err();
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
