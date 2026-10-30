//! Image format table and content validation.
//! Pure functions over bytes: nothing here touches the filesystem. SVG is only checked for
//! shape and is never executed or sanitized, because the UI shows it through `<img>` only.

use std::fmt;

use super::constants::UTF8_BOM;

/// The formats an Image Block can hold. Must stay equal to the extensions of
/// `BlockType::Image` (a unit test enforces it).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    WebP,
    Gif,
    Svg,
}

#[derive(Debug)]
pub struct ImageFormatDefinition {
    pub format: ImageFormat,
    /// Lowercase, without the dot; matched case-insensitively.
    pub extensions: &'static [&'static str],
    pub mime_type: &'static str,
}

pub const IMAGE_FORMAT_DEFINITIONS: [ImageFormatDefinition; 5] = [
    ImageFormatDefinition {
        format: ImageFormat::Png,
        extensions: &["png"],
        mime_type: "image/png",
    },
    ImageFormatDefinition {
        format: ImageFormat::Jpeg,
        extensions: &["jpg", "jpeg"],
        mime_type: "image/jpeg",
    },
    ImageFormatDefinition {
        format: ImageFormat::WebP,
        extensions: &["webp"],
        mime_type: "image/webp",
    },
    ImageFormatDefinition {
        format: ImageFormat::Gif,
        extensions: &["gif"],
        mime_type: "image/gif",
    },
    ImageFormatDefinition {
        format: ImageFormat::Svg,
        extensions: &["svg"],
        mime_type: "image/svg+xml",
    },
];

const EXTENSION_SEPARATOR: char = '.';
const XML_DECLARATION_START: &str = "<?";
const XML_DECLARATION_END: &str = "?>";
const XML_COMMENT_START: &str = "<!--";
const XML_COMMENT_END: &str = "-->";
const DOCTYPE_START: &str = "<!DOCTYPE";
const SVG_ELEMENT_START: &str = "<svg";
const TAG_END: char = '>';
const SELF_CLOSING_MARKER: char = '/';
const DOCTYPE_SUBSET_START: char = '[';
const DOCTYPE_SUBSET_END: char = ']';
const QUOTE_CHARACTERS: [char; 2] = ['"', '\''];

/// Why the bytes are not an acceptable image. The detail never contains a path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageContentError {
    pub detail: String,
}

impl ImageContentError {
    pub fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
        }
    }
}

impl fmt::Display for ImageContentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.detail)
    }
}

impl std::error::Error for ImageContentError {}

impl ImageFormat {
    pub fn definition(self) -> &'static ImageFormatDefinition {
        IMAGE_FORMAT_DEFINITIONS
            .iter()
            .find(|definition| definition.format == self)
            .expect("every ImageFormat has a definition")
    }

    pub fn mime_type(self) -> &'static str {
        self.definition().mime_type
    }

    /// From a file name (or contentPath): the text after the last `.`, case-insensitively.
    pub fn from_file_name(file_name: &str) -> Option<Self> {
        let (stem, extension) = file_name.rsplit_once(EXTENSION_SEPARATOR)?;
        if stem.is_empty() {
            return None;
        }
        let extension = extension.to_ascii_lowercase();
        IMAGE_FORMAT_DEFINITIONS
            .iter()
            .find(|definition| definition.extensions.contains(&extension.as_str()))
            .map(|definition| definition.format)
    }
}

/// The detected raster type must match the extension; SVG must be a well-formed enough
/// document whose root element is `<svg`.
pub fn validate_image_content(format: ImageFormat, bytes: &[u8]) -> Result<(), ImageContentError> {
    match format {
        ImageFormat::Svg => svg_root_attributes(bytes).map(|_| ()),
        raster => {
            let detected = imagesize::image_type(bytes)
                .map_err(|_| ImageContentError::new("the content is not a recognized image"))?;
            let matches = matches!(
                (raster, detected),
                (ImageFormat::Png, imagesize::ImageType::Png)
                    | (ImageFormat::Jpeg, imagesize::ImageType::Jpeg)
                    | (ImageFormat::WebP, imagesize::ImageType::Webp)
                    | (ImageFormat::Gif, imagesize::ImageType::Gif)
            );
            if matches {
                Ok(())
            } else {
                Err(ImageContentError::new(
                    "the image content does not match the file extension",
                ))
            }
        }
    }
}

fn skip_whitespace(text: &str) -> &str {
    text.trim_start_matches(char::is_whitespace)
}

/// Skips everything up to the end of a `<!DOCTYPE ...>`, including an internal subset
/// (`[ ... ]`) and quoted strings that may contain `>`.
fn skip_doctype(text: &str) -> Option<&str> {
    let mut subset_depth = 0_u32;
    let mut open_quote: Option<char> = None;
    for (index, character) in text.char_indices() {
        if let Some(quote) = open_quote {
            if character == quote {
                open_quote = None;
            }
            continue;
        }
        match character {
            quote if QUOTE_CHARACTERS.contains(&quote) => open_quote = Some(quote),
            DOCTYPE_SUBSET_START => subset_depth += 1,
            DOCTYPE_SUBSET_END => subset_depth = subset_depth.saturating_sub(1),
            TAG_END if subset_depth == 0 => return Some(&text[index + character.len_utf8()..]),
            _ => {}
        }
    }
    None
}

fn skip_prolog(mut text: &str) -> Result<&str, ImageContentError> {
    let unterminated = || ImageContentError::new("the SVG prolog is not terminated");
    loop {
        text = skip_whitespace(text);
        if let Some(rest) = text.strip_prefix(XML_DECLARATION_START) {
            text = rest
                .split_once(XML_DECLARATION_END)
                .ok_or_else(unterminated)?
                .1;
        } else if let Some(rest) = text.strip_prefix(XML_COMMENT_START) {
            text = rest.split_once(XML_COMMENT_END).ok_or_else(unterminated)?.1;
        } else if let Some(rest) = text.strip_prefix(DOCTYPE_START) {
            text = skip_doctype(rest).ok_or_else(unterminated)?;
        } else {
            return Ok(text);
        }
    }
}

/// Validates the SVG shape (UTF-8, optional BOM, prolog, then `<svg` as the first element)
/// and returns the root element's attribute text (without `<svg` and the closing `>`).
pub fn svg_root_attributes(bytes: &[u8]) -> Result<&str, ImageContentError> {
    let bytes = bytes.strip_prefix(&UTF8_BOM).unwrap_or(bytes);
    let text = std::str::from_utf8(bytes)
        .map_err(|_| ImageContentError::new("the SVG is not valid UTF-8"))?;
    let rest = skip_prolog(text)?;
    let not_svg = || ImageContentError::new("the first element of the document is not <svg>");
    let after_name = rest.strip_prefix(SVG_ELEMENT_START).ok_or_else(not_svg)?;
    // `<svgfoo>` is a different element: the name must end right after `svg`.
    let name_ends = after_name
        .chars()
        .next()
        .is_some_and(|next| next.is_whitespace() || next == TAG_END || next == SELF_CLOSING_MARKER);
    if !name_ends {
        return Err(not_svg());
    }
    let mut open_quote: Option<char> = None;
    for (index, character) in after_name.char_indices() {
        if let Some(quote) = open_quote {
            if character == quote {
                open_quote = None;
            }
        } else if QUOTE_CHARACTERS.contains(&character) {
            open_quote = Some(character);
        } else if character == TAG_END {
            return Ok(after_name[..index].trim_end_matches(SELF_CLOSING_MARKER));
        }
    }
    Err(ImageContentError::new(
        "the <svg> start tag is not terminated",
    ))
}

#[cfg(test)]
mod tests {
    use super::super::test_samples::{gif_bytes, jpeg_bytes, png_bytes, webp_bytes};
    use super::*;
    use crate::domain::block_type::BlockType;

    #[test]
    fn the_format_table_covers_exactly_the_image_block_extensions() {
        let mut table: Vec<&str> = IMAGE_FORMAT_DEFINITIONS
            .iter()
            .flat_map(|definition| definition.extensions.iter().copied())
            .collect();
        let mut block: Vec<&str> = BlockType::Image.definition().extensions.to_vec();
        table.sort_unstable();
        block.sort_unstable();
        assert_eq!(table, block);
    }

    #[test]
    fn formats_are_found_by_extension_case_insensitively() {
        assert_eq!(ImageFormat::from_file_name("a.PNG"), Some(ImageFormat::Png));
        assert_eq!(
            ImageFormat::from_file_name("a.jpg"),
            Some(ImageFormat::Jpeg)
        );
        assert_eq!(
            ImageFormat::from_file_name("a.JPEG"),
            Some(ImageFormat::Jpeg)
        );
        assert_eq!(
            ImageFormat::from_file_name("a.webp"),
            Some(ImageFormat::WebP)
        );
        assert_eq!(
            ImageFormat::from_file_name("a.b.gif"),
            Some(ImageFormat::Gif)
        );
        assert_eq!(ImageFormat::from_file_name("a.svg"), Some(ImageFormat::Svg));
        for unsupported in ["a.bmp", "a.tiff", "a", ".png", "a."] {
            assert_eq!(
                ImageFormat::from_file_name(unsupported),
                None,
                "{unsupported}"
            );
        }
    }

    #[test]
    fn mime_types_follow_the_table() {
        assert_eq!(ImageFormat::Png.mime_type(), "image/png");
        assert_eq!(ImageFormat::Jpeg.mime_type(), "image/jpeg");
        assert_eq!(ImageFormat::WebP.mime_type(), "image/webp");
        assert_eq!(ImageFormat::Gif.mime_type(), "image/gif");
        assert_eq!(ImageFormat::Svg.mime_type(), "image/svg+xml");
    }

    #[test]
    fn every_raster_format_is_accepted_with_matching_content() {
        assert!(validate_image_content(ImageFormat::Png, &png_bytes(1, 1)).is_ok());
        assert!(validate_image_content(ImageFormat::Jpeg, &jpeg_bytes(2, 3)).is_ok());
        assert!(validate_image_content(ImageFormat::WebP, &webp_bytes(2, 3)).is_ok());
        assert!(validate_image_content(ImageFormat::Gif, &gif_bytes(2, 3)).is_ok());
    }

    #[test]
    fn raster_content_that_contradicts_the_extension_is_rejected() {
        assert!(validate_image_content(ImageFormat::Jpeg, &png_bytes(1, 1)).is_err());
        assert!(validate_image_content(ImageFormat::Png, &gif_bytes(1, 1)).is_err());
        assert!(validate_image_content(ImageFormat::Gif, &webp_bytes(1, 1)).is_err());
        assert!(validate_image_content(ImageFormat::WebP, &jpeg_bytes(1, 1)).is_err());
        assert!(validate_image_content(ImageFormat::Png, b"<html></html>").is_err());
        assert!(validate_image_content(ImageFormat::Png, b"").is_err());
        assert!(validate_image_content(ImageFormat::Png, b"plain text").is_err());
    }

    #[test]
    fn svg_roots_are_accepted_after_the_allowed_prolog() {
        let accepted: [&[u8]; 8] = [
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            b"  \n\t<svg width='1'></svg>",
            b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg></svg>",
            b"<!-- a > comment --><svg/>",
            b"<?xml version=\"1.0\"?><!-- c --><!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\"><svg></svg>",
            b"<!DOCTYPE svg [ <!ENTITY a \"b>c\"> ]><svg></svg>",
            b"\xEF\xBB\xBF<svg></svg>",
            b"<svg\n  width=\"10\"\n/>",
        ];
        for sample in accepted {
            assert!(
                validate_image_content(ImageFormat::Svg, sample).is_ok(),
                "{}",
                String::from_utf8_lossy(sample)
            );
        }
    }

    #[test]
    fn svg_that_is_not_an_svg_document_is_rejected() {
        let rejected: [&[u8]; 9] = [
            b"",
            b"<html><svg></svg></html>",
            b"<SVG></SVG>",
            b"<svgfoo></svgfoo>",
            b"<svg",
            b"<!-- unterminated <svg>",
            b"<?xml version=\"1.0\"?>",
            b"plain text <svg>",
            b"\xFF\xFE<svg>",
        ];
        for sample in rejected {
            assert!(
                validate_image_content(ImageFormat::Svg, sample).is_err(),
                "{}",
                String::from_utf8_lossy(sample)
            );
        }
    }

    #[test]
    fn root_attributes_ignore_a_greater_than_sign_inside_a_value() {
        let attributes = svg_root_attributes(b"<svg title=\"a>b\" width=\"3\"/>").unwrap();
        assert_eq!(attributes.trim(), "title=\"a>b\" width=\"3\"");
    }
}
