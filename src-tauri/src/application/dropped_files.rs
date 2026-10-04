//! Files dropped onto the window (docs/architecture.md §6.2.2, same pattern as folder
//! selection). Rust keeps the dropped paths; the Frontend only ever sees an opaque `dropId`
//! and a file count, so an absolute path never crosses the IPC boundary.

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use uuid::Uuid;

use super::error::{ApplicationError, ApplicationResult, ErrorKind};

/// Payload of the `filesDropped` drop notification. Deliberately carries no path or file name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesDropped {
    pub drop_id: String,
    pub file_count: usize,
}

/// Payload of the `dragState` drop notification, so the UI can show drop feedback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DragState {
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DroppedFiles {
    drop_id: String,
    paths: Vec<PathBuf>,
}

/// The latest drop only. A new drop replaces it, so stale ids stop resolving; importing
/// from a drop does not consume it (the Frontend may retry after a partial failure).
#[derive(Debug, Default)]
pub struct DroppedFilesState {
    latest: Option<DroppedFiles>,
}

impl DroppedFilesState {
    fn replace(&mut self, paths: Vec<PathBuf>) -> FilesDropped {
        let drop_id = Uuid::now_v7().hyphenated().to_string();
        let file_count = paths.len();
        self.latest = Some(DroppedFiles {
            drop_id: drop_id.clone(),
            paths,
        });
        FilesDropped {
            drop_id,
            file_count,
        }
    }

    /// Unknown and replaced ids are indistinguishable on purpose: both are `invalidDropSelection`.
    pub fn resolve(&self, drop_id: &str) -> ApplicationResult<Vec<PathBuf>> {
        match &self.latest {
            Some(dropped) if dropped.drop_id == drop_id => Ok(dropped.paths.clone()),
            _ => Err(ApplicationError::new(
                ErrorKind::InvalidDropSelection,
                format!("unknown or expired dropId: {drop_id}"),
            )),
        }
    }
}

/// Records a drop and returns what the Frontend may be told. A drop without files is not
/// recorded (it would replace a still-usable earlier drop with nothing).
pub fn register_drop(
    state: &Mutex<DroppedFilesState>,
    paths: Vec<PathBuf>,
) -> Option<FilesDropped> {
    if paths.is_empty() {
        return None;
    }
    // The state is a single replaceable value, so a poisoned lock cannot hold a broken invariant.
    Some(
        state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .replace(paths),
    )
}

/// Looks the paths up and releases the lock before the caller touches the filesystem.
pub fn resolve_drop(
    state: &Mutex<DroppedFilesState>,
    drop_id: &str,
) -> ApplicationResult<Vec<PathBuf>> {
    state
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .resolve(drop_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_latest_drop_resolves_and_older_ones_expire() {
        let state = Mutex::new(DroppedFilesState::default());
        let first = register_drop(&state, vec![PathBuf::from("/a/one.png")]).unwrap();
        assert_eq!(first.file_count, 1);
        let second = register_drop(
            &state,
            vec![PathBuf::from("/a/two.png"), PathBuf::from("/a/three.png")],
        )
        .unwrap();
        assert_eq!(second.file_count, 2);
        assert_eq!(resolve_drop(&state, &second.drop_id).unwrap().len(), 2);
        assert_eq!(
            resolve_drop(&state, &first.drop_id).unwrap_err().kind,
            ErrorKind::InvalidDropSelection
        );
    }

    #[test]
    fn an_empty_drop_is_ignored_and_keeps_the_previous_one() {
        let state = Mutex::new(DroppedFilesState::default());
        let first = register_drop(&state, vec![PathBuf::from("/a/one.png")]).unwrap();
        assert!(register_drop(&state, Vec::new()).is_none());
        assert!(resolve_drop(&state, &first.drop_id).is_ok());
    }

    #[test]
    fn the_event_payload_has_no_path() {
        let payload = FilesDropped {
            drop_id: "id".to_owned(),
            file_count: 3,
        };
        assert_eq!(
            serde_json::to_string(&payload).unwrap(),
            r#"{"dropId":"id","fileCount":3}"#
        );
    }
}
