//! Payloads returned by Application operations and Commands. Entity payloads use the same
//! DTO shapes as the files on disk (docs/architecture.md §6.2).

use serde::Serialize;

use super::load_issue::LoadIssue;
use crate::infrastructure::file_format::dto::{DocumentDto, ProjectDto, SheetDto};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntityState {
    Loaded,
    /// Known by ID but unreadable; it is never written to.
    LoadFailed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEntry {
    pub document_id: String,
    /// Recovered from the file when possible; absent if the file is unreadable.
    pub name: Option<String>,
    pub state: EntityState,
}

/// `project.documentOrder` is the effective order: unlisted Documents appended, missing or
/// invalid entries dropped, so saving it writes the reconciled order back.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub project: ProjectDto,
    pub documents: Vec<DocumentEntry>,
    pub issues: Vec<LoadIssue>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPointSnapshot {
    pub snapshot: ProjectSnapshot,
    pub document_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSnapshot {
    pub sheet_id: String,
    pub name: Option<String>,
    pub state: EntityState,
    /// Present exactly when `state` is `loaded`.
    pub sheet: Option<SheetDto>,
}

/// `document.sheetOrder` is the effective order (see `ProjectSnapshot`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub document: DocumentDto,
    pub sheets: Vec<SheetSnapshot>,
    pub issues: Vec<LoadIssue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    /// False when the file already held the same bytes and was left untouched.
    pub written: bool,
}
