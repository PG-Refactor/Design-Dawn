//! Reading a spreadsheet chosen in the OS dialog, so its worksheets can become Markdown
//! tables. Only cell values come in: merged cells, formatting, formulas (their last value is
//! used) and pictures are not part of a Markdown table.

use std::fs;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::file_dialogs::{FileDialogs, FileFilter};

/// The formats calamine reads.
pub const SPREADSHEET_FILTER: FileFilter = FileFilter {
    name: "Spreadsheets",
    extensions: &["xlsx", "xlsm", "xls", "xlsb", "ods"],
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

/// One worksheet's values, top-left first; trailing empty rows and columns are removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetSheet {
    pub name: String,
    pub rows: Vec<Vec<String>>,
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

fn cell_text(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(text) | Data::DateTimeIso(text) | Data::DurationIso(text) => text.clone(),
        Data::Float(value) => number_text(*value),
        Data::Int(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::DateTime(value) => value.as_datetime().map_or_else(
            || number_text(value.as_f64()),
            |date_time| date_time_text(&date_time.to_string()),
        ),
        Data::Error(error) => format!("#{error:?}"),
    }
}

/// Removes empty rows at the end and columns that are empty in every row at the end.
fn trimmed(mut rows: Vec<Vec<String>>) -> Vec<Vec<String>> {
    while rows
        .last()
        .is_some_and(|row| row.iter().all(String::is_empty))
    {
        rows.pop();
    }
    let width = rows
        .iter()
        .map(|row| {
            row.iter()
                .rposition(|cell| !cell.is_empty())
                .map_or(0, |last| last + 1)
        })
        .max()
        .unwrap_or(0);
    for row in &mut rows {
        row.truncate(width);
    }
    rows
}

/// Every worksheet with at least one value, in workbook order.
pub fn read_spreadsheet(path: &Path) -> ApplicationResult<Vec<SpreadsheetSheet>> {
    let size = fs::metadata(path)
        .map_err(|error| invalid(format!("cannot read the file: {error}")))?
        .len();
    if size > SPREADSHEET_MAX_BYTES {
        return Err(invalid(format!(
            "the file is larger than {SPREADSHEET_MAX_BYTES} bytes"
        )));
    }
    let mut workbook =
        open_workbook_auto(path).map_err(|error| invalid(format!("not a workbook: {error}")))?;
    let mut sheets = Vec::new();
    for name in workbook.sheet_names() {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|error| invalid(format!("sheet {name:?}: {error}")))?;
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
            rows.push(
                row.iter()
                    .take(SPREADSHEET_MAX_COLUMNS)
                    .map(cell_text)
                    .collect(),
            );
        }
        let rows = trimmed(rows);
        if !rows.is_empty() {
            sheets.push(SpreadsheetSheet {
                name,
                rows,
                truncated,
            });
        }
    }
    Ok(sheets)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_read_like_a_spreadsheet_shows_them() {
        assert_eq!(cell_text(&Data::Float(3.0)), "3");
        assert_eq!(cell_text(&Data::Float(2.5)), "2.5");
        assert_eq!(cell_text(&Data::Int(-4)), "-4");
        assert_eq!(cell_text(&Data::Bool(true)), "true");
        assert_eq!(cell_text(&Data::Empty), "");
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
        let rows = vec![
            vec!["a".to_owned(), String::new(), String::new()],
            vec![String::new(), "b".to_owned(), String::new()],
            vec![String::new(), String::new(), String::new()],
        ];
        assert_eq!(
            trimmed(rows),
            vec![
                vec!["a".to_owned(), String::new()],
                vec![String::new(), "b".to_owned()],
            ]
        );
    }
}
