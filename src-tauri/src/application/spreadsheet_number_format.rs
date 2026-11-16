//! A number written the way its spreadsheet number format shows it, for the common formats
//! of design documents: a fixed number of decimals, thousands separators, a percentage,
//! and text around the number (a currency sign, a unit). Anything else (dates, fractions,
//! scientific notation, conditions) is left to the plain value.

const GENERAL: &str = "General";
const TEXT_FORMAT: &str = "@";
const SECTION_SEPARATOR: char = ';';
const QUOTE: char = '"';
const ESCAPE: char = '\\';
/// `_x` leaves the width of `x` (a space here); `*x` repeats `x` to fill the cell (dropped).
const SPACE_OF: char = '_';
const FILL_WITH: char = '*';
const PERCENT: char = '%';
const PERCENT_FACTOR: f64 = 100.0;
const DECIMAL_POINT: char = '.';
const THOUSANDS: char = ',';
const DIGITS: &[char] = &['0', '#', '?'];
/// Letters that make a date or time format (outside quotes): those are not numbers here.
const DATE_LETTERS: &[char] = &['y', 'm', 'd', 'h', 's', 'Y', 'M', 'D', 'H', 'S'];
/// `E+` / `/`: scientific notation and fractions are not handled.
const UNHANDLED: &[char] = &['E', 'e', '/'];
const GROUP_SIZE: usize = 3;

/// One piece of a format: literal text, or the run of digit placeholders.
enum Piece {
    Literal(String),
    Digits(String),
}

/// The first section of the code (positive numbers), with quotes and escapes resolved into
/// literal text and `[...]` parts reduced to the currency they name (`[$¥-411]` → `¥`).
fn pieces(code: &str) -> Option<Vec<Piece>> {
    let mut pieces = Vec::new();
    let mut literal = String::new();
    let mut digits = String::new();
    let mut characters = code.chars().peekable();
    let flush_digits = |digits: &mut String, pieces: &mut Vec<Piece>| {
        if !digits.is_empty() {
            pieces.push(Piece::Digits(std::mem::take(digits)));
        }
    };
    let flush_literal = |literal: &mut String, pieces: &mut Vec<Piece>| {
        if !literal.is_empty() {
            pieces.push(Piece::Literal(std::mem::take(literal)));
        }
    };
    while let Some(character) = characters.next() {
        match character {
            SECTION_SEPARATOR => break,
            QUOTE => {
                flush_digits(&mut digits, &mut pieces);
                for quoted in characters.by_ref() {
                    if quoted == QUOTE {
                        break;
                    }
                    literal.push(quoted);
                }
            }
            ESCAPE => {
                flush_digits(&mut digits, &mut pieces);
                literal.extend(characters.next());
            }
            SPACE_OF => {
                flush_digits(&mut digits, &mut pieces);
                characters.next();
                literal.push(' ');
            }
            FILL_WITH => {
                characters.next();
            }
            '[' => {
                flush_digits(&mut digits, &mut pieces);
                let mut inside = String::new();
                for bracketed in characters.by_ref() {
                    if bracketed == ']' {
                        break;
                    }
                    inside.push(bracketed);
                }
                // `[$¥-411]`: the text after `$` up to `-` is the currency sign; colours
                // (`[Red]`) and conditions say nothing to show.
                if let Some(currency) = inside.strip_prefix('$') {
                    literal.push_str(currency.split('-').next().unwrap_or_default());
                }
            }
            _ if DATE_LETTERS.contains(&character) || UNHANDLED.contains(&character) => {
                return None;
            }
            _ if DIGITS.contains(&character)
                || ((character == DECIMAL_POINT || character == THOUSANDS)
                    && !digits.is_empty()) =>
            {
                flush_literal(&mut literal, &mut pieces);
                digits.push(character);
            }
            _ => {
                flush_digits(&mut digits, &mut pieces);
                literal.push(character);
            }
        }
    }
    flush_digits(&mut digits, &mut pieces);
    flush_literal(&mut literal, &mut pieces);
    Some(pieces)
}

fn grouped(whole: &str) -> String {
    let digits: Vec<char> = whole.chars().collect();
    let mut result = String::new();
    for (index, digit) in digits.iter().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(GROUP_SIZE) {
            result.push(THOUSANDS);
        }
        result.push(*digit);
    }
    result
}

/// `value` as `code` shows it, or `None` when the code is general or not one handled here.
pub fn formatted_number(value: f64, code: &str) -> Option<String> {
    if code == GENERAL || code == TEXT_FORMAT || !value.is_finite() {
        return None;
    }
    let pieces = pieces(code)?;
    let mut digit_runs = pieces.iter().filter_map(|piece| match piece {
        Piece::Digits(digits) => Some(digits.as_str()),
        Piece::Literal(_) => None,
    });
    let pattern = digit_runs.next()?;
    if digit_runs.next().is_some() {
        return None;
    }
    let percent = pieces
        .iter()
        .any(|piece| matches!(piece, Piece::Literal(text) if text.contains(PERCENT)));
    let (integer_part, decimal_part) = pattern.split_once(DECIMAL_POINT).unwrap_or((pattern, ""));
    let decimals = decimal_part.chars().filter(|c| DIGITS.contains(c)).count();
    let thousands = integer_part.contains(THOUSANDS);
    let shown = if percent {
        value * PERCENT_FACTOR
    } else {
        value
    };
    // Halves round away from zero, as the spreadsheet does (`format!` would round them to
    // even).
    let scale = 10_f64.powi(i32::try_from(decimals).unwrap_or(0));
    let fixed = format!("{:.*}", decimals, (shown.abs() * scale).round() / scale);
    let (whole, fraction) = fixed.split_once(DECIMAL_POINT).unwrap_or((&fixed, ""));
    let mut number = if thousands {
        grouped(whole)
    } else {
        whole.to_owned()
    };
    if !fraction.is_empty() {
        number.push(DECIMAL_POINT);
        number.push_str(fraction);
    }
    let negative = shown < 0.0 && fixed.chars().any(|c| c.is_ascii_digit() && c != '0');
    let mut text = String::new();
    if negative {
        text.push('-');
    }
    for piece in &pieces {
        match piece {
            Piece::Literal(literal) => text.push_str(literal),
            Piece::Digits(_) => text.push_str(&number),
        }
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_number_formats_are_shown_as_the_spreadsheet_shows_them() {
        assert_eq!(formatted_number(1234.5, "#,##0").as_deref(), Some("1,235"));
        assert_eq!(
            formatted_number(1234.5, "#,##0.00").as_deref(),
            Some("1,234.50")
        );
        assert_eq!(formatted_number(0.125, "0.0%").as_deref(), Some("12.5%"));
        assert_eq!(formatted_number(0.5, "0%").as_deref(), Some("50%"));
        assert_eq!(
            formatted_number(1200.0, "\"¥\"#,##0").as_deref(),
            Some("¥1,200")
        );
        assert_eq!(
            formatted_number(1200.0, "[$¥-411]#,##0").as_deref(),
            Some("¥1,200")
        );
        assert_eq!(
            formatted_number(-3.0, "#,##0\"件\"").as_deref(),
            Some("-3件")
        );
        assert_eq!(
            formatted_number(1234.0, "#,##0;[Red]-#,##0").as_deref(),
            Some("1,234")
        );
        assert_eq!(formatted_number(7.0, "_(* #,##0_)").as_deref(), Some(" 7 "));
    }

    #[test]
    fn other_formats_are_left_to_the_plain_value() {
        assert_eq!(formatted_number(1.0, "General"), None);
        assert_eq!(formatted_number(1.0, "@"), None);
        assert_eq!(formatted_number(45000.0, "yyyy/m/d"), None);
        assert_eq!(formatted_number(1.5, "0.00E+00"), None);
        assert_eq!(formatted_number(0.5, "# ?/?"), None);
    }
}
