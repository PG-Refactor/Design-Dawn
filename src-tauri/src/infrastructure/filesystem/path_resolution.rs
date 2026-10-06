//! Resolves stored relative paths against a root and proves the result stays inside it
//! after symlinks are followed (docs/security.md §5).

use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::domain::constants::PATH_SEPARATOR;
use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};

/// Joins a `/`-separated relative path onto `base` segment by segment, so the stored form
/// is OS-independent. Callers validate the path; containment is enforced again on resolution.
pub fn join_relative(base: &Path, relative: &str) -> PathBuf {
    relative
        .split(PATH_SEPARATOR)
        .filter(|segment| !segment.is_empty())
        .fold(base.to_path_buf(), |path, segment| path.join(segment))
}

/// The canonical form every later containment check is made against.
pub fn canonicalize_root(path: &Path) -> Result<PathBuf, PersistenceError> {
    let canonical = fs::canonicalize(path).map_err(|error| {
        PersistenceError::from_io(format!("resolve {}", path.display()), &error)
    })?;
    if !canonical.is_dir() {
        return Err(PersistenceError::new(
            PersistenceErrorKind::IoError,
            format!("not a directory: {}", path.display()),
        ));
    }
    Ok(canonical)
}

fn ensure_within(root: &Path, resolved: &Path, relative: &str) -> Result<(), PersistenceError> {
    if resolved.starts_with(root) {
        Ok(())
    } else {
        Err(PersistenceError::new(
            PersistenceErrorKind::PathOutsideRoot,
            format!("{relative:?} resolves outside the root"),
        ))
    }
}

/// For a target that must already exist: canonicalizes (following symlinks) and verifies
/// the real location is under `root`. `root` must itself be canonical.
pub fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, PersistenceError> {
    let resolved = fs::canonicalize(join_relative(root, relative))
        .map_err(|error| PersistenceError::from_io(format!("resolve {relative:?}"), &error))?;
    ensure_within(root, &resolved, relative)?;
    Ok(resolved)
}

/// For a target that does not exist yet: the file itself cannot be canonicalized, so its
/// parent directory is. A dangling symlink at the target is not followed because creating
/// a file uses `create_new`, which fails on any existing entry.
pub fn resolve_for_create(root: &Path, relative: &str) -> Result<PathBuf, PersistenceError> {
    let candidate = join_relative(root, relative);
    let (Some(parent), Some(file_name)) = (candidate.parent(), candidate.file_name()) else {
        return Err(PersistenceError::new(
            PersistenceErrorKind::PathOutsideRoot,
            format!("{relative:?} has no file name"),
        ));
    };
    let resolved_parent = fs::canonicalize(parent).map_err(|error| {
        PersistenceError::from_io(format!("resolve parent of {relative:?}"), &error)
    })?;
    ensure_within(root, &resolved_parent, relative)?;
    Ok(resolved_parent.join(file_name))
}

/// For overwriting saves: an existing target is resolved through symlinks so the real file
/// is replaced; a missing target (removed externally) is recreated in its parent.
pub fn resolve_for_write(root: &Path, relative: &str) -> Result<PathBuf, PersistenceError> {
    if fs::symlink_metadata(join_relative(root, relative)).is_ok() {
        resolve_existing(root, relative)
    } else {
        resolve_for_create(root, relative)
    }
}

/// A directory name taken from the session must still be exactly one ordinary path segment,
/// so it can never climb out of its parent or name the parent itself.
fn is_single_normal_segment(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(segment)), None) if segment == name
    )
}

/// A directory that must be reached without crossing any symlink: its canonical path has to
/// equal the plain join of the (canonical) root and the stored path. Used for the parent
/// directories of a move, so a directory swapped for a link after loading is not followed.
/// `root` must be canonical.
pub fn resolve_real_directory(root: &Path, relative: &str) -> Result<PathBuf, PersistenceError> {
    let resolved = resolve_existing(root, relative)?;
    if resolved != join_relative(root, relative) || !resolved.is_dir() {
        return Err(PersistenceError::new(
            PersistenceErrorKind::PathOutsideRoot,
            format!("{relative:?} is not a real directory (a link is in the way)"),
        ));
    }
    Ok(resolved)
}

/// For recursive deletion of an entity directory. Returns its canonical path only if
/// - the entry itself is a real directory (a symlink is refused, never followed),
/// - the parent resolves inside `root` (so a symlinked ancestor cannot redirect the delete),
/// - the entry's real location is exactly `canonical(parent)/<directory_name>`, strictly
///   inside the parent and inside `root`, which also rules out `root` and the parent itself.
///
/// `root` must be canonical.
pub fn resolve_removable_directory(
    root: &Path,
    parent_relative: &str,
    directory_name: &str,
) -> Result<PathBuf, PersistenceError> {
    let refuse =
        |detail: String| PersistenceError::new(PersistenceErrorKind::PathOutsideRoot, detail);
    if !is_single_normal_segment(directory_name) {
        return Err(refuse(format!("not a directory name: {directory_name:?}")));
    }
    let parent = resolve_existing(root, parent_relative)?;
    let entry = parent.join(directory_name);
    let metadata = fs::symlink_metadata(&entry).map_err(|error| {
        PersistenceError::from_io(format!("inspect {directory_name:?}"), &error)
    })?;
    if !metadata.is_dir() {
        return Err(refuse(format!(
            "{directory_name:?} is not a real directory (symlinks are never deleted through)"
        )));
    }
    let canonical = fs::canonicalize(&entry).map_err(|error| {
        PersistenceError::from_io(format!("resolve {directory_name:?}"), &error)
    })?;
    if canonical != entry || canonical == root || !canonical.starts_with(root) {
        return Err(refuse(format!(
            "{directory_name:?} resolves outside its parent"
        )));
    }
    Ok(canonical)
}
