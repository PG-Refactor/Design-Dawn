//! Documents on their way from one window to another. The sending window gives its
//! Document's state (unsaved changes and history included) as JSON; Rust keeps it, without
//! reading it, until the receiving window takes it. Each hand-over is taken once, and only
//! by the window it is addressed to.

use std::collections::HashMap;

use uuid::Uuid;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::config::DOCUMENT_TRANSFER_MAX_BYTES;
use crate::domain::entity_id::{DocumentId, ProjectId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingTransfer {
    pub transfer_id: String,
    pub project_id: ProjectId,
    pub document_id: DocumentId,
    /// The window that will take it.
    pub to: String,
    pub payload: String,
}

#[derive(Debug, Default)]
pub struct DocumentTransfers {
    by_id: HashMap<String, PendingTransfer>,
}

pub fn invalid_transfer(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::InvalidDocumentTransfer, detail)
}

impl DocumentTransfers {
    /// Keeps `payload` for `to` and returns the id it is taken by.
    pub fn put(
        &mut self,
        project_id: ProjectId,
        document_id: DocumentId,
        to: &str,
        payload: String,
    ) -> ApplicationResult<String> {
        if payload.len() > DOCUMENT_TRANSFER_MAX_BYTES {
            return Err(invalid_transfer(format!(
                "the hand-over is {} bytes, more than {DOCUMENT_TRANSFER_MAX_BYTES}",
                payload.len()
            )));
        }
        let transfer_id = Uuid::now_v7().hyphenated().to_string();
        self.by_id.insert(
            transfer_id.clone(),
            PendingTransfer {
                transfer_id: transfer_id.clone(),
                project_id,
                document_id,
                to: to.to_owned(),
                payload,
            },
        );
        Ok(transfer_id)
    }

    /// The hand-over, for the window it is addressed to (once).
    pub fn take(
        &mut self,
        window_label: &str,
        transfer_id: &str,
    ) -> ApplicationResult<PendingTransfer> {
        match self.by_id.get(transfer_id) {
            Some(transfer) if transfer.to == window_label => Ok(self
                .by_id
                .remove(transfer_id)
                .expect("the transfer was just found")),
            Some(_) => Err(invalid_transfer(format!(
                "transfer {transfer_id} is not addressed to window {window_label}"
            ))),
            None => Err(invalid_transfer(format!("unknown transfer {transfer_id}"))),
        }
    }

    /// Withdraws a hand-over that could not be delivered (its window failed to start).
    pub fn cancel(&mut self, transfer_id: &str) -> Option<PendingTransfer> {
        self.by_id.remove(transfer_id)
    }

    /// The ids of what waits for `window_label` (sent again when it subscribes).
    pub fn waiting_for(&self, window_label: &str) -> Vec<String> {
        let mut ids: Vec<String> = self
            .by_id
            .values()
            .filter(|transfer| transfer.to == window_label)
            .map(|transfer| transfer.transfer_id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// What waited for a window that is gone, to be delivered elsewhere.
    pub fn take_window(&mut self, window_label: &str) -> Vec<PendingTransfer> {
        let ids = self.waiting_for(window_label);
        ids.iter().filter_map(|id| self.by_id.remove(id)).collect()
    }

    /// Readdresses a hand-over (to another window of its Project).
    pub fn readdress(&mut self, mut transfer: PendingTransfer, to: &str) -> String {
        transfer.to = to.to_owned();
        let id = transfer.transfer_id.clone();
        self.by_id.insert(id.clone(), transfer);
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> ProjectId {
        ProjectId::parse("01928f3a-0000-7000-8000-000000000001").unwrap()
    }

    fn document() -> DocumentId {
        DocumentId::parse("01928f3a-0000-7000-8000-000000000101").unwrap()
    }

    #[test]
    fn a_hand_over_is_taken_once_by_its_window_only() {
        let mut transfers = DocumentTransfers::default();
        let id = transfers
            .put(project(), document(), "window-1", "{}".to_owned())
            .unwrap();
        assert_eq!(transfers.waiting_for("window-1"), vec![id.clone()]);
        let refused = transfers.take("main", &id).unwrap_err();
        assert_eq!(refused.kind, ErrorKind::InvalidDocumentTransfer);
        let taken = transfers.take("window-1", &id).unwrap();
        assert_eq!(taken.payload, "{}");
        assert!(transfers.take("window-1", &id).is_err());
    }

    #[test]
    fn a_too_large_hand_over_is_refused() {
        let mut transfers = DocumentTransfers::default();
        let payload = "x".repeat(DOCUMENT_TRANSFER_MAX_BYTES + 1);
        let refused = transfers
            .put(project(), document(), "window-1", payload)
            .unwrap_err();
        assert_eq!(refused.kind, ErrorKind::InvalidDocumentTransfer);
    }

    #[test]
    fn what_waited_for_a_gone_window_can_be_readdressed() {
        let mut transfers = DocumentTransfers::default();
        let id = transfers
            .put(project(), document(), "window-1", "{}".to_owned())
            .unwrap();
        let lost = transfers.take_window("window-1");
        assert_eq!(lost.len(), 1);
        assert!(transfers.waiting_for("window-1").is_empty());
        let readdressed = transfers.readdress(lost[0].clone(), "main");
        assert_eq!(readdressed, id);
        assert!(transfers.take("main", &id).is_ok());
    }
}
