//! Reading and writing one local state JSON file.

use std::fs;
use std::io;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::infrastructure::error::PersistenceError;
use crate::infrastructure::file_format::dto::{parse_dto, parse_json_text, to_json_bytes};
use crate::infrastructure::filesystem::atomic_write::write_atomic;
use crate::infrastructure::filesystem::text_content::decode_text;

/// `Ok(None)` when the file does not exist (a first run, not a problem). Every other
/// failure is an error the caller turns into defaults plus a visible load issue; the
/// file itself is never modified here.
pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, PersistenceError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(PersistenceError::from_io(
                format!("read {}", path.display()),
                &error,
            ))
        }
    };
    let text = decode_text(&bytes)?;
    parse_dto(parse_json_text(&text)?).map(Some)
}

/// Creates `directory` on demand (it may not exist before the first save), then writes
/// `directory/file_name` atomically.
pub fn write_json_file<T: Serialize>(
    directory: &Path,
    file_name: &str,
    value: &T,
) -> Result<(), PersistenceError> {
    fs::create_dir_all(directory).map_err(|error| {
        PersistenceError::from_io(format!("create {}", directory.display()), &error)
    })?;
    write_atomic(&directory.join(file_name), &to_json_bytes(value)?).map(|_| ())
}
