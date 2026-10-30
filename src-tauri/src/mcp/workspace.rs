//! One tool call's view of the Project. It is read afresh for every call instead of being
//! kept: the app or a Git operation may have changed the files in between, and a session
//! opened just before the write is exactly what makes the hash ledger refuse a write over
//! a change made after the read.

use std::path::Path;

use crate::application::error::ApplicationError;
use crate::application::project_operations::open_project;
use crate::application::session::ProjectSessions;
use crate::application::snapshot::{DocumentSnapshot, ProjectSnapshot};
use crate::domain::entity_id::SheetId;
use crate::infrastructure::file_format::dto::SheetDto;

use super::tool_error::{ToolError, KIND_PROJECT_CHANGED, KIND_SHEET_NOT_LOADED};

pub struct Workspace {
    pub sessions: ProjectSessions,
    pub project_id: String,
    pub project: ProjectSnapshot,
}

impl Workspace {
    /// Opens the Project at `root` and checks it is still the one the server was started with.
    pub fn open(root: &Path, expected_project_id: &str) -> Result<Self, ToolError> {
        let mut sessions = ProjectSessions::default();
        let project = open_project(&mut sessions, root)?;
        if project.project.project_id != expected_project_id {
            return Err(ToolError::new(
                KIND_PROJECT_CHANGED,
                "the folder now holds a different Project than the one this server was started for",
            ));
        }
        Ok(Self {
            sessions,
            project_id: project.project.project_id.clone(),
            project,
        })
    }

    pub fn load_document(&mut self, document_id: &str) -> Result<DocumentSnapshot, ToolError> {
        Ok(crate::application::document_operations::load_document(
            &mut self.sessions,
            &self.project_id,
            document_id,
        )?)
    }
}

/// The loaded Sheet `sheet_id` of a loaded Document.
pub fn find_sheet<'a>(
    document: &'a DocumentSnapshot,
    sheet_id: &str,
) -> Result<&'a SheetDto, ToolError> {
    let sheet_id = SheetId::parse(sheet_id)?.to_string();
    let entry = document
        .sheets
        .iter()
        .find(|entry| entry.sheet_id == sheet_id)
        .ok_or_else(|| ApplicationError::entity_not_found("unknown sheetId"))?;
    entry.sheet.as_ref().ok_or_else(|| {
        ToolError::new(
            KIND_SHEET_NOT_LOADED,
            "the Sheet could not be read, so it cannot be used",
        )
    })
}
