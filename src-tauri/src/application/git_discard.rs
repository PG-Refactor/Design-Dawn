//! Discarding working tree changes (docs/git-development.md §11.14). The one Git operation
//! that loses data, so it accepts only what the repository's own status reports: tracked
//! files with a working tree change go back to the index, untracked regular files (or
//! links) are deleted. Nothing is run or removed unless every requested path is accepted.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::git_operations::{
    not_ready_error, project_root_of, read_file_statuses, read_git_status, repository_state,
    run_error, validate_requested_paths, GitFileChange, GitFileStatus, GitRepositoryState,
    GitStatusResult,
};
use crate::application::session::{document_base_path, ProjectSession, ProjectSessions};
use crate::domain::constants::PATH_SEPARATOR;
use crate::infrastructure::error::PersistenceError;
use crate::infrastructure::file_format::constants::{FOLDER_FILE_NAME, PROJECT_FILE_NAME};
use crate::infrastructure::git::constants::{
    ARG_PATHSPEC_FILE_NUL, ARG_PATHSPEC_FROM_STDIN, ARG_RESTORE, ARG_WORKTREE, GIT_COMMAND_TIMEOUT,
};
use crate::infrastructure::git::paths::{pathspec_stdin, ValidatedGitPath};
use crate::infrastructure::git::redaction::redact_credentials;
use crate::infrastructure::git::runner::GitRunner;

/// What discarding would overwrite in the open Project (docs/git-development.md §11.14).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiscardImpact {
    /// Documents with at least one requested path inside their directory, in the order the
    /// paths first reach them. The Frontend turns these into "unsaved edits are lost"
    /// warnings and reloads them afterwards.
    pub document_ids: Vec<String>,
    /// True when a requested path is `project.json` or a Folder's `folder.json`: the
    /// Project Tree held by the app no longer matches the files after a discard.
    pub project_files_affected: bool,
}

/// Which Documents and Project-level files the given paths belong to, for the open
/// Project. Read-only and independent of Git: it only maps paths onto the session's tree.
pub fn git_discard_impact(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    paths: &[String],
) -> ApplicationResult<GitDiscardImpact> {
    let validated = validate_requested_paths(paths, "discard")?;
    let mut guard = sessions
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let session = guard.session_mut(project_id)?;
    Ok(discard_impact_of(session, &validated))
}

/// `.dawn` entry point files are deliberately not Project files here: they only name a
/// Document to open and the session does not keep their content. `document.json` and
/// `sheet.json` are inside a Document's directory, so they count as that Document.
pub fn discard_impact_of(session: &ProjectSession, paths: &[ValidatedGitPath]) -> GitDiscardImpact {
    let document_directories: Vec<(String, String)> = session
        .documents()
        .iter()
        .map(|(document_id, record)| {
            (
                document_id.to_string(),
                format!(
                    "{}{PATH_SEPARATOR}",
                    document_base_path(&record.relative_path)
                ),
            )
        })
        .collect();
    let folder_files: Vec<String> = session
        .folders()
        .values()
        .map(|record| {
            format!(
                "{}{PATH_SEPARATOR}{FOLDER_FILE_NAME}",
                document_base_path(&record.relative_path)
            )
        })
        .collect();

    let mut document_ids: Vec<String> = Vec::new();
    let mut project_files_affected = false;
    for path in paths {
        let path = path.as_str();
        if path == PROJECT_FILE_NAME || folder_files.iter().any(|file| file == path) {
            project_files_affected = true;
        }
        let document = document_directories
            .iter()
            .find(|(_, directory)| path.starts_with(directory.as_str()));
        if let Some((document_id, _)) = document {
            if !document_ids.contains(document_id) {
                document_ids.push(document_id.clone());
            }
        }
    }
    GitDiscardImpact {
        document_ids,
        project_files_affected,
    }
}

/// Discards the given Project-relative paths with the `git` found on PATH.
pub fn git_discard(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    paths: &[String],
) -> ApplicationResult<GitStatusResult> {
    let project_root = project_root_of(sessions, project_id)?;
    discard_paths(GitRunner::discover().ok().as_ref(), &project_root, paths)
}

/// The accepted request, split by how each path is discarded.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DiscardPlan {
    /// Tracked files with a working tree change: `git restore --worktree`.
    pub restore: Vec<ValidatedGitPath>,
    /// Untracked files: removed from the file system.
    pub delete: Vec<ValidatedGitPath>,
}

/// Working tree changes of a tracked file that go back to the index.
fn is_restorable(change: GitFileChange) -> bool {
    matches!(
        change,
        GitFileChange::Modified | GitFileChange::Deleted | GitFileChange::TypeChanged
    )
}

fn rejected(detail: &str) -> ApplicationError {
    ApplicationError::new(ErrorKind::GitDiscardRejected, detail)
}

/// Sorts the requested paths by the status of each. Any path that is not exactly one of
/// the two discardable kinds rejects the whole request: staged-only entries (nothing in the
/// working tree to discard), conflicts (an unmerged entry has no single state to go back
/// to), unchanged / ignored files, unknown names and directories (never in the status).
pub fn plan_discard(
    current: &[GitFileStatus],
    requested: &[ValidatedGitPath],
) -> ApplicationResult<DiscardPlan> {
    let mut plan = DiscardPlan::default();
    for path in requested {
        let entry = current.iter().find(|file| file.path == path.as_str());
        let Some(entry) = entry else {
            return Err(rejected("a path to discard is not listed by the status"));
        };
        let conflicted = entry.index_status == GitFileChange::Unmerged
            || entry.worktree_status == GitFileChange::Unmerged;
        if conflicted {
            return Err(rejected("a path to discard is in conflict"));
        }
        if entry.worktree_status == GitFileChange::Untracked {
            plan.delete.push(path.clone());
        } else if is_restorable(entry.worktree_status) {
            plan.restore.push(path.clone());
        } else {
            return Err(rejected("a path to discard has no working tree change"));
        }
    }
    Ok(plan)
}

/// Discards working tree changes (docs/git-development.md §11.14). Order: the request is
/// validated and planned against a fresh status, the untracked files are checked on disk
/// (still before anything changes), then tracked files are restored (the step that can fail
/// for git's own reasons), and only then the untracked files are deleted. On a failure
/// after the first change the caller reads the status again. Returns the status read
/// afterwards. Never saves anything.
pub fn discard_paths(
    runner: Option<&GitRunner>,
    project_root: &Path,
    paths: &[String],
) -> ApplicationResult<GitStatusResult> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(not_ready_error(state));
    };

    let requested = validate_requested_paths(paths, "discard")?;
    if requested.is_empty() {
        return read_git_status(Some(runner), project_root);
    }

    let current = read_file_statuses(runner, project_root)?;
    let plan = plan_discard(&current, &requested)?;
    let mut deletions: Vec<PathBuf> = Vec::new();
    for path in &plan.delete {
        deletions.push(untracked_file_location(project_root, path)?);
    }

    if let Ok(stdin) = pathspec_stdin(&plan.restore) {
        let arguments = [
            ARG_RESTORE,
            ARG_WORKTREE,
            ARG_PATHSPEC_FROM_STDIN,
            ARG_PATHSPEC_FILE_NUL,
        ];
        let output = runner
            .run(&arguments, project_root, Some(&stdin), GIT_COMMAND_TIMEOUT)
            .map_err(|error| run_error("restore", error))?;
        if !output.success() {
            return Err(ApplicationError::new(
                ErrorKind::GitCommandFailed,
                format!(
                    "git restore exited with {:?}: {}",
                    output.exit_code(),
                    redact_credentials(output.stderr_text().trim_end())
                ),
            ));
        }
    }

    for location in &deletions {
        remove_file_or_link(location).map_err(|error| {
            ApplicationError::from(PersistenceError::from_io(
                "remove an untracked file",
                &error,
            ))
        })?;
    }
    read_git_status(Some(runner), project_root)
}

/// The file system location of an untracked path, or a rejection. The path must be a
/// regular file or a symbolic link itself (checked without following the link), and every
/// directory above it must be a real directory inside the Project root: a symbolic link in
/// the middle could lead outside, so the canonical parent has to equal the root plus the
/// path's own directory segments. Git never lists files below a symlinked directory, so
/// this guards against a path that changed between the status and the removal.
pub fn untracked_file_location(
    project_root: &Path,
    path: &ValidatedGitPath,
) -> ApplicationResult<PathBuf> {
    let mut segments: Vec<&str> = path.as_str().split(PATH_SEPARATOR).collect();
    let Some(file_name) = segments.pop() else {
        return Err(rejected("an untracked path has no file name"));
    };
    let canonical_root = project_root
        .canonicalize()
        .map_err(|error| io_application_error("resolve the project root", &error))?;
    let expected_parent = segments
        .iter()
        .fold(canonical_root, |directory, segment| directory.join(segment));
    let parent = segments
        .iter()
        .fold(project_root.to_path_buf(), |directory, segment| {
            directory.join(segment)
        });
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| rejected("the directory of an untracked path cannot be resolved"))?;
    if canonical_parent != expected_parent {
        return Err(rejected(
            "an untracked path is reached through a link or leaves the project",
        ));
    }
    let location = canonical_parent.join(file_name);
    let metadata = fs::symlink_metadata(&location)
        .map_err(|_| rejected("an untracked path does not exist"))?;
    let file_type = metadata.file_type();
    if !(file_type.is_file() || file_type.is_symlink()) {
        return Err(rejected("an untracked path is neither a file nor a link"));
    }
    Ok(location)
}

fn io_application_error(context: &str, error: &io::Error) -> ApplicationError {
    ApplicationError::from(PersistenceError::from_io(context, error))
}

/// Removes the entry itself; for a link that is the link, never its target.
fn remove_file_or_link(location: &Path) -> io::Result<()> {
    match fs::remove_file(location) {
        Ok(()) => Ok(()),
        // A symbolic link to a directory is removed with `remove_dir` on Windows. The target
        // is not touched either way; only an entry that is a link gets this second chance.
        #[cfg(windows)]
        Err(_) if fs::symlink_metadata(location)?.file_type().is_symlink() => {
            fs::remove_dir(location)
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::git::paths::validate_project_relative_path;

    fn path(text: &str) -> ValidatedGitPath {
        validate_project_relative_path(text).unwrap()
    }

    fn status(name: &str, index: GitFileChange, worktree: GitFileChange) -> GitFileStatus {
        GitFileStatus {
            path: name.to_owned(),
            index_status: index,
            worktree_status: worktree,
            original_path: None,
        }
    }

    use GitFileChange::{
        Added, Deleted, Ignored, Modified, Renamed, TypeChanged, Unmerged, Unmodified, Untracked,
    };

    #[test]
    fn tracked_worktree_changes_are_restored_and_untracked_files_are_deleted() {
        let current = vec![
            status("m.md", Unmodified, Modified),
            status("d.md", Unmodified, Deleted),
            status("t.md", Unmodified, TypeChanged),
            status("mm.md", Modified, Modified),
            status("am.md", Added, Modified),
            status("rm.md", Renamed, Modified),
            status("new.md", Untracked, Untracked),
        ];
        let requested: Vec<ValidatedGitPath> = current.iter().map(|f| path(&f.path)).collect();

        let plan = plan_discard(&current, &requested).unwrap();

        assert_eq!(
            plan.restore,
            ["m.md", "d.md", "t.md", "mm.md", "am.md", "rm.md"].map(path)
        );
        assert_eq!(plan.delete, [path("new.md")]);
    }

    #[test]
    fn everything_else_rejects_the_whole_request() {
        for entry in [
            status("staged.md", Modified, Unmodified),
            status("added.md", Added, Unmodified),
            status("conflict.md", Unmerged, Unmerged),
            status("conflict-one-side.md", Unmodified, Unmerged),
            status("same.md", Unmodified, Unmodified),
            status("ignored.md", Ignored, Ignored),
        ] {
            let name = entry.path.clone();
            let current = vec![status("ok.md", Unmodified, Modified), entry];

            let error = plan_discard(&current, &[path("ok.md"), path(&name)]).unwrap_err();

            assert_eq!(error.kind, ErrorKind::GitDiscardRejected, "{name}");
        }
    }

    #[test]
    fn a_path_the_status_does_not_list_is_rejected() {
        let current = vec![status("a.md", Unmodified, Modified)];

        for unknown in ["dir", "*.md", "a.md/", "missing.md"] {
            let requested = validate_project_relative_path(unknown);
            if let Ok(requested) = requested {
                let error = plan_discard(&current, &[requested]).unwrap_err();
                assert_eq!(error.kind, ErrorKind::GitDiscardRejected, "{unknown}");
            }
        }
    }

    #[test]
    fn the_plan_keeps_the_order_of_the_request() {
        let current = vec![
            status("a.md", Unmodified, Modified),
            status("b.md", Unmodified, Modified),
        ];

        let plan = plan_discard(&current, &[path("b.md"), path("a.md")]).unwrap();

        assert_eq!(plan.restore, [path("b.md"), path("a.md")]);
    }

    #[test]
    fn the_impact_wire_form_is_camel_case() {
        let impact = GitDiscardImpact {
            document_ids: vec!["x".to_owned()],
            project_files_affected: true,
        };

        assert_eq!(
            serde_json::to_value(impact).unwrap(),
            serde_json::json!({ "documentIds": ["x"], "projectFilesAffected": true })
        );
    }
}
