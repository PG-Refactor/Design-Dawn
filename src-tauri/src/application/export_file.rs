//! Exports the Frontend prepares itself (a diagram's SVG or PNG, a sheet's HTML page): Rust
//! shows the save dialog and writes the bytes. The Frontend never names a path.

use std::path::Path;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::export_markdown::write_file_atomically;
use super::file_dialogs::{FileDialogs, FileFilter, SaveOutcome};

/// The kinds of file the Frontend may hand over, each with its own dialog filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportKind {
    Svg,
    Png,
    Html,
    Pdf,
}

const SVG_FILTER: FileFilter = FileFilter {
    name: "SVG",
    extensions: &["svg"],
};
const PNG_FILTER: FileFilter = FileFilter {
    name: "PNG",
    extensions: &["png"],
};
const HTML_FILTER: FileFilter = FileFilter {
    name: "HTML",
    extensions: &["html"],
};
const PDF_FILTER: FileFilter = FileFilter {
    name: "PDF",
    extensions: &["pdf"],
};
/// The largest export accepted: a sheet page with its images inlined can be big, but not
/// unbounded.
pub const EXPORT_MAX_BYTES: usize = 200 * 1024 * 1024;
const UNSAFE_FILE_NAME_CHARACTERS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const FALLBACK_STEM: &str = "export";
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const PDF_SIGNATURE: &[u8] = b"%PDF-";

impl ExportKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "svg" => Some(Self::Svg),
            "png" => Some(Self::Png),
            "html" => Some(Self::Html),
            "pdf" => Some(Self::Pdf),
            _ => None,
        }
    }

    pub fn filter(self) -> FileFilter {
        match self {
            Self::Svg => SVG_FILTER,
            Self::Png => PNG_FILTER,
            Self::Html => HTML_FILTER,
            Self::Pdf => PDF_FILTER,
        }
    }

    fn extension(self) -> &'static str {
        self.filter().extensions[0]
    }

    /// A cheap check that the bytes are what the kind says, so a mix-up does not write a
    /// file the OS would open with the wrong program.
    fn matches(self, bytes: &[u8]) -> bool {
        match self {
            Self::Png => bytes.starts_with(PNG_SIGNATURE),
            Self::Pdf => bytes.starts_with(PDF_SIGNATURE),
            Self::Svg | Self::Html => std::str::from_utf8(bytes).is_ok(),
        }
    }
}

fn invalid(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::ExportFailed, detail)
}

/// A file name for the dialog from what the Frontend suggests (a Block's caption, a Sheet's
/// name), with the characters Windows refuses replaced.
pub fn suggested_name(stem: &str, kind: ExportKind) -> String {
    let cleaned: String = stem
        .chars()
        .map(|character| {
            if UNSAFE_FILE_NAME_CHARACTERS.contains(&character) || character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.');
    let stem = if cleaned.is_empty() {
        FALLBACK_STEM
    } else {
        cleaned
    };
    format!("{stem}.{}", kind.extension())
}

/// The size limit and a check that the bytes are what the kind says.
pub fn check_export(kind: ExportKind, bytes: &[u8]) -> ApplicationResult<()> {
    if bytes.len() > EXPORT_MAX_BYTES {
        return Err(invalid("the export is too large"));
    }
    if !kind.matches(bytes) {
        return Err(invalid("the content does not match the file type"));
    }
    Ok(())
}

pub fn export_bytes(
    dialogs: &dyn FileDialogs,
    kind: ExportKind,
    suggested_stem: &str,
    bytes: &[u8],
) -> ApplicationResult<SaveOutcome> {
    check_export(kind, bytes)?;
    let Some(target) = dialogs.save_file(kind.filter(), &suggested_name(suggested_stem, kind))?
    else {
        return Ok(SaveOutcome::Cancelled);
    };
    write_file_atomically(&target, bytes)?;
    Ok(SaveOutcome::Saved {
        file_name: Path::new(&target)
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe_and_carry_the_extension() {
        assert_eq!(
            suggested_name("Figure 1: Order flow", ExportKind::Svg),
            "Figure 1_ Order flow.svg"
        );
        assert_eq!(suggested_name("  ", ExportKind::Png), "export.png");
    }

    #[test]
    fn content_must_match_the_kind() {
        assert!(ExportKind::Png.matches(PNG_SIGNATURE));
        assert!(!ExportKind::Png.matches(b"<svg/>"));
        assert!(ExportKind::Svg.matches(b"<svg/>"));
        assert!(!ExportKind::Html.matches(&[0xff, 0xfe, 0x00]));
    }
}
