//! An AI asking the user for permission to edit a Project. The MCP server leaves a request
//! file in `<app config dir>/ai-requests/<projectId>.json` (one per Project, so asking again
//! adds nothing); the app shows it and answers by changing the AI access list itself. The
//! file only asks: whatever it says, nothing is granted without the user's answer in the
//! app, and the MCP server never writes the access list.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Number;

use super::constants::{AI_REQUESTS_DIRECTORY_NAME, AI_REQUEST_MAX_AGE_SECS};
use super::operations::check_schema_version;
use crate::application::error::ApplicationResult;
use crate::domain::entity_id::ProjectId;
use crate::infrastructure::error::PersistenceError;
use crate::infrastructure::local_state::constants::CURRENT_AI_REQUEST_SCHEMA_VERSION;
use crate::infrastructure::local_state::dto::AiRequestFileDto;
use crate::infrastructure::local_state::files::{read_json_file, write_json_file};

const REQUEST_FILE_EXTENSION: &str = "json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiRequestOutcome {
    Requested,
    // A request for the Project is waiting already (it was not renewed).
    AlreadyWaiting,
}

fn directory(config_dir: &Path) -> PathBuf {
    config_dir.join(AI_REQUESTS_DIRECTORY_NAME)
}

fn file_name(project_id: &ProjectId) -> String {
    format!("{project_id}.{REQUEST_FILE_EXTENSION}")
}

fn is_fresh(requested_at: u64, now: u64) -> bool {
    now.saturating_sub(requested_at) <= AI_REQUEST_MAX_AGE_SECS
}

fn read_request(path: &Path) -> Option<(ProjectId, u64)> {
    let dto = read_json_file::<AiRequestFileDto>(path).ok()??;
    check_schema_version(&dto.schema_version, CURRENT_AI_REQUEST_SCHEMA_VERSION).ok()?;
    let project_id = ProjectId::parse(&dto.project_id).ok()?;
    // The file is named by its Project, so a file that says otherwise is not trusted.
    let named = path.file_stem()?.to_str()?;
    (named == project_id.to_string()).then_some((project_id, dto.requested_at.as_u64()?))
}

/// Asks for write access to the Project (`now` in seconds since the Unix epoch). Used by the
/// MCP server.
pub fn request_write_access(
    config_dir: &Path,
    project_id: ProjectId,
    now: u64,
) -> ApplicationResult<AiRequestOutcome> {
    let path = directory(config_dir).join(file_name(&project_id));
    if read_request(&path).is_some_and(|(_, requested_at)| is_fresh(requested_at, now)) {
        return Ok(AiRequestOutcome::AlreadyWaiting);
    }
    write_json_file(
        &directory(config_dir),
        &file_name(&project_id),
        &AiRequestFileDto {
            schema_version: Number::from(CURRENT_AI_REQUEST_SCHEMA_VERSION),
            project_id: project_id.to_string(),
            requested_at: Number::from(now),
        },
    )?;
    Ok(AiRequestOutcome::Requested)
}

/// The Projects asked about, oldest request first. Requests that are too old or unreadable
/// are removed on the way (an AI that still wants access asks again).
pub fn pending_requests(config_dir: &Path, now: u64) -> Vec<ProjectId> {
    let Ok(entries) = fs::read_dir(directory(config_dir)) else {
        return Vec::new();
    };
    let mut pending: Vec<(u64, ProjectId)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        match read_request(&path) {
            Some((project_id, requested_at)) if is_fresh(requested_at, now) => {
                pending.push((requested_at, project_id));
            }
            // A temporary file of a write in progress is left alone.
            _ if path.extension().and_then(|ext| ext.to_str()) != Some(REQUEST_FILE_EXTENSION) => {}
            _ => {
                let _ = fs::remove_file(&path);
            }
        }
    }
    pending.sort();
    pending
        .into_iter()
        .map(|(_, project_id)| project_id)
        .collect()
}

/// The request was answered (or cannot be shown).
pub fn remove_request(config_dir: &Path, project_id: &ProjectId) -> ApplicationResult<()> {
    match fs::remove_file(directory(config_dir).join(file_name(project_id))) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PersistenceError::from_io("remove AI request", &error).into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIRST: &str = "01928f3a-0000-7000-8000-000000000001";
    const SECOND: &str = "01928f3a-0000-7000-8000-000000000002";
    const NOW: u64 = 1_800_000_000;

    fn id(text: &str) -> ProjectId {
        ProjectId::parse(text).unwrap()
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "dawn-ai-requests-{}",
            uuid::Uuid::now_v7().simple()
        ))
    }

    #[test]
    fn a_request_waits_once_per_project_and_is_listed_oldest_first() {
        let config = temp_dir();
        assert!(pending_requests(&config, NOW).is_empty());
        assert_eq!(
            request_write_access(&config, id(SECOND), NOW).unwrap(),
            AiRequestOutcome::Requested
        );
        assert_eq!(
            request_write_access(&config, id(SECOND), NOW + 1).unwrap(),
            AiRequestOutcome::AlreadyWaiting
        );
        request_write_access(&config, id(FIRST), NOW + 2).unwrap();
        assert_eq!(
            pending_requests(&config, NOW + 3),
            vec![id(SECOND), id(FIRST)]
        );

        remove_request(&config, &id(SECOND)).unwrap();
        remove_request(&config, &id(SECOND)).unwrap();
        assert_eq!(pending_requests(&config, NOW + 3), vec![id(FIRST)]);
        fs::remove_dir_all(&config).unwrap();
    }

    #[test]
    fn an_old_or_forged_request_is_dropped_and_an_old_one_can_be_renewed() {
        let config = temp_dir();
        request_write_access(&config, id(FIRST), NOW).unwrap();
        let later = NOW + AI_REQUEST_MAX_AGE_SECS + 1;
        assert_eq!(
            request_write_access(&config, id(FIRST), later).unwrap(),
            AiRequestOutcome::Requested
        );
        assert!(pending_requests(&config, later + AI_REQUEST_MAX_AGE_SECS + 1).is_empty());
        assert!(!directory(&config).join(file_name(&id(FIRST))).exists());

        // A file whose name and content disagree is removed, not shown.
        fs::write(
            directory(&config).join(file_name(&id(SECOND))),
            format!(r#"{{"schemaVersion":1,"projectId":"{FIRST}","requestedAt":{NOW}}}"#),
        )
        .unwrap();
        fs::write(directory(&config).join("junk.json"), "not json").unwrap();
        assert!(pending_requests(&config, NOW).is_empty());
        assert_eq!(fs::read_dir(directory(&config)).unwrap().count(), 0);
        fs::remove_dir_all(&config).unwrap();
    }
}
