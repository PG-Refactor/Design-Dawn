//! An AI asking to add an image file to a Sheet. The MCP server leaves the request in
//! `<app config dir>/ai-image-requests/<requestId>.json`; the running app shows the picture
//! and asks the user, and only an "allow" there imports the file (validated like a dropped
//! image) and adds the Image Block. The server never reads or copies the file itself.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::constants::{AI_IMAGE_REQUESTS_DIRECTORY_NAME, AI_REQUEST_MAX_AGE_SECS};
use crate::application::error::ApplicationResult;
use crate::infrastructure::error::PersistenceError;

const FILE_EXTENSION: &str = "json";

/// What the AI asked for. `path` is the image file on this computer, as the AI gave it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiImageRequest {
    pub project_id: String,
    pub document_id: String,
    pub sheet_id: String,
    pub path: PathBuf,
    /// Where the image's top-left corner goes; `None` lets the app choose.
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub caption: Option<String>,
    pub requested_at: u64,
}

fn directory(config_dir: &Path) -> PathBuf {
    config_dir.join(AI_IMAGE_REQUESTS_DIRECTORY_NAME)
}

/// A request id is a UUID: nothing else may name a file in the directory.
fn file_of(config_dir: &Path, request_id: &str) -> Option<PathBuf> {
    uuid::Uuid::parse_str(request_id).ok()?;
    Some(directory(config_dir).join(format!("{request_id}.{FILE_EXTENSION}")))
}

fn io_error(context: &str, error: &std::io::Error) -> PersistenceError {
    PersistenceError::from_io(context, error)
}

/// Leaves a request and returns its id.
pub fn request_image(config_dir: &Path, request: &AiImageRequest) -> ApplicationResult<String> {
    let request_id = uuid::Uuid::now_v7().to_string();
    let folder = directory(config_dir);
    fs::create_dir_all(&folder).map_err(|error| io_error("create ai-image-requests", &error))?;
    let text = serde_json::to_string(request).unwrap_or_default();
    fs::write(folder.join(format!("{request_id}.{FILE_EXTENSION}")), text)
        .map_err(|error| io_error("write ai image request", &error))?;
    Ok(request_id)
}

fn read_request(path: &Path) -> Option<AiImageRequest> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// The waiting requests, oldest first. Old or unreadable ones are removed on the way.
pub fn pending_image_requests(config_dir: &Path, now: u64) -> Vec<(String, AiImageRequest)> {
    let Ok(entries) = fs::read_dir(directory(config_dir)) else {
        return Vec::new();
    };
    let mut pending: Vec<(String, AiImageRequest)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let request_id = path.file_stem()?.to_str()?.to_owned();
            match read_request(&path) {
                Some(request)
                    if uuid::Uuid::parse_str(&request_id).is_ok()
                        && now.saturating_sub(request.requested_at) <= AI_REQUEST_MAX_AGE_SECS =>
                {
                    Some((request_id, request))
                }
                _ => {
                    let _ = fs::remove_file(&path);
                    None
                }
            }
        })
        .collect();
    pending.sort_by_key(|(_, request)| request.requested_at);
    pending
}

/// The request, still waiting (for a preview).
pub fn peek_image_request(config_dir: &Path, request_id: &str) -> Option<AiImageRequest> {
    read_request(&file_of(config_dir, request_id)?)
}

/// The request, removed: it is answered exactly once.
pub fn take_image_request(config_dir: &Path, request_id: &str) -> Option<AiImageRequest> {
    let path = file_of(config_dir, request_id)?;
    let request = read_request(&path);
    let _ = fs::remove_file(&path);
    request
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "dawn-ai-image-requests-{}",
            uuid::Uuid::now_v7().simple()
        ))
    }

    fn request(at: u64) -> AiImageRequest {
        AiImageRequest {
            project_id: "p".to_owned(),
            document_id: "d".to_owned(),
            sheet_id: "s".to_owned(),
            path: PathBuf::from("/images/a.png"),
            x: Some(10),
            y: None,
            caption: None,
            requested_at: at,
        }
    }

    #[test]
    fn a_request_waits_until_taken_and_old_ones_are_dropped() {
        let config = temp_dir();
        let old = request_image(&config, &request(0)).unwrap();
        let fresh = request_image(&config, &request(1000)).unwrap();
        let pending = pending_image_requests(&config, 1000);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].0, fresh);
        assert!(peek_image_request(&config, &old).is_none());
        assert_eq!(take_image_request(&config, &fresh), Some(request(1000)));
        assert!(take_image_request(&config, &fresh).is_none());
        assert!(peek_image_request(&config, "../ai-access").is_none());
    }
}
