//! Reading spreadsheets for "Table from Spreadsheet…" against small files in
//! `fixtures/spreadsheets/`, all hand-made: `sample.xlsx` (inline strings and numbers on
//! three sheets); `features.xlsx` (sheet "Spec & Notes" from B2: a merged B3:B4, hidden
//! column E and row 5, a yen and a percentage format, a cell with a line break and one with
//! a link; a hidden sheet "Hidden"); `sample.csv` (quoted cells) and `sjis.tsv` (Shift_JIS).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::file_dialogs::{FileDialogs, FileFilter};
use design_dawn_lib::application::folder_selection::FolderPickerError;
use design_dawn_lib::application::spreadsheet_import::{
    read_spreadsheet, select_and_read_spreadsheet, MergedArea, SpreadsheetSelection,
    SpreadsheetSheet, SPREADSHEET_FILTER,
};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/spreadsheets")
        .join(name)
}

fn strings(rows: &[&[&str]]) -> Vec<Vec<String>> {
    rows.iter()
        .map(|row| row.iter().map(|cell| (*cell).to_owned()).collect())
        .collect()
}

fn texts(sheet: &SpreadsheetSheet) -> Vec<Vec<String>> {
    sheet
        .rows
        .iter()
        .map(|row| row.iter().map(|cell| cell.text.clone()).collect())
        .collect()
}

#[test]
fn every_sheet_with_values_is_read_in_workbook_order() {
    let sheets = read_spreadsheet(&fixture("sample.xlsx")).unwrap();
    let names: Vec<&str> = sheets.iter().map(|sheet| sheet.name.as_str()).collect();
    // The empty sheet is left out.
    assert_eq!(names, ["Tables", "項目"]);
    assert_eq!(
        texts(&sheets[0]),
        strings(&[
            &["Name", "Type"],
            &["id", "uuid"],
            &["total", "12"],
            &["rate", "2.5"],
            &["note | pipe", ""],
        ])
    );
    assert!(!sheets[0].truncated);
    assert_eq!(
        texts(&sheets[1]),
        strings(&[&["見出し", "値"], &["日本語", "1"]])
    );
}

#[test]
fn a_workbook_tells_its_formats_links_merges_and_hidden_parts() {
    let sheets = read_spreadsheet(&fixture("features.xlsx")).unwrap();
    let names: Vec<(&str, bool)> = sheets
        .iter()
        .map(|sheet| (sheet.name.as_str(), sheet.hidden))
        .collect();
    assert_eq!(names, [("Spec & Notes", false), ("Hidden", true)]);
    let spec = &sheets[0];
    assert_eq!((spec.first_row, spec.first_column), (1, 1));
    assert_eq!(
        texts(spec),
        strings(&[
            &["Item", "Price", "Rate", "Secret"],
            &["Group A", "¥1,200", "12.5%", "x"],
            &["", "3,400.50", "1", ""],
            &["skip", "", "", ""],
            &["line1\nline2", "Docs", "", ""],
        ])
    );
    assert!(spec.rows[1][1].number && spec.rows[1][2].number);
    assert!(!spec.rows[0][1].number);
    assert_eq!(
        spec.rows[4][1].link.as_deref(),
        Some("https://example.com/docs")
    );
    assert_eq!(spec.hidden_rows, [4]);
    assert_eq!(spec.hidden_columns, [4]);
    assert_eq!(
        spec.merged,
        [MergedArea {
            first_row: 2,
            first_column: 1,
            last_row: 3,
            last_column: 1
        }]
    );
}

#[test]
fn csv_and_tsv_files_are_one_sheet_each() {
    let csv = read_spreadsheet(&fixture("sample.csv")).unwrap();
    assert_eq!(csv[0].name, "sample");
    assert_eq!(
        texts(&csv[0]),
        strings(&[
            &["Name", "Note"],
            &["a, b", "say \"hi\""],
            &["設計", "multi\nline"],
        ])
    );
    let tsv = read_spreadsheet(&fixture("sjis.tsv")).unwrap();
    assert_eq!(texts(&tsv[0]), strings(&[&["id", "name"], &["1", "注文"]]));
    assert!(tsv[0].rows[1][0].number);
}

#[test]
fn a_file_that_is_not_a_workbook_is_invalid_spreadsheet() {
    let error = read_spreadsheet(&fixture("not-a-workbook.xlsx")).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidSpreadsheet);
    let missing = read_spreadsheet(&fixture("missing.xlsx")).unwrap_err();
    assert_eq!(missing.kind, ErrorKind::InvalidSpreadsheet);
}

struct Answering {
    chosen: Option<PathBuf>,
    asked: Mutex<Vec<FileFilter>>,
}

impl FileDialogs for Answering {
    fn pick_file(&self, filter: FileFilter) -> Result<Option<PathBuf>, FolderPickerError> {
        self.asked.lock().unwrap().push(filter);
        Ok(self.chosen.clone())
    }

    fn save_file(&self, _: FileFilter, _: &str) -> Result<Option<PathBuf>, FolderPickerError> {
        Ok(None)
    }
}

#[test]
fn the_dialog_offers_spreadsheets_and_hands_back_only_the_file_name() {
    let dialogs = Answering {
        chosen: Some(fixture("sample.xlsx")),
        asked: Mutex::new(Vec::new()),
    };
    let SpreadsheetSelection::Selected { file_name, sheets } =
        select_and_read_spreadsheet(&dialogs).unwrap()
    else {
        panic!("a selection is expected");
    };
    assert_eq!(file_name, "sample.xlsx");
    assert_eq!(sheets.len(), 2);
    assert_eq!(*dialogs.asked.lock().unwrap(), [SPREADSHEET_FILTER]);
}

#[test]
fn a_cancelled_dialog_reads_nothing() {
    let dialogs = Answering {
        chosen: None,
        asked: Mutex::new(Vec::new()),
    };
    assert_eq!(
        select_and_read_spreadsheet(&dialogs).unwrap(),
        SpreadsheetSelection::Cancelled
    );
}
