//! Open requests from outside the app. The path of a `.dawn`
//! stays in Rust: the Frontend asks for "the request of my window" and only ever receives
//! the opened Project's snapshot and a Document ID, never a path (same idea as `selectionId`).

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;

use super::error::{ApplicationError, ApplicationResult};
use super::project_operations::{
    peek_entry_point, peek_project_folder, prepare_entry_point, EntryPointResolution, PeekedTarget,
};
use super::session::ProjectSessions;
use super::snapshot::ProjectSnapshot;
use super::window_binding::{admit_prepared_entry_point, open_project_in_window, WindowOpenError};
use super::window_registry::WindowRegistry;
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::{ENTRY_POINT_EXTENSION, ENTRY_POINT_MAX_BYTES};

const FLAG_PREFIX: char = '-';

/// What a window is asked to open: a `.dawn` (Project + Document), or a whole Project
/// folder (the "open in a new window" action).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenRequest {
    EntryPoint(PathBuf),
    ProjectFolder(PathBuf),
}

fn has_entry_point_extension(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(ENTRY_POINT_EXTENSION))
}

/// The first non-flag argument that names a `.dawn`. `arguments` starts with the program
/// path (skipped). `working_directory` is the directory of the launching process: a second
/// launch forwarded by the single-instance plugin carries its own, not ours.
pub fn select_open_request(
    arguments: impl IntoIterator<Item = OsString>,
    working_directory: &Path,
) -> Option<OpenRequest> {
    arguments
        .into_iter()
        .skip(1)
        .find(|argument| {
            let is_flag = argument
                .to_str()
                .is_some_and(|text| text.starts_with(FLAG_PREFIX));
            !is_flag && has_entry_point_extension(Path::new(argument))
        })
        // `join` keeps an absolute argument as is and resolves a relative one.
        .map(|argument| OpenRequest::EntryPoint(working_directory.join(argument)))
}

/// Requests waiting for their window's Frontend, by window label. Each is handed out once.
#[derive(Debug, Default)]
pub struct PendingOpenRequests {
    by_window: HashMap<String, OpenRequest>,
}

impl PendingOpenRequests {
    pub fn put(&mut self, window_label: &str, request: OpenRequest) {
        self.by_window.insert(window_label.to_owned(), request);
    }

    pub fn take(&mut self, window_label: &str) -> Option<OpenRequest> {
        self.by_window.remove(window_label)
    }

    /// For a destroyed window: its request has nobody left to take it.
    pub fn discard(&mut self, window_label: &str) {
        self.by_window.remove(window_label);
    }
}

/// Serialized to the Frontend: deliberately no path of any kind.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRequest {
    pub snapshot: ProjectSnapshot,
    /// `None` for a Project folder: only the Project is opened.
    pub document_id: Option<String>,
    pub resolution: Option<EntryPointResolution>,
}

fn invalid_entry_point(detail: &str) -> ApplicationError {
    PersistenceError::new(PersistenceErrorKind::InvalidFileStructure, detail).into()
}

// The user chose this file, so a symlink to a regular file is fine (`metadata` follows it);
// what is refused is anything that is not a plain file, or is too big to be a `.dawn`.
fn check_entry_point_file(path: &Path) -> ApplicationResult<()> {
    if !has_entry_point_extension(path) {
        return Err(invalid_entry_point("not a .dawn file"));
    }
    let metadata = fs::metadata(path)
        .map_err(|error| PersistenceError::from_io(format!("stat {}", path.display()), &error))?;
    if !metadata.is_file() {
        return Err(invalid_entry_point("entry point is not a regular file"));
    }
    if metadata.len() > ENTRY_POINT_MAX_BYTES {
        return Err(invalid_entry_point("entry point file is too large"));
    }
    Ok(())
}

/// Which Project (and Document) the request is about, for routing only: nothing is opened
/// and no session is built. The same file checks as `take_open_request` apply, so a request
/// that would be refused there is refused here too.
pub fn resolve_open_target(request: &OpenRequest) -> ApplicationResult<PeekedTarget> {
    match request {
        OpenRequest::EntryPoint(path) => {
            check_entry_point_file(path)?;
            peek_entry_point(path)
        }
        OpenRequest::ProjectFolder(path) => peek_project_folder(path),
    }
}

/// Consumes the window's pending request (once, even when opening it fails) and opens it as
/// that window's Project; `projectOpenInOtherWindow` when another window has it.
/// `Ok(None)` when nothing is pending.
pub fn take_open_request(
    pending: &Mutex<PendingOpenRequests>,
    sessions: &mut ProjectSessions,
    registry: &mut WindowRegistry,
    window_label: &str,
) -> Result<Option<OpenedRequest>, WindowOpenError> {
    let request = pending
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take(window_label);
    // The window has its request now; whether opening succeeds or not, it no longer
    // "is about to open" the Project (a failed open must not keep claiming it).
    registry.clear_reservation(window_label);
    match request {
        None => Ok(None),
        Some(OpenRequest::EntryPoint(path)) => {
            check_entry_point_file(&path)?;
            let prepared = prepare_entry_point(&path)?;
            let opened = admit_prepared_entry_point(sessions, registry, window_label, prepared)?;
            Ok(Some(OpenedRequest {
                snapshot: opened.snapshot,
                document_id: Some(opened.document_id),
                resolution: Some(opened.resolution),
            }))
        }
        Some(OpenRequest::ProjectFolder(path)) => {
            let snapshot = open_project_in_window(sessions, registry, window_label, &path)?;
            Ok(Some(OpenedRequest {
                snapshot,
                document_id: None,
                resolution: None,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    fn select(values: &[&str]) -> Option<OpenRequest> {
        select_open_request(arguments(values), Path::new("/work"))
    }

    fn entry_point(path: &str) -> Option<OpenRequest> {
        Some(OpenRequest::EntryPoint(PathBuf::from(path)))
    }

    #[test]
    fn no_arguments_or_only_the_program_select_nothing() {
        assert_eq!(select(&[]), None);
        assert_eq!(select(&["app"]), None);
    }

    #[test]
    fn the_program_path_is_never_taken_as_the_request() {
        assert_eq!(select(&["/tmp/odd.dawn"]), None);
    }

    #[test]
    fn one_dawn_argument_is_selected() {
        assert_eq!(select(&["app", "/p/a.dawn"]), entry_point("/p/a.dawn"));
    }

    #[test]
    fn the_first_of_several_wins() {
        assert_eq!(
            select(&["app", "/p/a.dawn", "/p/b.dawn"]),
            entry_point("/p/a.dawn")
        );
    }

    #[test]
    fn flags_and_other_extensions_are_ignored() {
        assert_eq!(
            select(&[
                "app",
                "--open=x.dawn",
                "-x.dawn",
                "notes.md",
                "dawn",
                "/p/a.dawn"
            ]),
            entry_point("/p/a.dawn")
        );
        assert_eq!(select(&["app", "a.dawn.txt", "project.json"]), None);
    }

    #[test]
    fn the_extension_is_case_insensitive() {
        assert_eq!(select(&["app", "/p/A.DAWN"]), entry_point("/p/A.DAWN"));
        assert_eq!(select(&["app", "/p/a.Dawn"]), entry_point("/p/a.Dawn"));
    }

    #[test]
    fn a_relative_path_is_resolved_against_the_given_directory() {
        assert_eq!(
            select(&["app", "sub/a.dawn"]),
            entry_point("/work/sub/a.dawn")
        );
    }

    #[test]
    fn pending_requests_are_per_window_and_taken_once() {
        let mut pending = PendingOpenRequests::default();
        let request = OpenRequest::EntryPoint(PathBuf::from("/p/a.dawn"));
        pending.put("main", request.clone());
        assert_eq!(pending.take("window-2"), None);
        assert_eq!(pending.take("main"), Some(request));
        assert_eq!(pending.take("main"), None);
    }
}
