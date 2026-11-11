//! What AI tools changed, so the user can see it in the app and undo a text change. The MCP
//! server appends one line per successful write to `<app config dir>/ai-history/<projectId>.jsonl`
//! (outside the Project, so it never shows up in Git); the app only reads it. Only the server
//! that follows the app writes it: a server started with `--project` has no app settings.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::constants::{
    AI_HISTORY_DIRECTORY_NAME, AI_HISTORY_MAX_ENTRIES, AI_HISTORY_MAX_TEXT_BYTES,
};
use crate::application::error::ApplicationResult;
use crate::domain::entity_id::ProjectId;
use crate::infrastructure::error::PersistenceError;

const FILE_EXTENSION: &str = "jsonl";
const LINE_FEED: char = '\n';

/// One write by an AI tool. `before` is the Block's text before an `updateBlock` (omitted
/// when larger than `AI_HISTORY_MAX_TEXT_BYTES`); `afterHash` is the hash the tool returned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHistoryEntry {
    /// Seconds since the Unix epoch.
    pub at: u64,
    pub tool: String,
    pub document_id: Option<String>,
    pub sheet_id: Option<String>,
    pub block_id: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    pub after_hash: Option<String>,
}

fn path_of(config_dir: &Path, project_id: &ProjectId) -> PathBuf {
    config_dir
        .join(AI_HISTORY_DIRECTORY_NAME)
        .join(format!("{project_id}.{FILE_EXTENSION}"))
}

fn io_error(context: &str, error: &std::io::Error) -> PersistenceError {
    PersistenceError::from_io(context, error)
}

/// Texts above the limit are not kept (the entry still says what happened).
fn bounded(text: Option<String>) -> Option<String> {
    text.filter(|value| value.len() <= AI_HISTORY_MAX_TEXT_BYTES)
}

/// Appends an entry; when the file holds more than the limit, the oldest are dropped.
pub fn append(
    config_dir: &Path,
    project_id: &ProjectId,
    entry: AiHistoryEntry,
) -> ApplicationResult<()> {
    let path = path_of(config_dir, project_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error("create ai-history", &error))?;
    }
    let entry = AiHistoryEntry {
        before: bounded(entry.before),
        after: bounded(entry.after),
        ..entry
    };
    let line = serde_json::to_string(&entry).unwrap_or_default();
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| io_error("open ai-history", &error))?;
    writeln!(file, "{line}").map_err(|error| io_error("append ai-history", &error))?;
    drop(file);
    let entries = read(config_dir, project_id);
    if entries.len() > AI_HISTORY_MAX_ENTRIES {
        let kept: Vec<String> = entries
            .iter()
            .rev()
            .skip(entries.len() - AI_HISTORY_MAX_ENTRIES)
            .filter_map(|kept| serde_json::to_string(kept).ok())
            .collect();
        fs::write(&path, format!("{}{LINE_FEED}", kept.join("\n")))
            .map_err(|error| io_error("trim ai-history", &error))?;
    }
    Ok(())
}

/// Every readable entry, newest first. A missing file is an empty history; a line that does
/// not parse is skipped.
pub fn read(config_dir: &Path, project_id: &ProjectId) -> Vec<AiHistoryEntry> {
    let Ok(text) = fs::read_to_string(path_of(config_dir, project_id)) else {
        return Vec::new();
    };
    let mut entries: Vec<AiHistoryEntry> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    entries.reverse();
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("dawn-ai-history-{}", uuid::Uuid::now_v7().simple()))
    }

    fn entry(at: u64) -> AiHistoryEntry {
        AiHistoryEntry {
            at,
            tool: "updateBlock".to_owned(),
            document_id: None,
            sheet_id: None,
            block_id: None,
            before: Some("old".to_owned()),
            after: Some("new".to_owned()),
            after_hash: None,
        }
    }

    #[test]
    fn entries_come_back_newest_first_and_the_oldest_are_dropped() {
        let temp = temp_dir();
        let project = ProjectId::parse("01928f3a-5b6c-7d8e-9f01-23456789abcd").unwrap();
        for at in 0..(AI_HISTORY_MAX_ENTRIES as u64 + 3) {
            append(&temp, &project, entry(at)).unwrap();
        }
        let entries = read(&temp, &project);
        assert_eq!(entries.len(), AI_HISTORY_MAX_ENTRIES);
        assert_eq!(entries[0].at, AI_HISTORY_MAX_ENTRIES as u64 + 2);
        assert_eq!(entries.last().unwrap().at, 3);
    }

    #[test]
    fn a_large_text_is_not_kept() {
        let temp = temp_dir();
        let project = ProjectId::parse("01928f3a-5b6c-7d8e-9f01-23456789abcd").unwrap();
        let mut large = entry(1);
        large.before = Some("x".repeat(AI_HISTORY_MAX_TEXT_BYTES + 1));
        append(&temp, &project, large).unwrap();
        assert_eq!(read(&temp, &project)[0].before, None);
    }
}
