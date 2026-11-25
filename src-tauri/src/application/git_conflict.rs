//! Resolving a merge conflict in the app: the three versions Git keeps for a conflicted
//! file (common ancestor, ours, theirs), a structural merge for `sheet.json`, and writing
//! the chosen text and staging it. The merge commit is made with the ordinary Commit.

use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::asset_import::base64;
use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::export_markdown::write_file_atomically;
use super::git_operations::{
    project_root_of, read_file_statuses, stage_paths, validate_requested_paths, GitFileChange,
    GitStatusResult,
};
use super::session::ProjectSessions;
use super::sheet_merge::merge_sheet;
use crate::application::git_operations::ready_runner;
use crate::infrastructure::file_format::constants::{ASSET_MAX_BYTES, SHEET_FILE_NAME};
use crate::infrastructure::file_format::image_validation::{validate_image_content, ImageFormat};
use crate::infrastructure::git::constants::{
    ARG_QUIET, ARG_REV_PARSE, ARG_VERIFY, GIT_COMMAND_TIMEOUT,
};
use crate::infrastructure::git::runner::GitRunner;

const ARG_SHOW: &str = "show";
/// Index stages of a conflicted file: 1 the common ancestor, 2 ours, 3 theirs.
const STAGE_BASE: u8 = 1;
const STAGE_OURS: u8 = 2;
const STAGE_THEIRS: u8 = 3;
/// A version larger than this is not shown; the file is resolved outside the app.
const VERSION_MAX_BYTES: usize = 2 * 1024 * 1024;
const PATH_SEPARATOR: char = '/';

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub path: String,
    /// Absent when the side has no such file (added on one side, deleted on the other) or it
    /// is not text the app can show.
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// The working tree file, with Git's conflict markers.
    pub current: Option<String>,
    /// For `sheet.json`: the Block-by-Block merge, when it succeeds.
    pub merged: Option<String>,
    /// For `sheet.json`: the Block ids (and fields) that both sides changed differently.
    pub conflicting_blocks: Vec<String>,
    /// For a picture (by its extension): each version as a data URL, to choose between by
    /// looking. Absent for other files.
    pub images: Option<ConflictImages>,
}

/// The versions of a conflicted picture; a side is absent when it has no such file (or it
/// is not a valid picture of its format, or too large to show).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictImages {
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// The side deleted the file (choosing it deletes the file).
    pub ours_deleted: bool,
    pub theirs_deleted: bool,
}

/// Which side's file a conflict is resolved with (for files that cannot be merged by text).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

impl ConflictSide {
    fn stage(self) -> u8 {
        match self {
            Self::Ours => STAGE_OURS,
            Self::Theirs => STAGE_THEIRS,
        }
    }
}

fn picture_size_limit() -> usize {
    usize::try_from(ASSET_MAX_BYTES).unwrap_or(usize::MAX)
}

/// The bytes of one stage; `None` when the stage has no file or it cannot be read whole.
fn show_stage_bytes(
    runner: &GitRunner,
    root: &Path,
    stage: u8,
    path: &str,
    max_bytes: usize,
) -> Option<Vec<u8>> {
    let object = format!(":{stage}:{path}");
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

fn stage_picture(runner: &GitRunner, root: &Path, stage: u8, path: &str) -> Option<String> {
    let format = ImageFormat::from_file_name(path)?;
    let bytes = show_stage_bytes(runner, root, stage, path, picture_size_limit())?;
    validate_image_content(format, &bytes).ok()?;
    Some(format!(
        "data:{};base64,{}",
        format.mime_type(),
        base64(&bytes)
    ))
}

/// Whether the stage has a file (a side that deleted the file has none).
fn stage_exists(runner: &GitRunner, root: &Path, stage: u8, path: &str) -> ApplicationResult<bool> {
    let object = format!(":{stage}:{path}");
    let output = runner
        .run(
            &[ARG_REV_PARSE, ARG_VERIFY, ARG_QUIET, object.as_str()],
            root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| super::git_operations::run_error("rev-parse", error))?;
    match output.exit_code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        code => Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!("git rev-parse of a conflict stage exited with {code:?}"),
        )),
    }
}

fn show_stage(runner: &GitRunner, root: &Path, stage: u8, path: &str) -> Option<String> {
    let object = format!(":{stage}:{path}");
    let output = runner
        .run_with_stdout_limit(
            &[ARG_SHOW, object.as_str()],
            root,
            None,
            GIT_COMMAND_TIMEOUT,
            VERSION_MAX_BYTES,
        )
        .ok()?;
    if !output.success() || output.stdout_truncated {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

/// The path must be one the repository's own status lists as conflicted.
fn require_conflicted(runner: &GitRunner, root: &Path, path: &str) -> ApplicationResult<String> {
    let validated = validate_requested_paths(&[path.to_owned()], "resolve")?;
    let valid = validated
        .first()
        .ok_or_else(|| ApplicationError::new(ErrorKind::InvalidGitPath, "no path"))?;
    let conflicted = read_file_statuses(runner, root)?.iter().any(|file| {
        file.path == valid.as_str()
            && (file.worktree_status == GitFileChange::Unmerged
                || file.index_status == GitFileChange::Unmerged)
    });
    if conflicted {
        Ok(valid.as_str().to_owned())
    } else {
        Err(ApplicationError::new(
            ErrorKind::InvalidGitPath,
            "the path is not a conflicted file of the repository",
        ))
    }
}

pub fn read_conflict_versions(
    runner: Option<&GitRunner>,
    root: &Path,
    path: &str,
) -> ApplicationResult<ConflictVersions> {
    let runner = ready_runner(runner, root)?;
    let path = require_conflicted(runner, root, path)?;
    let base = show_stage(runner, root, STAGE_BASE, &path);
    let ours = show_stage(runner, root, STAGE_OURS, &path);
    let theirs = show_stage(runner, root, STAGE_THEIRS, &path);
    let current = std::fs::read_to_string(root.join(&path)).ok();
    let is_sheet = path.rsplit(PATH_SEPARATOR).next() == Some(SHEET_FILE_NAME);
    let (merged, conflicting_blocks) = match (is_sheet, &ours, &theirs) {
        (true, Some(ours_text), Some(theirs_text)) => {
            match merge_sheet(base.as_deref(), ours_text, theirs_text) {
                Ok(Ok(text)) => (Some(text), Vec::new()),
                Ok(Err(conflicts)) => (None, [conflicts.fields, conflicts.blocks].concat()),
                Err(_) => (None, Vec::new()),
            }
        }
        _ => (None, Vec::new()),
    };
    let images = match ImageFormat::from_file_name(&path) {
        None => None,
        Some(_) => Some(ConflictImages {
            base: stage_picture(runner, root, STAGE_BASE, &path),
            ours: stage_picture(runner, root, STAGE_OURS, &path),
            theirs: stage_picture(runner, root, STAGE_THEIRS, &path),
            ours_deleted: !stage_exists(runner, root, STAGE_OURS, &path)?,
            theirs_deleted: !stage_exists(runner, root, STAGE_THEIRS, &path)?,
        }),
    };
    Ok(ConflictVersions {
        path,
        base,
        ours,
        theirs,
        current,
        merged,
        conflicting_blocks,
        images,
    })
}

/// Writes `content` over the conflicted file (through a temporary file) and stages it.
pub fn resolve_conflict(
    runner: Option<&GitRunner>,
    root: &Path,
    path: &str,
    content: &str,
) -> ApplicationResult<GitStatusResult> {
    let ready = ready_runner(runner, root)?;
    let path = require_conflicted(ready, root, path)?;
    write_file_atomically(&root.join(&path), content.as_bytes())?;
    stage_paths(Some(ready), root, &[path])
}

/// Resolves the conflict with one side's file as it is (byte for byte, for a picture or any
/// file that cannot be merged as text) and stages it. A side without the file resolves it
/// by deleting the file.
pub fn resolve_conflict_with_side(
    runner: Option<&GitRunner>,
    root: &Path,
    path: &str,
    side: ConflictSide,
) -> ApplicationResult<GitStatusResult> {
    let ready = ready_runner(runner, root)?;
    let path = require_conflicted(ready, root, path)?;
    let target = root.join(&path);
    if stage_exists(ready, root, side.stage(), &path)? {
        let bytes = show_stage_bytes(ready, root, side.stage(), &path, picture_size_limit())
            .ok_or_else(|| {
                ApplicationError::new(
                    ErrorKind::GitCommandFailed,
                    "the chosen version could not be read whole",
                )
            })?;
        write_file_atomically(&target, &bytes)?;
    } else if target.exists() {
        std::fs::remove_file(&target).map_err(|error| {
            ApplicationError::new(
                ErrorKind::GitCommandFailed,
                format!("the file could not be removed: {error}"),
            )
        })?;
    }
    stage_paths(Some(ready), root, &[path])
}

pub fn git_resolve_conflict_with_side(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    path: &str,
    side: ConflictSide,
) -> ApplicationResult<GitStatusResult> {
    let root = project_root_of(sessions, project_id)?;
    resolve_conflict_with_side(GitRunner::discover().ok().as_ref(), &root, path, side)
}

pub fn git_conflict_versions(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    path: &str,
) -> ApplicationResult<ConflictVersions> {
    let root = project_root_of(sessions, project_id)?;
    read_conflict_versions(GitRunner::discover().ok().as_ref(), &root, path)
}

pub fn git_resolve_conflict(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    path: &str,
    content: &str,
) -> ApplicationResult<GitStatusResult> {
    let root = project_root_of(sessions, project_id)?;
    resolve_conflict(GitRunner::discover().ok().as_ref(), &root, path, content)
}
