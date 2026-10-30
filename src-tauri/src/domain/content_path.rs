use super::block_type::{BlockType, ContentLocation};
use super::constants::{
    ASSETS_DIRECTORY_NAME, BLOCKS_DIRECTORY_NAME, CURRENT_DIRECTORY_SEGMENT, DEVICE_NAME_SEPARATOR,
    EXTENSION_SEPARATOR, FORBIDDEN_PATH_CHARACTERS, FORBIDDEN_PATH_CONTROL_RANGES,
    FORBIDDEN_SEGMENT_TRAILING_CHARACTERS, PARENT_DIRECTORY_SEGMENT, PATH_SEPARATOR,
    RESERVED_DEVICE_NAMES, SHEETS_DIRECTORY_NAME, WINDOWS_PATH_SEPARATOR,
};
use super::error::{DomainError, DomainErrorKind};

/// Path relative to the Document root. Validated lexically only: no filesystem access,
/// canonicalization or symlink handling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentPath(String);

fn invalid_path(detail: impl Into<String>) -> DomainError {
    DomainError::new(DomainErrorKind::InvalidContentPath, detail)
}

fn is_forbidden_character(character: char) -> bool {
    let code_point = u32::from(character);
    FORBIDDEN_PATH_CHARACTERS.contains(&character)
        || FORBIDDEN_PATH_CONTROL_RANGES
            .iter()
            .any(|(first, last)| (*first..=*last).contains(&code_point))
}

fn is_reserved_device_name(segment: &str) -> bool {
    let stem = segment
        .split(DEVICE_NAME_SEPARATOR)
        .next()
        .unwrap_or(segment);
    RESERVED_DEVICE_NAMES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(stem))
}

fn check_segment(segment: &str) -> Result<(), DomainError> {
    if segment.is_empty() {
        return Err(invalid_path("empty segment"));
    }
    if segment == CURRENT_DIRECTORY_SEGMENT || segment == PARENT_DIRECTORY_SEGMENT {
        return Err(invalid_path(format!("relative segment: {segment:?}")));
    }
    if segment.chars().any(is_forbidden_character) {
        return Err(invalid_path(format!("forbidden character in {segment:?}")));
    }
    if segment.ends_with(FORBIDDEN_SEGMENT_TRAILING_CHARACTERS) {
        return Err(invalid_path(format!(
            "segment ends with '.' or space: {segment:?}"
        )));
    }
    if is_reserved_device_name(segment) {
        return Err(invalid_path(format!("reserved device name: {segment:?}")));
    }
    Ok(())
}

// Leading/trailing separators show up as empty segments, and drive letters / UNC
// prefixes are caught by ':' and empty segments, so no separate absolute-path check.
fn check_syntax(path: &str) -> Result<Vec<&str>, DomainError> {
    if path.contains(WINDOWS_PATH_SEPARATOR) {
        return Err(invalid_path("backslash separator"));
    }
    let segments: Vec<&str> = path.split(PATH_SEPARATOR).collect();
    for segment in &segments {
        check_segment(segment)?;
    }
    Ok(segments)
}

/// Lexical rules shared by every stored relative path (contentPath and
/// the `.dawn` `path`); placement and extension rules are contentPath-specific.
pub fn validate_relative_path(path: &str) -> Result<Vec<&str>, DomainError> {
    if path.is_empty() {
        return Err(invalid_path("empty"));
    }
    check_syntax(path)
}

fn file_name_for_location<'a>(
    location: ContentLocation,
    segments: &[&'a str],
) -> Result<&'a str, DomainError> {
    match (location, segments) {
        (ContentLocation::SheetBlocks, [sheets, _sheet, blocks, file])
            if *sheets == SHEETS_DIRECTORY_NAME && *blocks == BLOCKS_DIRECTORY_NAME =>
        {
            Ok(file)
        }
        (ContentLocation::Assets, [assets, file]) if *assets == ASSETS_DIRECTORY_NAME => Ok(file),
        _ => Err(invalid_path(format!(
            "unexpected location for this block type: {}",
            segments.join("/")
        ))),
    }
}

// An empty stem (".md") is treated as no extension so hidden files are not accepted as content.
fn check_extension(block_type: BlockType, file_name: &str) -> Result<(), DomainError> {
    let mismatch = || {
        DomainError::new(
            DomainErrorKind::InvalidContentExtension,
            format!(
                "extension of {file_name:?} does not match {}",
                block_type.as_str()
            ),
        )
    };
    let (stem, extension) = file_name
        .rsplit_once(EXTENSION_SEPARATOR)
        .ok_or_else(mismatch)?;
    let extension = extension.to_ascii_lowercase();
    let allowed = block_type
        .definition()
        .extensions
        .contains(&extension.as_str());
    if stem.is_empty() || !allowed {
        return Err(mismatch());
    }
    Ok(())
}

impl ContentPath {
    /// Order: empty, syntax, location, extension. The block type must already be valid.
    pub fn parse(block_type: BlockType, path: &str) -> Result<Self, DomainError> {
        let segments = validate_relative_path(path)?;
        let file_name = file_name_for_location(block_type.definition().location, &segments)?;
        check_extension(block_type, file_name)?;
        Ok(Self(path.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
