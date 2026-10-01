//! Resolves stored relative paths against a root and proves the result stays inside it
//! after symlinks are followed (docs/security.md §5).

use std::fs;
use std::path::{Path, PathBuf};

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
