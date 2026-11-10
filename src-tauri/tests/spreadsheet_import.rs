//! Reading spreadsheets for "Table from Spreadsheet…" against a small workbook in
//! `fixtures/spreadsheets/` (hand-made: inline strings and numbers on three sheets).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::file_dialogs::{FileDialogs, FileFilter};
use design_dawn_lib::application::folder_selection::FolderPickerError;
use design_dawn_lib::application::spreadsheet_import::{
    read_spreadsheet, select_and_read_spreadsheet, SpreadsheetSelection, SPREADSHEET_FILTER,
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

#[test]
fn every_sheet_with_values_is_read_in_workbook_order() {
    let sheets = read_spreadsheet(&fixture("sample.xlsx")).unwrap();
    let names: Vec<&str> = sheets.iter().map(|sheet| sheet.name.as_str()).collect();
    // The empty sheet is left out.
    assert_eq!(names, ["Tables", "項目"]);
    assert_eq!(
        sheets[0].rows,
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
        sheets[1].rows,
        strings(&[&["見出し", "値"], &["日本語", "1"]])
    );
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
