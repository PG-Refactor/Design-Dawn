//! The sheet each Document was last shown with, so a Document opened again shows it. A view
//! choice of this computer: kept with the other local state, never in the Project (it is
//! not shared through Git and does not change a file when the user only looks around).

use serde::{Deserialize, Serialize};
use serde_json::Number;

use crate::application::error::ApplicationResult;
use crate::domain::entity_id::{DocumentId, ProjectId, SheetId};

/// The two ids that identify a Document across Projects. Only their form is checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActiveSheetKey {
    pub project_id: ProjectId,
    pub document_id: DocumentId,
}

impl ActiveSheetKey {
    pub fn parse(project_id: &str, document_id: &str) -> ApplicationResult<Self> {
        Ok(Self {
            project_id: ProjectId::parse(project_id)?,
            document_id: DocumentId::parse(document_id)?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSheetsFileDto {
    pub schema_version: Number,
    pub documents: Vec<ActiveSheetEntryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSheetEntryDto {
    pub project_id: String,
    pub document_id: String,
    pub sheet_id: String,
}

pub type ActiveSheetEntries = Vec<(ActiveSheetKey, SheetId)>;

pub fn entry_from_dto(dto: &ActiveSheetEntryDto) -> ApplicationResult<(ActiveSheetKey, SheetId)> {
    Ok((
        ActiveSheetKey::parse(&dto.project_id, &dto.document_id)?,
        SheetId::parse(&dto.sheet_id)?,
    ))
}

pub fn entry_to_dto(key: &ActiveSheetKey, sheet_id: &SheetId) -> ActiveSheetEntryDto {
    ActiveSheetEntryDto {
        project_id: key.project_id.to_string(),
        document_id: key.document_id.to_string(),
        sheet_id: sheet_id.to_string(),
    }
}

/// `entries` with `sheet_id` as the newest record for `key`, the oldest dropped beyond `max`.
pub fn with_active_sheet(
    mut entries: ActiveSheetEntries,
    key: ActiveSheetKey,
    sheet_id: SheetId,
    max: usize,
) -> ActiveSheetEntries {
    entries.retain(|(entry_key, _)| *entry_key != key);
    entries.push((key, sheet_id));
    if entries.len() > max {
        let excess = entries.len() - max;
        entries.drain(..excess);
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: &str = "01928f3a-5b6c-7d8e-9f01-23456789abcd";
    const DOCUMENT: &str = "01928f3a-6c7d-7e8f-a012-3456789abcde";
    const OTHER_DOCUMENT: &str = "01928f3a-0002-7aaa-8bbb-0123456789ab";
    const SHEET: &str = "01928f3a-7d8e-7f90-b123-456789abcdef";
    const OTHER_SHEET: &str = "01928f3a-7d8e-7f90-b123-456789abcd00";

    #[test]
    fn the_latest_sheet_of_a_document_replaces_its_earlier_one_and_old_ones_go() {
        let key = ActiveSheetKey::parse(PROJECT, DOCUMENT).unwrap();
        let other = ActiveSheetKey::parse(PROJECT, OTHER_DOCUMENT).unwrap();
        let first = SheetId::parse(SHEET).unwrap();
        let second = SheetId::parse(OTHER_SHEET).unwrap();
        let entries = with_active_sheet(Vec::new(), key, first, 2);
        let entries = with_active_sheet(entries, other, first, 2);
        let entries = with_active_sheet(entries, key, second, 2);
        assert_eq!(entries, vec![(other, first), (key, second)]);
        let third = ActiveSheetKey::parse(PROJECT, "01928f3a-0003-7aaa-8bbb-0123456789ab").unwrap();
        let entries = with_active_sheet(entries, third, first, 2);
        assert_eq!(entries, vec![(key, second), (third, first)]);
    }
}
