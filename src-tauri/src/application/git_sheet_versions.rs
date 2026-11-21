//! A Sheet as two versions Git knows, for comparing them as they look in the app: the
//! `sheet.json` and every file its Blocks show (texts, images), read from the index, HEAD or
//! the working tree. Read-only: nothing is written and no Git state changes.
//!
//! The two versions are those of a diff side: `unstaged` compares the index (before) with
//! the working tree (after), `staged` compares HEAD (before) with the index (after).

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use super::asset_import::base64;
use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::git_operations::GitRepositoryState;
use super::git_operations::{not_ready_error, project_root_of, repository_state, DiffSide};
use super::session::ProjectSessions;
use crate::domain::constants::SHEETS_DIRECTORY_NAME;
use crate::infrastructure::file_format::constants::{
    ASSET_MAX_BYTES, DOCUMENT_FILE_NAME, SHEET_FILE_NAME,
};
use crate::infrastructure::file_format::image_validation::{validate_image_content, ImageFormat};
use crate::infrastructure::git::constants::GIT_COMMAND_TIMEOUT;
use crate::infrastructure::git::paths::validate_project_relative_path;
use crate::infrastructure::git::runner::GitRunner;

const ARG_SHOW: &str = "show";
const HEAD_REVISION: &str = "HEAD";
const PATH_SEPARATOR: char = '/';
/// A `sheet.json` or a Block text larger than this is not shown (as in a conflict).
const TEXT_MAX_BYTES: usize = 2 * 1024 * 1024;
const BLOCKS_KEY: &str = "blocks";
const CONTENT_PATH_KEY: &str = "contentPath";
const DOCUMENT_ID_KEY: &str = "documentId";

/// One version of a Sheet: its `sheet.json` as written, and the files its Blocks show, by
/// their `contentPath` (texts as text, images as `data:` URLs). A file that is missing, too
/// large or not what its name says is left out (the Block shows that it cannot be read).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetVersion {
    pub sheet: String,
    pub texts: BTreeMap<String, String>,
    pub images: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetVersions {
    /// The Document the Sheet belongs to (from its `document.json` in the working tree, or
    /// else in the version before), so the app can open it.
    pub document_id: Option<String>,
    /// Absent where the Sheet does not exist (added, or deleted).
    pub before: Option<SheetVersion>,
    pub after: Option<SheetVersion>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Head,
    Index,
    WorkingTree,
}

/// The Document and Sheet folders a changed file is in: `<document>/sheets/<sheet>/...`.
/// None for a file outside any Sheet.
pub fn sheet_location(path: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = path.split(PATH_SEPARATOR).collect();
    let index = parts
        .iter()
        .rposition(|part| *part == SHEETS_DIRECTORY_NAME)?;
    // A Sheet folder and something inside it, under a Document folder.
    if index == 0 || index + 2 >= parts.len() {
        return None;
    }
    let document = parts[..index].join("/");
    let sheet = parts[..index + 2].join("/");
    Some((document, sheet))
}

fn read_version(
    runner: &GitRunner,
    root: &Path,
    source: Source,
    path: &str,
    max_bytes: usize,
) -> Option<Vec<u8>> {
    // Every path is checked like a requested one: inside the Project, no `..`.
    let valid = validate_project_relative_path(path).ok()?;
    let object = match source {
        Source::WorkingTree => {
            let bytes = std::fs::read(root.join(valid.as_str())).ok()?;
            return (bytes.len() <= max_bytes).then_some(bytes);
        }
        Source::Index => format!(":{}", valid.as_str()),
        Source::Head => format!("{HEAD_REVISION}:{}", valid.as_str()),
    };
    let output = runner
        .run_with_stdout_limit(
            &[ARG_SHOW, object.as_str()],
            root,
            None,
            GIT_COMMAND_TIMEOUT,
            max_bytes,
        )
        .ok()?;
    (output.success() && !output.stdout_truncated).then_some(output.stdout)
}

fn read_text(runner: &GitRunner, root: &Path, source: Source, path: &str) -> Option<String> {
    String::from_utf8(read_version(runner, root, source, path, TEXT_MAX_BYTES)?).ok()
}

fn read_image(runner: &GitRunner, root: &Path, source: Source, path: &str) -> Option<String> {
    let format = ImageFormat::from_file_name(path)?;
    let max = usize::try_from(ASSET_MAX_BYTES).unwrap_or(usize::MAX);
    let bytes = read_version(runner, root, source, path, max)?;
    validate_image_content(format, &bytes).ok()?;
    Some(format!(
        "data:{};base64,{}",
        format.mime_type(),
        base64(&bytes)
    ))
}

fn read_sheet(
    runner: &GitRunner,
    root: &Path,
    source: Source,
    document: &str,
    sheet: &str,
) -> Option<SheetVersion> {
    let text = read_text(runner, root, source, &format!("{sheet}/{SHEET_FILE_NAME}"))?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let mut texts = BTreeMap::new();
    let mut images = BTreeMap::new();
    let blocks = value.get(BLOCKS_KEY).and_then(Value::as_array);
    for content_path in blocks
        .into_iter()
        .flatten()
        .filter_map(|block| block.get(CONTENT_PATH_KEY).and_then(Value::as_str))
    {
        let path = format!("{document}/{content_path}");
        if ImageFormat::from_file_name(content_path).is_some() {
            if let Some(image) = read_image(runner, root, source, &path) {
                images.insert(content_path.to_owned(), image);
            }
        } else if let Some(body) = read_text(runner, root, source, &path) {
            texts.insert(content_path.to_owned(), body);
        }
    }
    Some(SheetVersion {
        sheet: text,
        texts,
        images,
    })
}

fn document_id_of(
    runner: &GitRunner,
    root: &Path,
    source: Source,
    document: &str,
) -> Option<String> {
    let text = read_text(
        runner,
        root,
        source,
        &format!("{document}/{DOCUMENT_FILE_NAME}"),
    )?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value
        .get(DOCUMENT_ID_KEY)
        .and_then(Value::as_str)
        .map(str::to_owned)
}

pub fn read_sheet_versions(
    runner: Option<&GitRunner>,
    root: &Path,
    path: &str,
    side: DiffSide,
) -> ApplicationResult<SheetVersions> {
    let state = repository_state(runner, root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(not_ready_error(state));
    };
    let valid = validate_project_relative_path(path).map_err(|reason| {
        ApplicationError::new(
            ErrorKind::InvalidGitPath,
            format!("a path to compare was rejected: {reason:?}"),
        )
    })?;
    let (document, sheet) = sheet_location(valid.as_str()).ok_or_else(|| {
        ApplicationError::new(ErrorKind::InvalidGitPath, "the path is not inside a Sheet")
    })?;
    let (before, after) = match side {
        DiffSide::Unstaged => (Source::Index, Source::WorkingTree),
        DiffSide::Staged => (Source::Head, Source::Index),
    };
    Ok(SheetVersions {
        document_id: document_id_of(runner, root, Source::WorkingTree, &document)
            .or_else(|| document_id_of(runner, root, before, &document)),
        before: read_sheet(runner, root, before, &document, &sheet),
        after: read_sheet(runner, root, after, &document, &sheet),
    })
}

pub fn git_sheet_versions(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    path: &str,
    side: DiffSide,
) -> ApplicationResult<SheetVersions> {
    let root = project_root_of(sessions, project_id)?;
    read_sheet_versions(GitRunner::discover().ok().as_ref(), &root, path, side)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_inside_a_sheet_names_its_document_and_sheet_folders() {
        assert_eq!(
            sheet_location("documents/design/sheets/overview/sheet.json"),
            Some((
                "documents/design".to_owned(),
                "documents/design/sheets/overview".to_owned()
            ))
        );
        assert_eq!(
            sheet_location("documents/f/design/sheets/a/blocks/markdown-1.md"),
            Some((
                "documents/f/design".to_owned(),
                "documents/f/design/sheets/a".to_owned()
            ))
        );
        assert_eq!(sheet_location("documents/design/document.json"), None);
        assert_eq!(sheet_location("documents/design/sheets/a"), None);
        assert_eq!(sheet_location("sheets/a/sheet.json"), None);
    }
}
