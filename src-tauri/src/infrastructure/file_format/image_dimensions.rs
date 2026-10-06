//! Natural size of an image and the initial size of the Block created for it
//! (docs/file-format.md §6). Pure functions over bytes, like `image_validation`.

use super::constants::{INITIAL_IMAGE_LONG_EDGE_MAX, SVG_FALLBACK_HEIGHT, SVG_FALLBACK_WIDTH};
use super::image_validation::{svg_root_attributes, ImageContentError, ImageFormat};
use crate::domain::constants::{SIZE_MAX, SIZE_MIN};

/// Whole world units / pixels, each at least the domain minimum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dimensions {
    pub width: u32,
    pub height: u32,
}

const PIXEL_UNIT_SUFFIX: &str = "px";
const DECIMAL_POINT: char = '.';
const NEGATIVE_SIGN: char = '-';
const POSITIVE_SIGN: char = '+';
const WIDTH_ATTRIBUTE: &str = "width";
const HEIGHT_ATTRIBUTE: &str = "height";
const VIEW_BOX_ATTRIBUTE: &str = "viewBox";
const VIEW_BOX_NUMBER_COUNT: usize = 4;
const VIEW_BOX_WIDTH_INDEX: usize = 2;
const VIEW_BOX_HEIGHT_INDEX: usize = 3;
const ATTRIBUTE_VALUE_SEPARATOR: char = '=';
const QUOTE_CHARACTERS: [char; 2] = ['"', '\''];
const SELF_CLOSING_MARKER: char = '/';

fn clamp_units(value: i64) -> u32 {
    u32::try_from(value.clamp(SIZE_MIN, SIZE_MAX)).expect("the domain size range fits in u32")
}

/// Rounds to whole units (halves away from zero) within `SIZE_MIN..=SIZE_MAX`.
// `as i64` saturates (and maps NaN to 0), and the result is clamped right after, so no
// out-of-range value can survive the cast.
#[allow(clippy::cast_possible_truncation)]
fn to_whole_units(value: f64) -> u32 {
    clamp_units(value.round() as i64)
}

fn saturating_units(value: usize) -> u32 {
    clamp_units(i64::try_from(value).unwrap_or(SIZE_MAX))
}

/// Raster formats are probed from the header; SVG from the root element's attributes.
/// The bytes are expected to have passed `validate_image_content` already.
pub fn natural_size(format: ImageFormat, bytes: &[u8]) -> Result<Dimensions, ImageContentError> {
    match format {
        ImageFormat::Svg => svg_natural_size(bytes),
        _ => raster_natural_size(bytes),
    }
}

fn raster_natural_size(bytes: &[u8]) -> Result<Dimensions, ImageContentError> {
    let size = imagesize::blob_size(bytes)
        .map_err(|_| ImageContentError::new("the image size could not be read"))?;
    if size.width == 0 || size.height == 0 {
        return Err(ImageContentError::new("the image has no area"));
    }
    Ok(Dimensions {
        width: saturating_units(size.width),
        height: saturating_units(size.height),
    })
}

/// Digits with at most one decimal point and no sign, exponent or unit. Rust's own float
/// parser would also accept `inf`, `NaN` and `1e3`, which an SVG length must not be here.
fn parse_plain_decimal(text: &str) -> Option<f64> {
    let digit_count = text.chars().filter(char::is_ascii_digit).count();
    let point_count = text.chars().filter(|&c| c == DECIMAL_POINT).count();
    let only_decimal_characters = text
        .chars()
        .all(|c| c.is_ascii_digit() || c == DECIMAL_POINT);
    if digit_count == 0 || point_count > 1 || !only_decimal_characters {
        return None;
    }
    text.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// `width` / `height`: a plain number, or a number with the `px` unit. Percentages and other
/// units depend on a context an `<img>` does not provide, so they are not usable.
fn parse_svg_length(value: &str) -> Option<f64> {
    let value = value.trim();
    let number = value.strip_suffix(PIXEL_UNIT_SUFFIX).unwrap_or(value);
    parse_plain_decimal(number.trim_end()).filter(|length| *length > 0.0)
}

fn parse_view_box_number(token: &str) -> Option<f64> {
    match token.strip_prefix(NEGATIVE_SIGN) {
        Some(unsigned) => parse_plain_decimal(unsigned).map(|number| -number),
        None => parse_plain_decimal(token.strip_prefix(POSITIVE_SIGN).unwrap_or(token)),
    }
}

fn view_box_size(value: &str) -> Option<(f64, f64)> {
    let numbers: Vec<f64> = value
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|token| !token.is_empty())
        .map(parse_view_box_number)
        .collect::<Option<_>>()?;
    if numbers.len() != VIEW_BOX_NUMBER_COUNT {
        return None;
    }
    let (width, height) = (
        numbers[VIEW_BOX_WIDTH_INDEX],
        numbers[VIEW_BOX_HEIGHT_INDEX],
    );
    (width > 0.0 && height > 0.0).then_some((width, height))
}

/// `name="value"` pairs of a start tag. Values may be quoted with either quote character;
/// an unquoted value (not valid XML, but harmless to read) ends at whitespace.
fn parse_attributes(attributes: &str) -> Vec<(&str, &str)> {
    let mut result = Vec::new();
    let mut rest = attributes;
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == SELF_CLOSING_MARKER);
        let name_end = rest
            .find(|c: char| c.is_whitespace() || c == ATTRIBUTE_VALUE_SEPARATOR)
            .unwrap_or(rest.len());
        let (name, after_name) = rest.split_at(name_end);
        if name.is_empty() {
            return result;
        }
        let after_name = after_name.trim_start();
        let Some(after_equals) = after_name.strip_prefix(ATTRIBUTE_VALUE_SEPARATOR) else {
            rest = after_name;
            continue;
        };
        let after_equals = after_equals.trim_start();
        let (value, remainder) = match after_equals.chars().next() {
            Some(quote) if QUOTE_CHARACTERS.contains(&quote) => {
                let inner = &after_equals[quote.len_utf8()..];
                match inner.split_once(quote) {
                    Some(split) => split,
                    None => return result,
                }
            }
            _ => {
                let end = after_equals
                    .find(char::is_whitespace)
                    .unwrap_or(after_equals.len());
                after_equals.split_at(end)
            }
        };
        result.push((name, value));
        rest = remainder;
    }
}

fn attribute<'a>(attributes: &[(&'a str, &'a str)], name: &str) -> Option<&'a str> {
    attributes
        .iter()
        .find(|(attribute_name, _)| *attribute_name == name)
        .map(|(_, value)| *value)
}

/// `width` and `height` when both are usable, otherwise the `viewBox`, otherwise the fallback.
/// Using only one of `width` / `height` would invent the other, so the pair is all or nothing.
fn svg_natural_size(bytes: &[u8]) -> Result<Dimensions, ImageContentError> {
    let attributes = parse_attributes(svg_root_attributes(bytes)?);
    let declared = attribute(&attributes, WIDTH_ATTRIBUTE)
        .and_then(parse_svg_length)
        .zip(attribute(&attributes, HEIGHT_ATTRIBUTE).and_then(parse_svg_length));
    let size =
        declared.or_else(|| attribute(&attributes, VIEW_BOX_ATTRIBUTE).and_then(view_box_size));
    Ok(match size {
        Some((width, height)) => Dimensions {
            width: to_whole_units(width),
            height: to_whole_units(height),
        },
        None => Dimensions {
            width: SVG_FALLBACK_WIDTH,
            height: SVG_FALLBACK_HEIGHT,
        },
    })
}

/// The natural size, scaled down (never up) so the longer edge is at most
/// `INITIAL_IMAGE_LONG_EDGE_MAX`, keeping the aspect ratio. Each side is rounded to whole
/// units (halves away from zero) and is at least `SIZE_MIN`, so a very elongated image keeps
/// a thin but valid side. The UI's own minimum block size is not applied here.
pub fn initial_block_size(natural: Dimensions) -> Dimensions {
    let long_edge = natural.width.max(natural.height);
    if long_edge <= INITIAL_IMAGE_LONG_EDGE_MAX {
        return natural;
    }
    let scale = f64::from(INITIAL_IMAGE_LONG_EDGE_MAX) / f64::from(long_edge);
    Dimensions {
        width: to_whole_units(f64::from(natural.width) * scale),
        height: to_whole_units(f64::from(natural.height) * scale),
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_samples::{gif_bytes, jpeg_bytes, png_bytes, webp_bytes};
    use super::*;

    fn dimensions(width: u32, height: u32) -> Dimensions {
        Dimensions { width, height }
    }

    fn svg_size(svg: &str) -> Dimensions {
        natural_size(ImageFormat::Svg, svg.as_bytes()).unwrap()
    }

    #[test]
    fn raster_natural_sizes_come_from_the_header() {
        assert_eq!(
            natural_size(ImageFormat::Png, &png_bytes(640, 480)).unwrap(),
            dimensions(640, 480)
        );
        assert_eq!(
            natural_size(ImageFormat::Jpeg, &jpeg_bytes(300, 200)).unwrap(),
            dimensions(300, 200)
        );
        assert_eq!(
            natural_size(ImageFormat::WebP, &webp_bytes(50, 60)).unwrap(),
            dimensions(50, 60)
        );
        assert_eq!(
            natural_size(ImageFormat::Gif, &gif_bytes(7, 9)).unwrap(),
            dimensions(7, 9)
        );
    }

    #[test]
    fn a_raster_without_area_or_with_a_truncated_header_is_an_error() {
        assert!(natural_size(ImageFormat::Png, &png_bytes(0, 5)).is_err());
        assert!(natural_size(ImageFormat::Png, &png_bytes(1, 1)[..12]).is_err());
    }

    #[test]
    fn svg_width_and_height_accept_plain_numbers_and_px() {
        assert_eq!(
            svg_size("<svg width=\"200\" height=\"100\"/>"),
            dimensions(200, 100)
        );
        assert_eq!(
            svg_size("<svg width='200px' height=\"100.4px\"/>"),
            dimensions(200, 100)
        );
        assert_eq!(
            svg_size("<svg width=\"10.5\" height=\"7\"/>"),
            dimensions(11, 7)
        );
    }

    #[test]
    fn svg_view_box_is_used_when_width_and_height_are_not_usable() {
        for svg in [
            "<svg viewBox=\"0 0 120 80\"/>",
            "<svg viewBox=\"-5, -5, 120, 80\"/>",
            "<svg width=\"100%\" height=\"100%\" viewBox=\"0 0 120 80\"/>",
            "<svg width=\"10em\" height=\"5em\" viewBox=\"0 0 120 80\"/>",
            "<svg width=\"50\" viewBox=\"0 0 120 80\"/>",
        ] {
            assert_eq!(svg_size(svg), dimensions(120, 80), "{svg}");
        }
    }

    #[test]
    fn svg_without_a_usable_size_falls_back() {
        for svg in [
            "<svg/>",
            "<svg width=\"100%\" height=\"100%\"/>",
            "<svg width=\"1em\" height=\"1em\"/>",
            "<svg width=\"0\" height=\"10\"/>",
            "<svg width=\"-5\" height=\"10\"/>",
            "<svg width=\"1e3\" height=\"10\"/>",
            "<svg viewBox=\"0 0 0 10\"/>",
            "<svg viewBox=\"0 0 10\"/>",
            "<svg viewBox=\"0 0 10 10 10\"/>",
            "<svg viewBox=\"a b c d\"/>",
        ] {
            assert_eq!(
                svg_size(svg),
                dimensions(SVG_FALLBACK_WIDTH, SVG_FALLBACK_HEIGHT),
                "{svg}"
            );
        }
    }

    #[test]
    fn svg_size_is_read_from_the_root_after_a_prolog_and_with_a_namespace_attribute() {
        assert_eq!(
            svg_size("<?xml version=\"1.0\"?><svg xmlns:x=\"u\" height=\"20\" width=\"40\"></svg>"),
            dimensions(40, 20)
        );
    }

    #[test]
    fn initial_sizes_scale_the_long_edge_down_to_the_limit() {
        let cases = [
            (dimensions(1920, 1080), dimensions(480, 270)),
            (dimensions(1000, 2000), dimensions(240, 480)),
            (dimensions(400, 300), dimensions(400, 300)),
            (dimensions(1000, 1000), dimensions(480, 480)),
            (dimensions(481, 10), dimensions(480, 10)),
            (dimensions(480, 480), dimensions(480, 480)),
            (dimensions(1, 1), dimensions(1, 1)),
            // Rounding of the scaled short edge.
            (dimensions(1000, 333), dimensions(480, 160)),
            // 3 * 480 / 960 is exactly 1.5, which rounds away from zero.
            (dimensions(960, 3), dimensions(480, 2)),
            (dimensions(1001, 1000), dimensions(480, 480)),
            (dimensions(479, 100), dimensions(479, 100)),
            (dimensions(333, 1000), dimensions(160, 480)),
        ];
        for (natural, expected) in cases {
            assert_eq!(initial_block_size(natural), expected, "{natural:?}");
        }
    }

    #[test]
    fn a_very_elongated_image_keeps_at_least_one_unit_on_its_short_side() {
        assert_eq!(
            initial_block_size(dimensions(100_000, 3)),
            dimensions(480, 1)
        );
    }
}
