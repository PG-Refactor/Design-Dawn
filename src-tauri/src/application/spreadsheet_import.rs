//! Reading a spreadsheet chosen in the OS dialog, so its worksheets can become Markdown
//! tables. Rust reads what the file says; the Frontend decides what becomes of it (which
//! sheets and cells, merged cells, hidden rows, headers, alignment). Per cell: the value as
//! the spreadsheet shows it (numbers in their number format where it is a common one, dates
//! as `YYYY-MM-DD`), whether it is a number, and its link. Per sheet: whether it is hidden,
//! its hidden rows and columns, and its merged areas. Formatting, formulas (their last value
//! is used) and pictures do not come in.
//!
//! What each format tells: number formats, links and hidden rows / columns only .xlsx /
//! .xlsm; merged areas .xlsx / .xlsm / .xls; hidden sheets the Excel formats; a CSV / TSV
//! file is one sheet of text (UTF-8, or Shift_JIS when it is not UTF-8).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Dimensions, Reader, SheetType, SheetVisible, Sheets};
use serde::Serialize;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::file_dialogs::{FileDialogs, FileFilter};
use super::spreadsheet_number_format::formatted_number;

/// The formats that can be read: workbooks (calamine) and delimited text.
pub const SPREADSHEET_FILTER: FileFilter = FileFilter {
    name: "Spreadsheets",
    extensions: &["xlsx", "xlsm", "xls", "xlsb", "ods", "csv", "tsv"],
};

/// Same limit as an image: a workbook is read into memory as a whole.
pub const SPREADSHEET_MAX_BYTES: u64 = 20 * 1024 * 1024;
/// Beyond these a sheet is cut off (and marked so): a Markdown table that size is no longer
/// something to read on a canvas.
pub const SPREADSHEET_MAX_ROWS: usize = 1000;
pub const SPREADSHEET_MAX_COLUMNS: usize = 50;
/// A date-time prints as `YYYY-MM-DD HH:MM:SS[.fff]`: the date is the first 10 characters,
/// the date with hours and minutes the first 16. A date at midnight is written as a date.
const DATE_LENGTH: usize = 10;
const DATE_TIME_LENGTH: usize = 16;
const MIDNIGHT_SUFFIX: &str = " 00:00:00";
const UNKNOWN_FILE_NAME: &str = "spreadsheet";
const CSV_EXTENSION: &str = "csv";
const TSV_EXTENSION: &str = "tsv";
const COMMA: char = ',';
const TAB: char = '\t';
const QUOTE: char = '"';
const UTF8_BOM: char = '\u{feff}';
/// Excel's own extensions whose parts are read directly for hidden rows and columns.
const XLSX_EXTENSIONS: &[&str] = &["xlsx", "xlsm"];

/// One cell as the spreadsheet shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetCell {
    pub text: String,
    /// The cell holds a number (also when shown with a currency sign or `%`).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub number: bool,
    /// The address of the cell's external link.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

/// A merged area, zero-based worksheet positions, both ends included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedArea {
    pub first_row: u32,
    pub first_column: u32,
    pub last_row: u32,
    pub last_column: u32,
}

/// One worksheet. `rows[0][0]` is the cell at (`first_row`, `first_column`) of the worksheet
/// (zero-based); trailing empty rows and columns are removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetSheet {
    pub name: String,
    pub hidden: bool,
    pub first_row: u32,
    pub first_column: u32,
    pub rows: Vec<Vec<SpreadsheetCell>>,
    /// Zero-based worksheet rows and columns that are hidden.
    pub hidden_rows: Vec<u32>,
    pub hidden_columns: Vec<u32>,
    pub merged: Vec<MergedArea>,
    /// Rows or columns beyond the limits were left out.
    pub truncated: bool,
}

/// Wire form: `{ status: "selected", fileName, sheets }` or `{ status: "cancelled" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SpreadsheetSelection {
    #[serde(rename_all = "camelCase")]
    Selected {
        file_name: String,
        sheets: Vec<SpreadsheetSheet>,
    },
    Cancelled,
}

fn invalid(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::InvalidSpreadsheet, detail)
}

fn date_time_text(printed: &str) -> String {
    if printed.ends_with(MIDNIGHT_SUFFIX) {
        printed.chars().take(DATE_LENGTH).collect()
    } else {
        printed.chars().take(DATE_TIME_LENGTH).collect()
    }
}

/// Whole numbers without `.0`, other numbers as Rust prints them (shortest exact form).
fn number_text(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

/// The cell's text; `format` is its number format code when the file has one.
fn cell_of(cell: &Data, format: Option<&str>) -> SpreadsheetCell {
    let number = |value: f64| SpreadsheetCell {
        text: format
            .and_then(|code| formatted_number(value, code))
            .unwrap_or_else(|| number_text(value)),
        number: true,
        link: None,
    };
    match cell {
        Data::Empty => SpreadsheetCell::default(),
        Data::String(text) | Data::DateTimeIso(text) | Data::DurationIso(text) => SpreadsheetCell {
            text: text.clone(),
            ..SpreadsheetCell::default()
        },
        Data::Float(value) => number(*value),
        #[allow(clippy::cast_precision_loss)]
        Data::Int(value) => number(*value as f64),
        Data::Bool(value) => SpreadsheetCell {
            text: value.to_string(),
            ..SpreadsheetCell::default()
        },
        Data::DateTime(value) => SpreadsheetCell {
            text: value.as_datetime().map_or_else(
                || number_text(value.as_f64()),
                |date_time| date_time_text(&date_time.to_string()),
            ),
            ..SpreadsheetCell::default()
        },
        Data::Error(error) => SpreadsheetCell {
            text: format!("#{error:?}"),
            ..SpreadsheetCell::default()
        },
    }
}

/// Removes empty rows at the end and columns that are empty in every row at the end.
fn trimmed(mut rows: Vec<Vec<SpreadsheetCell>>) -> Vec<Vec<SpreadsheetCell>> {
    while rows
        .last()
        .is_some_and(|row| row.iter().all(|cell| cell.text.is_empty()))
    {
        rows.pop();
    }
    let width = rows
        .iter()
        .map(|row| {
            row.iter()
                .rposition(|cell| !cell.text.is_empty())
                .map_or(0, |last| last + 1)
        })
        .max()
        .unwrap_or(0);
    for row in &mut rows {
        row.truncate(width);
    }
    rows
}

fn area_of(dimensions: &Dimensions) -> MergedArea {
    MergedArea {
        first_row: dimensions.start.0,
        first_column: dimensions.start.1,
        last_row: dimensions.end.0,
        last_column: dimensions.end.1,
    }
}

/// What a workbook knows beyond values, by format (see the module comment).
#[derive(Default)]
struct SheetExtras {
    formats: HashMap<(u32, u32), String>,
    links: HashMap<(u32, u32), String>,
    merged: Vec<MergedArea>,
}

fn extras_of<RS: std::io::Read + std::io::Seek>(
    workbook: &mut Sheets<RS>,
    name: &str,
) -> SheetExtras {
    let mut extras = SheetExtras::default();
    match workbook {
        Sheets::Xlsx(xlsx) => {
            if let Ok(styles) = xlsx.worksheet_style(name) {
                for (row, column, style) in styles.cells() {
                    if let Some(format) = &style.number_format {
                        extras
                            .formats
                            .insert((row, column), format.format_code.clone());
                    }
                }
            }
            if let Ok(links) = xlsx.hyperlinks_by_sheet_name(name) {
                for link in links {
                    let Some(target) = link.target else { continue };
                    for row in link.range.start.0..=link.range.end.0 {
                        for column in link.range.start.1..=link.range.end.1 {
                            extras.links.insert((row, column), target.clone());
                        }
                    }
                }
            }
            if let Ok(merged) = xlsx.merge_cells_by_sheet_name(name) {
                extras.merged = merged.iter().map(area_of).collect();
            }
        }
        Sheets::Xls(xls) => {
            if let Ok(merged) = xls.merge_cells_by_sheet_name(name) {
                extras.merged = merged.iter().map(area_of).collect();
            }
        }
        _ => {}
    }
    extras
}

fn read_workbook(path: &Path) -> ApplicationResult<Vec<SpreadsheetSheet>> {
    let mut workbook =
        open_workbook_auto(path).map_err(|error| invalid(format!("not a workbook: {error}")))?;
    let hidden_parts = if is_xlsx(path) {
        super::spreadsheet_hidden::hidden_rows_and_columns(path).unwrap_or_default()
    } else {
        HashMap::new()
    };
    let metadata: Vec<(String, bool)> = workbook
        .sheets_metadata()
        .iter()
        .filter(|sheet| sheet.typ == SheetType::WorkSheet)
        .map(|sheet| (sheet.name.clone(), sheet.visible != SheetVisible::Visible))
        .collect();
    let mut sheets = Vec::new();
    for (name, hidden) in metadata {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|error| invalid(format!("sheet {name:?}: {error}")))?;
        let Some((first_row, first_column)) = range.start() else {
            continue;
        };
        let extras = extras_of(&mut workbook, &name);
        let mut truncated = false;
        let mut rows = Vec::new();
        for (index, row) in range.rows().enumerate() {
            if index >= SPREADSHEET_MAX_ROWS {
                truncated = true;
                break;
            }
            if row.len() > SPREADSHEET_MAX_COLUMNS {
                truncated = true;
            }
            let row_number = first_row + u32::try_from(index).unwrap_or(u32::MAX);
            rows.push(
                row.iter()
                    .take(SPREADSHEET_MAX_COLUMNS)
                    .enumerate()
                    .map(|(column, data)| {
                        let position = (
                            row_number,
                            first_column + u32::try_from(column).unwrap_or(u32::MAX),
                        );
                        let mut cell =
                            cell_of(data, extras.formats.get(&position).map(String::as_str));
                        cell.link = extras.links.get(&position).cloned();
                        cell
                    })
                    .collect(),
            );
        }
        let rows = trimmed(rows);
        if rows.is_empty() {
            continue;
        }
        let (hidden_rows, hidden_columns) = hidden_parts.get(&name).cloned().unwrap_or_default();
        sheets.push(SpreadsheetSheet {
            name,
            hidden,
            first_row,
            first_column,
            rows,
            hidden_rows,
            hidden_columns,
            merged: extras.merged,
            truncated,
        });
    }
    Ok(sheets)
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_xlsx(path: &Path) -> bool {
    XLSX_EXTENSIONS.contains(&extension_of(path).as_str())
}

/// The file's text: UTF-8 (a leading byte order mark dropped), otherwise Shift_JIS, the
/// encoding Excel writes CSV in on Japanese Windows.
fn decoded_text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.trim_start_matches(UTF8_BOM).to_owned(),
        Err(_) => encoding_rs::SHIFT_JIS.decode(bytes).0.into_owned(),
    }
}

/// Delimited text as rows of cells: a quoted cell may hold the delimiter, line breaks and
/// doubled quotes.
fn parse_delimited(text: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if quoted {
            if character == QUOTE {
                if characters.peek() == Some(&QUOTE) {
                    cell.push(QUOTE);
                    characters.next();
                } else {
                    quoted = false;
                }
            } else {
                cell.push(character);
            }
            continue;
        }
        match character {
            QUOTE if cell.is_empty() => quoted = true,
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            _ if character == delimiter => row.push(std::mem::take(&mut cell)),
            _ => cell.push(character),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows
}

fn read_delimited(path: &Path, delimiter: char) -> ApplicationResult<Vec<SpreadsheetSheet>> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|error| invalid(format!("cannot read the file: {error}")))?;
    let parsed = parse_delimited(&decoded_text(&bytes), delimiter);
    let truncated = parsed.len() > SPREADSHEET_MAX_ROWS
        || parsed.iter().any(|row| row.len() > SPREADSHEET_MAX_COLUMNS);
    let rows = trimmed(
        parsed
            .into_iter()
            .take(SPREADSHEET_MAX_ROWS)
            .map(|row| {
                row.into_iter()
                    .take(SPREADSHEET_MAX_COLUMNS)
                    .map(|text| SpreadsheetCell {
                        number: !text.trim().is_empty() && text.trim().parse::<f64>().is_ok(),
                        text,
                        link: None,
                    })
                    .collect()
            })
            .collect(),
    );
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let name = path.file_stem().map_or_else(
        || UNKNOWN_FILE_NAME.to_owned(),
        |stem| stem.to_string_lossy().into_owned(),
    );
    Ok(vec![SpreadsheetSheet {
        name,
        hidden: false,
        first_row: 0,
        first_column: 0,
        rows,
        hidden_rows: Vec::new(),
        hidden_columns: Vec::new(),
        merged: Vec::new(),
        truncated,
    }])
}

/// Every worksheet with at least one value, in workbook order (hidden ones included and
/// marked so).
pub fn read_spreadsheet(path: &Path) -> ApplicationResult<Vec<SpreadsheetSheet>> {
    let size = fs::metadata(path)
        .map_err(|error| invalid(format!("cannot read the file: {error}")))?
        .len();
    if size > SPREADSHEET_MAX_BYTES {
        return Err(invalid(format!(
            "the file is larger than {SPREADSHEET_MAX_BYTES} bytes"
        )));
    }
    match extension_of(path).as_str() {
        CSV_EXTENSION => read_delimited(path, COMMA),
        TSV_EXTENSION => read_delimited(path, TAB),
        _ => read_workbook(path),
    }
}

/// Opens the dialog and reads the chosen file. The path never leaves Rust; the Frontend gets
/// the file's base name (for messages) and the values.
pub fn select_and_read_spreadsheet(
    dialogs: &dyn FileDialogs,
) -> ApplicationResult<SpreadsheetSelection> {
    let Some(path) = dialogs.pick_file(SPREADSHEET_FILTER)? else {
        return Ok(SpreadsheetSelection::Cancelled);
    };
    let file_name = path.file_name().map_or_else(
        || UNKNOWN_FILE_NAME.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    );
    Ok(SpreadsheetSelection::Selected {
        file_name,
        sheets: read_spreadsheet(&path)?,
    })
}

/// Distinct positions, sorted (for the hidden rows and columns).
pub(super) fn sorted_positions(positions: HashSet<u32>) -> Vec<u32> {
    let mut sorted: Vec<u32> = positions.into_iter().collect();
    sorted.sort_unstable();
    sorted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(cell: &Data) -> String {
        cell_of(cell, None).text
    }

    #[test]
    fn numbers_read_like_a_spreadsheet_shows_them() {
        assert_eq!(text(&Data::Float(3.0)), "3");
        assert_eq!(text(&Data::Float(2.5)), "2.5");
        assert_eq!(text(&Data::Int(-4)), "-4");
        assert_eq!(text(&Data::Bool(true)), "true");
        assert_eq!(text(&Data::Empty), "");
        assert!(cell_of(&Data::Float(1.0), None).number);
        assert!(!cell_of(&Data::String("1".into()), None).number);
        assert_eq!(cell_of(&Data::Float(0.25), Some("0%")).text, "25%");
    }

    #[test]
    fn dates_keep_the_time_only_when_there_is_one() {
        assert_eq!(date_time_text("2026-11-11 00:00:00"), "2026-11-11");
        assert_eq!(
            date_time_text("2026-11-11 09:30:15.250"),
            "2026-11-11 09:30"
        );
    }

    #[test]
    fn trailing_empty_rows_and_columns_are_removed() {
        let cell = |text: &str| SpreadsheetCell {
            text: text.to_owned(),
            ..SpreadsheetCell::default()
        };
        let rows = vec![
            vec![cell("a"), cell(""), cell("")],
            vec![cell(""), cell("b"), cell("")],
            vec![cell(""), cell(""), cell("")],
        ];
        assert_eq!(
            trimmed(rows),
            vec![vec![cell("a"), cell("")], vec![cell(""), cell("b")]]
        );
    }

    #[test]
    fn delimited_text_keeps_quoted_delimiters_breaks_and_quotes() {
        assert_eq!(
            parse_delimited("a,\"b, c\",\"say \"\"hi\"\"\"\r\nx,\"1\n2\"\n", ','),
            vec![
                vec!["a".to_owned(), "b, c".to_owned(), "say \"hi\"".to_owned()],
                vec!["x".to_owned(), "1\n2".to_owned()],
            ]
        );
        assert_eq!(
            parse_delimited("a\tb", '\t'),
            vec![vec!["a".to_owned(), "b".to_owned()]]
        );
    }

    #[test]
    fn text_that_is_not_utf8_is_read_as_shift_jis() {
        let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode("注文");
        assert_eq!(decoded_text(&bytes), "注文");
        assert_eq!(decoded_text("\u{feff}abc".as_bytes()), "abc");
    }
}
