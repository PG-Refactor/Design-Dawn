//! Parser of the `git log -z --format=...` output of the History. Pure: it receives the bytes and validates every field it can.
//!
//! Each record is `HISTORY_FIELDS_PER_RECORD` fields that each end with NUL. Commit data
//! cannot contain NUL, so a subject with newlines, tabs or any other separator-looking text
//! never shifts a field boundary.
//!
//! Author name, email and subject are text from the repository, which may not be valid
//! UTF-8 (a commit in another encoding). They are decoded lossily (invalid bytes become
//! U+FFFD) so that one odd commit does not make the whole list unreadable. The ids and the
//! date are machine-made and must be well formed, otherwise the output is rejected as a
//! whole.

use std::fmt;

use super::constants::{HISTORY_FIELDS_PER_RECORD, OBJECT_ID_LENGTHS};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogEntry {
    pub commit_id: String,
    pub parent_ids: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub summary: String,
}

/// Why the output was refused. Carries no commit data (author and subject are never logged).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogParseError {
    /// The number of NUL separated fields is not a multiple of the record size, or the
    /// last field is not terminated.
    MalformedRecords,
    InvalidCommitId,
    InvalidParentId,
    InvalidAuthorDate,
}

impl fmt::Display for LogParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::MalformedRecords => "the log output is not made of complete records",
            Self::InvalidCommitId => "a commit ID in the log output is not an object ID",
            Self::InvalidParentId => "a parent ID in the log output is not an object ID",
            Self::InvalidAuthorDate => "an author date in the log output is not ISO 8601",
        };
        formatter.write_str(text)
    }
}

pub fn parse_log(output: &[u8]) -> Result<Vec<LogEntry>, LogParseError> {
    if output.is_empty() {
        return Ok(Vec::new());
    }
    // Every field, the last one included, ends with NUL, so the split ends with one empty
    // piece; anything else means the output was cut.
    let mut fields: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    if fields.pop() != Some(&[][..]) || !fields.len().is_multiple_of(HISTORY_FIELDS_PER_RECORD) {
        return Err(LogParseError::MalformedRecords);
    }
    fields
        .chunks(HISTORY_FIELDS_PER_RECORD)
        .map(parse_record)
        .collect()
}

fn parse_record(fields: &[&[u8]]) -> Result<LogEntry, LogParseError> {
    let commit_id = object_id(fields[0]).ok_or(LogParseError::InvalidCommitId)?;
    let parent_ids = if fields[1].is_empty() {
        Vec::new()
    } else {
        fields[1]
            .split(|byte| *byte == b' ')
            .map(|parent| object_id(parent).ok_or(LogParseError::InvalidParentId))
            .collect::<Result<Vec<_>, _>>()?
    };
    if !is_iso8601_with_offset(fields[4]) {
        return Err(LogParseError::InvalidAuthorDate);
    }
    Ok(LogEntry {
        commit_id,
        parent_ids,
        author_name: lossy(fields[2]),
        author_email: lossy(fields[3]),
        author_date: lossy(fields[4]),
        summary: lossy(fields[5]),
    })
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn object_id(bytes: &[u8]) -> Option<String> {
    is_object_id_bytes(bytes).then(|| lossy(bytes))
}

/// 40 or 64 lowercase hexadecimal characters.
pub fn is_object_id_bytes(bytes: &[u8]) -> bool {
    OBJECT_ID_LENGTHS.contains(&bytes.len())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

const DATE_TIME_PATTERN: &[u8] = b"dddd-dd-ddTdd:dd:dd";
const OFFSET_PATTERN: &[u8] = b"Sdd:dd";

/// `YYYY-MM-DDTHH:MM:SS` followed by `Z` or `+HH:MM` / `-HH:MM`. Only the shape and the
/// field ranges are checked; the UI converts it to local time once.
fn is_iso8601_with_offset(bytes: &[u8]) -> bool {
    let Some(date_time) = bytes.get(..DATE_TIME_PATTERN.len()) else {
        return false;
    };
    let offset = &bytes[DATE_TIME_PATTERN.len()..];
    matches_pattern(date_time, DATE_TIME_PATTERN)
        && number(&date_time[5..7]).is_some_and(|month| (1..=12).contains(&month))
        && number(&date_time[8..10]).is_some_and(|day| (1..=31).contains(&day))
        && number(&date_time[11..13]).is_some_and(|hour| hour < 24)
        && number(&date_time[14..16]).is_some_and(|minute| minute < 60)
        && number(&date_time[17..19]).is_some_and(|second| second <= 60)
        && (offset == b"Z"
            || (matches_pattern(offset, OFFSET_PATTERN)
                && matches!(offset[0], b'+' | b'-')
                && number(&offset[1..3]).is_some_and(|hour| hour < 24)
                && number(&offset[4..6]).is_some_and(|minute| minute < 60)))
}

/// `d` is a digit, `S` a sign, any other pattern byte matches itself.
fn matches_pattern(bytes: &[u8], pattern: &[u8]) -> bool {
    bytes.len() == pattern.len()
        && bytes
            .iter()
            .zip(pattern)
            .all(|(byte, expected)| match expected {
                b'd' => byte.is_ascii_digit(),
                b'S' => matches!(byte, b'+' | b'-'),
                other => byte == other,
            })
}

fn number(digits: &[u8]) -> Option<u32> {
    digits.iter().try_fold(0u32, |total, byte| {
        byte.is_ascii_digit()
            .then(|| total * 10 + u32::from(byte - b'0'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const DATE: &str = "2026-10-10T12:34:56+09:00";

    fn record(fields: [&str; 6]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for field in fields {
            bytes.extend_from_slice(field.as_bytes());
            bytes.push(0);
        }
        bytes
    }

    fn valid(subject: &str) -> Vec<u8> {
        record([ID_A, ID_B, "Name", "name@example.invalid", DATE, subject])
    }

    #[test]
    fn empty_output_has_no_entries() {
        assert_eq!(parse_log(b""), Ok(Vec::new()));
    }

    #[test]
    fn a_record_is_split_into_its_six_fields() {
        let entries = parse_log(&valid("件名")).unwrap();
        assert_eq!(
            entries,
            vec![LogEntry {
                commit_id: ID_A.to_owned(),
                parent_ids: vec![ID_B.to_owned()],
                author_name: "Name".to_owned(),
                author_email: "name@example.invalid".to_owned(),
                author_date: DATE.to_owned(),
                summary: "件名".to_owned(),
            }]
        );
    }

    #[test]
    fn several_records_keep_their_order() {
        let mut bytes = valid("first");
        bytes.extend(valid("second"));
        let summaries: Vec<_> = parse_log(&bytes)
            .unwrap()
            .into_iter()
            .map(|entry| entry.summary)
            .collect();
        assert_eq!(summaries, ["first", "second"]);
    }

    #[test]
    fn parents_may_be_none_one_or_many() {
        for (parents, expected) in [
            (String::new(), 0),
            (ID_B.to_owned(), 1),
            (format!("{ID_B} {ID_A}"), 2),
        ] {
            let bytes = record([ID_A, &parents, "n", "e", DATE, "s"]);
            assert_eq!(parse_log(&bytes).unwrap()[0].parent_ids.len(), expected);
        }
    }

    #[test]
    fn separator_looking_text_in_a_subject_is_kept_as_is() {
        let subject = "a\u{1f}b\tc\nd %x00 --format= \\0";
        assert_eq!(parse_log(&valid(subject)).unwrap()[0].summary, subject);
    }

    #[test]
    fn an_empty_subject_is_a_valid_field() {
        assert_eq!(parse_log(&valid("")).unwrap()[0].summary, "");
    }

    #[test]
    fn invalid_utf8_in_text_fields_is_replaced_not_rejected() {
        let mut bytes = Vec::new();
        for field in [
            ID_A.as_bytes(),
            b"",
            b"Na\xffme",
            b"e\xfe@example.invalid",
            DATE.as_bytes(),
            b"sub\x80ject",
        ] {
            bytes.extend_from_slice(field);
            bytes.push(0);
        }
        let entry = parse_log(&bytes).unwrap().remove(0);
        assert_eq!(entry.author_name, "Na\u{fffd}me");
        assert_eq!(entry.author_email, "e\u{fffd}@example.invalid");
        assert_eq!(entry.summary, "sub\u{fffd}ject");
    }

    #[test]
    fn cut_or_misaligned_output_is_rejected() {
        let complete = valid("s");
        // Missing last terminator, a missing field, and a stray extra field.
        assert_eq!(
            parse_log(&complete[..complete.len() - 1]),
            Err(LogParseError::MalformedRecords)
        );
        let mut missing = complete.clone();
        missing.truncate(complete.len() - 2);
        assert_eq!(parse_log(&missing), Err(LogParseError::MalformedRecords));
        let mut extra = complete.clone();
        extra.extend_from_slice(b"x\0");
        assert_eq!(parse_log(&extra), Err(LogParseError::MalformedRecords));
    }

    #[test]
    fn ids_must_be_lowercase_hex_of_40_or_64_characters() {
        let sha256 = "0f".repeat(32);
        let bytes = record([&sha256, &sha256, "n", "e", DATE, "s"]);
        assert!(parse_log(&bytes).is_ok());
        for bad in [
            "A".repeat(40),
            "a".repeat(39),
            "g".repeat(40),
            "a".repeat(41),
        ] {
            let bytes = record([&bad, "", "n", "e", DATE, "s"]);
            assert_eq!(parse_log(&bytes), Err(LogParseError::InvalidCommitId));
            let bytes = record([ID_A, &bad, "n", "e", DATE, "s"]);
            assert_eq!(parse_log(&bytes), Err(LogParseError::InvalidParentId));
        }
        let bytes = record(["", "", "n", "e", DATE, "s"]);
        assert_eq!(parse_log(&bytes), Err(LogParseError::InvalidCommitId));
        let bytes = record([ID_A, &format!("{ID_B}  {ID_B}"), "n", "e", DATE, "s"]);
        assert_eq!(parse_log(&bytes), Err(LogParseError::InvalidParentId));
    }

    #[test]
    fn dates_need_the_iso_8601_shape_with_an_offset() {
        for good in [
            "2026-10-10T12:34:56+09:00",
            "2026-01-01T00:00:00-05:00",
            "2026-12-31T23:59:59Z",
            "1970-01-01T00:00:00+00:00",
        ] {
            assert!(is_iso8601_with_offset(good.as_bytes()), "{good}");
        }
        for bad in [
            "",
            "2026-10-10",
            "2026-10-10T12:34:56",
            "2026-10-10 12:34:56 +0900",
            "2026-10-10T12:34:56+0900",
            "2026-10-10T12:34:56+09:0",
            "2026-13-10T12:34:56Z",
            "2026-10-32T12:34:56Z",
            "2026-10-10T24:00:00Z",
            "2026-10-10T12:60:00Z",
            "2026-10-10T12:34:56+24:00",
            "2026-10-10T12:34:56Z ",
            "2026-10-10T12:34:56*09:00",
            "２０２６-10-10T12:34:56Z",
        ] {
            assert!(!is_iso8601_with_offset(bad.as_bytes()), "{bad}");
            let bytes = record([ID_A, "", "n", "e", bad, "s"]);
            assert_eq!(parse_log(&bytes), Err(LogParseError::InvalidAuthorDate));
        }
    }
}
