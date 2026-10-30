//! A second, throwaway read of a Project, used to check what is on disk right now without
//! touching the open session. Reading through the open session would refresh its hash ledger
//! and so hide an external change from the write-before-check (docs/architecture.md §14.6);
//! a repair or a format update therefore reads here and writes through the open session.

use std::path::Path;

use super::document_operations::load_document;
use super::error::{ApplicationError, ApplicationResult};
use super::project_operations::load_project;
use super::session::{ProjectSession, ProjectSessions};
use super::snapshot::{DocumentSnapshot, ProjectSnapshot};
use crate::domain::entity_id::{DocumentId, ProjectId};

pub struct FreshScan {
    sessions: ProjectSessions,
    project_id: ProjectId,
    pub project: ProjectSnapshot,
}

impl FreshScan {
    /// Reads the Project in `root`. The Project there must still be `expected`: a folder that
    /// now holds another Project is not repaired on behalf of this session.
    pub fn open(root: &Path, expected: &ProjectId) -> ApplicationResult<Self> {
        let loaded = load_project(root)?;
        let project_id = *loaded.session.project_id();
        if project_id != *expected {
            return Err(ApplicationError::entity_not_found(format!(
                "the project on disk is {project_id}, not {expected}"
            )));
        }
        let mut sessions = ProjectSessions::default();
        sessions.insert(loaded.session);
        Ok(Self {
            sessions,
            project_id,
            project: loaded.snapshot,
        })
    }

    pub fn session(&mut self) -> &mut ProjectSession {
        self.sessions
            .get_mut(&self.project_id)
            .expect("the scan's own session is registered in `open`")
    }

    /// Every Document found on disk, loaded or not.
    pub fn document_ids(&mut self) -> Vec<DocumentId> {
        self.session().documents().keys().copied().collect()
    }

    pub fn load_document(
        &mut self,
        document_id: &DocumentId,
    ) -> ApplicationResult<DocumentSnapshot> {
        load_document(
            &mut self.sessions,
            &self.project_id.to_string(),
            &document_id.to_string(),
        )
    }
}
