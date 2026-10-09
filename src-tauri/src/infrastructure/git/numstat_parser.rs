//! Parser for `git diff --numstat -z` (docs/git-development.md §11.10). Only one question
//! is asked of it: does git treat any listed file as binary?
//!
//! ```text
//! <added> TAB <deleted> TAB <path> NUL                         (modified, added, deleted)
//! <added> TAB <deleted> TAB NUL <oldPath> NUL <newPath> NUL    (rename / copy)
//! ```
//!
//! A binary file has `-` in both count columns.

use super::constants::NUMSTAT_BINARY_MARKER;

const RECORD_SEPARATOR: u8 = 0;
const COLUMN_SEPARATOR: u8 = b'\t';
const COLUMN_COUNT: usize = 3;
/// Extra NUL-separated records that follow a rename / copy record (old and new path).
const RENAME_EXTRA_RECORDS: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumstatError {
    pub detail: String,
}

/// True when any record is binary. A record that does not have three columns is an error:
/// guessing would show a binary file as text or the other way round.
pub fn contains_binary_file(output: &[u8]) -> Result<bool, NumstatError> {
    if output.is_empty() {
        return Ok(false);
    }
    // Every record, including the last, is terminated by NUL; stripping that one makes any
    // remaining empty piece a truncated or malformed record.
    let Some(body) = output.strip_suffix(&[RECORD_SEPARATOR]) else {
        return Err(NumstatError {
            detail: "numstat output is not NUL terminated".to_owned(),
        });
    };
    let mut records = body.split(|byte| *byte == RECORD_SEPARATOR);
    let mut binary = false;
    while let Some(record) = records.next() {
        let mut columns = record.splitn(COLUMN_COUNT, |byte| *byte == COLUMN_SEPARATOR);
        let (Some(added), Some(deleted), Some(path)) =
            (columns.next(), columns.next(), columns.next())
        else {
            return Err(NumstatError {
                detail: "a numstat record does not have three columns".to_owned(),
            });
        };
        if added == NUMSTAT_BINARY_MARKER || deleted == NUMSTAT_BINARY_MARKER {
            binary = true;
        }
        if path.is_empty() {
            for _ in 0..RENAME_EXTRA_RECORDS {
                if records.next().is_none() {
                    return Err(NumstatError {
                        detail: "a numstat rename record is missing its paths".to_owned(),
                    });
                }
            }
        }
    }
    Ok(binary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_files_are_not_binary() {
        assert_eq!(contains_binary_file(b"3\t1\ta.md\x00"), Ok(false));
        assert_eq!(contains_binary_file(b""), Ok(false));
    }

    #[test]
    fn a_dash_in_either_column_is_binary() {
        assert_eq!(contains_binary_file(b"-\t-\timage.png\x00"), Ok(true));
        assert_eq!(contains_binary_file(b"-\t2\timage.png\x00"), Ok(true));
        assert_eq!(contains_binary_file(b"1\t-\timage.png\x00"), Ok(true));
    }

    #[test]
    fn a_rename_record_has_an_empty_path_and_two_following_paths() {
        assert_eq!(
            contains_binary_file(b"0\t0\t\x00old.md\x00new.md\x00"),
            Ok(false)
        );
        assert_eq!(
            contains_binary_file(b"-\t-\t\x00old.png\x00new.png\x00"),
            Ok(true)
        );
    }

    #[test]
    fn the_two_paths_of_a_rename_are_not_read_as_records() {
        // A path that looks like a binary record must not be taken for one.
        assert_eq!(
            contains_binary_file(b"1\t1\t\x00-\t-\tx\x00y\x00"),
            Ok(false)
        );
    }

    #[test]
    fn paths_with_tabs_and_dashes_are_kept_in_the_third_column() {
        assert_eq!(contains_binary_file(b"1\t1\ta\tb-\t-\x00"), Ok(false));
    }

    #[test]
    fn malformed_records_are_errors() {
        assert!(contains_binary_file(b"garbage\x00").is_err());
        assert!(contains_binary_file(b"1\t1\t\x00old.md\x00").is_err());
    }

    #[test]
    fn a_binary_file_after_text_files_is_found() {
        assert_eq!(
            contains_binary_file(b"1\t1\ta.md\x00-\t-\tb.bin\x00"),
            Ok(true)
        );
    }
}
