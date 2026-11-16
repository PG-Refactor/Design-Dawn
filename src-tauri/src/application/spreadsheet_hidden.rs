//! The hidden rows and columns of each worksheet of an .xlsx / .xlsm file, read from the
//! file's own parts (calamine does not report them): `xl/workbook.xml` names the sheets,
//! its relationships give each sheet's part, and in a sheet part `<row hidden="1">` and
//! `<col min max hidden="1">` mark what is hidden.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use super::spreadsheet_import::sorted_positions;

const WORKBOOK_PART: &str = "xl/workbook.xml";
const WORKBOOK_RELATIONSHIPS_PART: &str = "xl/_rels/workbook.xml.rels";
const PART_FOLDER: &str = "xl/";
const TRUE_VALUES: &[&str] = &["1", "true"];
/// A part this large is not read (it would not be a sheet of the sizes that are imported).
const PART_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// The last column a worksheet can have (XFD): a `col` range may run to it.
const LAST_COLUMN: u32 = 16_384;

/// Zero-based hidden rows and columns.
pub type HiddenParts = (Vec<u32>, Vec<u32>);

fn part_text(archive: &mut zip::ZipArchive<BufReader<File>>, name: &str) -> Option<String> {
    let entry = archive.by_name(name).ok()?;
    let mut text = String::new();
    entry.take(PART_MAX_BYTES).read_to_string(&mut text).ok()?;
    Some(text)
}

fn unescaped(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn attribute(element: &BytesStart<'_>, name: &str) -> Option<String> {
    element.attributes().flatten().find_map(|attribute| {
        (attribute.key.local_name().as_ref() == name).then(|| unescaped(&attribute.value))
    })
}

/// Every start or empty element of a part, with its local name.
fn elements(text: &str, mut visit: impl FnMut(&str, &BytesStart<'_>)) {
    let mut reader = Reader::from_str(text);
    loop {
        match reader.read_event() {
            Ok(Event::Start(element) | Event::Empty(element)) => {
                visit(element.local_name().as_ref(), &element);
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
}

fn is_true(value: Option<String>) -> bool {
    value.is_some_and(|value| TRUE_VALUES.contains(&value.as_str()))
}

fn number(value: Option<String>) -> Option<u32> {
    value?.parse().ok()
}

fn hidden_in_sheet(text: &str) -> HiddenParts {
    let mut rows = HashSet::new();
    let mut columns = HashSet::new();
    elements(text, |name, element| match name {
        // `r` is one-based.
        "row" if is_true(attribute(element, "hidden")) => {
            if let Some(row) = number(attribute(element, "r")).and_then(|r| r.checked_sub(1)) {
                rows.insert(row);
            }
        }
        // `min` / `max` are one-based and inclusive.
        "col" if is_true(attribute(element, "hidden")) => {
            if let (Some(min), Some(max)) = (
                number(attribute(element, "min")),
                number(attribute(element, "max")),
            ) {
                for column in min.max(1)..=max.min(LAST_COLUMN) {
                    columns.insert(column - 1);
                }
            }
        }
        _ => {}
    });
    (sorted_positions(rows), sorted_positions(columns))
}

/// Per sheet name; `None` when the file cannot be read this way (then nothing is hidden).
pub fn hidden_rows_and_columns(path: &Path) -> Option<HashMap<String, HiddenParts>> {
    let file = File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(BufReader::new(file)).ok()?;
    let workbook = part_text(&mut archive, WORKBOOK_PART)?;
    let relationships = part_text(&mut archive, WORKBOOK_RELATIONSHIPS_PART)?;
    let mut targets = HashMap::new();
    elements(&relationships, |name, element| {
        if name == "Relationship" {
            if let (Some(id), Some(target)) =
                (attribute(element, "Id"), attribute(element, "Target"))
            {
                targets.insert(id, target);
            }
        }
    });
    let mut sheets = Vec::new();
    elements(&workbook, |name, element| {
        if name == "sheet" {
            if let (Some(sheet_name), Some(id)) =
                (attribute(element, "name"), attribute(element, "id"))
            {
                sheets.push((sheet_name, id));
            }
        }
    });
    let mut hidden = HashMap::new();
    for (sheet_name, id) in sheets {
        let Some(target) = targets.get(&id) else {
            continue;
        };
        // Targets are relative to `xl/`, or absolute from the package root.
        let part = target
            .strip_prefix('/')
            .map_or_else(|| format!("{PART_FOLDER}{target}"), str::to_owned);
        if let Some(text) = part_text(&mut archive, &part) {
            hidden.insert(sheet_name, hidden_in_sheet(&text));
        }
    }
    Some(hidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_rows_and_columns_are_read_zero_based() {
        let (rows, columns) = hidden_in_sheet(
            r#"<worksheet><cols><col min="2" max="3" hidden="1"/><col min="5" max="5" width="3"/></cols>
               <sheetData><row r="4" hidden="1"/><row r="5" hidden="0"/><row r="7" hidden="true"/></sheetData></worksheet>"#,
        );
        assert_eq!(rows, [3, 6]);
        assert_eq!(columns, [1, 2]);
    }
}
