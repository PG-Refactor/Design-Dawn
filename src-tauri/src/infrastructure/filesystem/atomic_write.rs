//! Atomic Save and create-only writes.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::{TEMP_FILE_PREFIX, TEMP_FILE_SUFFIX};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    Written,
    /// The file already held exactly these bytes, so nothing was touched.
    Unchanged,
}

pub fn is_temp_file_name(name: &str) -> bool {
    name.len() > TEMP_FILE_PREFIX.len() + TEMP_FILE_SUFFIX.len()
        && name.starts_with(TEMP_FILE_PREFIX)
        && name.ends_with(TEMP_FILE_SUFFIX)
}

fn temp_path_for(target: &Path) -> Result<PathBuf, PersistenceError> {
    let file_name = target.file_name().and_then(|name| name.to_str());
    match (target.parent(), file_name) {
        (Some(directory), Some(name)) => {
            Ok(directory.join(format!("{TEMP_FILE_PREFIX}{name}{TEMP_FILE_SUFFIX}")))
        }
        _ => Err(PersistenceError::new(
            PersistenceErrorKind::IoError,
            format!("cannot derive a temp file for {}", target.display()),
        )),
    }
}

// Not every platform can open a directory for syncing; where it is unsupported the
// rename is still atomic, only its durability across power loss is weaker.
#[cfg(unix)]
fn sync_directory(directory: &Path) -> Result<(), PersistenceError> {
    File::open(directory)
        .and_then(|handle| handle.sync_all())
        .map_err(|error| {
            PersistenceError::from_io(format!("sync directory {}", directory.display()), &error)
        })
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> Result<(), PersistenceError> {
    Ok(())
}

fn write_temp_file(temp: &Path, bytes: &[u8]) -> Result<(), PersistenceError> {
    let context = format!("write {}", temp.display());
    // A leftover temp entry (crash residue, or a symlink planted in a cloned repository)
    // is removed rather than opened: opening it would follow a symlink and write outside
    // the Project. `remove_file` deletes the link itself, never its target.
    if fs::symlink_metadata(temp).is_ok() {
        fs::remove_file(temp).map_err(|error| PersistenceError::from_io(&context, &error))?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .map_err(|error| PersistenceError::from_io(&context, &error))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| PersistenceError::from_io(&context, &error))
}

/// Writes `bytes` to `target` via a same-directory temp file and `rename`. On failure the
/// temp file is removed and `target` is left as it was.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> Result<WriteOutcome, PersistenceError> {
    // A failed read only disables the skip-if-identical shortcut; the write below then
    // reports the real problem (for example when `target` is a directory).
    if fs::read(target).is_ok_and(|existing| existing == bytes) {
        return Ok(WriteOutcome::Unchanged);
    }
    let temp = temp_path_for(target)?;
    let result = write_temp_file(&temp, bytes).and_then(|()| {
        fs::rename(&temp, target).map_err(|error| {
            PersistenceError::from_io(format!("replace {}", target.display()), &error)
        })
    });
    if let Err(error) = result {
        // The original failure is what matters; a leftover temp is reported at next load.
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    if let Some(directory) = target.parent() {
        sync_directory(directory)?;
    }
    Ok(WriteOutcome::Written)
}

/// Creates `target` and fails with `alreadyExists` if anything is there, so a new file can
/// never replace existing data. A failed write removes the partial file again.
pub fn create_new_file(target: &Path, bytes: &[u8]) -> Result<(), PersistenceError> {
    let context = format!("create {}", target.display());
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| PersistenceError::from_io(&context, &error))?;
    let result = file
        .write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| PersistenceError::from_io(&context, &error));
    if result.is_err() {
        let _ = fs::remove_file(target);
    }
    result?;
    if let Some(directory) = target.parent() {
        sync_directory(directory)?;
    }
    Ok(())
}
