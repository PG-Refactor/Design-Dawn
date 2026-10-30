//! Parser for `git status --porcelain=v2 -z`. Only this
//! machine-readable format is parsed. Records are NUL separated; a rename / copy record
//! (`2`) is followed by one more NUL-separated record holding the original path.
//!
//! ```text
//! 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
//! 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> NUL <originalPath>
//! u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
//! ? <path>
//! ! <path>
//! # <header>
//! ```

use super::paths::validate_project_relative_path;

const RECORD_SEPARATOR: u8 = 0;
const FIELD_SEPARATOR: char = ' ';
const CHANGED_RECORD: &str = "1";
const RENAMED_RECORD: &str = "2";
const UNMERGED_RECORD: &str = "u";
const UNTRACKED_RECORD: &str = "?";
const IGNORED_RECORD: &str = "!";
const HEADER_RECORD: &str = "#";
const BRANCH_OID_HEADER_PREFIX: &str = "# branch.oid ";
const BRANCH_HEAD_HEADER_PREFIX: &str = "# branch.head ";
const BRANCH_UPSTREAM_HEADER_PREFIX: &str = "# branch.upstream ";
const BRANCH_AHEAD_BEHIND_HEADER_PREFIX: &str = "# branch.ab ";
/// `# branch.ab +<ahead> -<behind>`: the sign characters in front of each count.
const AHEAD_COUNT_SIGN: char = '+';
const BEHIND_COUNT_SIGN: char = '-';
/// What git prints instead of an object id before the first commit.
const UNBORN_OID_MARKER: &str = "(initial)";
/// What git prints instead of a branch name on a detached HEAD.
const DETACHED_HEAD_MARKER: &str = "(detached)";
/// Fields before the path, counting the record type: `1` has 8, `2` has 9, `u` has 10.
const CHANGED_FIELD_COUNT: usize = 9;
const RENAMED_FIELD_COUNT: usize = 10;
const UNMERGED_FIELD_COUNT: usize = 11;
const STATUS_CODE_LENGTH: usize = 2;
const UNMODIFIED_CODE: char = '.';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileChange {
    Unmodified,
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Ignored,
    Unmerged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    /// Repository-relative, `/` separated, already validated.
    pub path: String,
    pub index: FileChange,
    pub worktree: FileChange,
    /// Set for renames and copies.
    pub original_path: Option<String>,
}

/// The `# branch.*` header lines. Both are `None` when git did not print them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedBranch {
    /// Branch name; `None` on a detached HEAD. Untrusted text: show it, never act on it.
    pub head: Option<String>,
    /// Commit id of HEAD; `None` on an unborn branch.
    pub oid: Option<String>,
    /// Upstream name such as `origin/main`; `None` when none is configured. Untrusted text.
    pub upstream: Option<String>,
    /// Commits only here / only upstream. `None` when git printed no (or a malformed)
    /// `# branch.ab` line, e.g. the upstream no longer exists.
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedStatus {
    pub entries: Vec<StatusEntry>,
    pub branch: ParsedBranch,
    /// Records that were left out because their path is not valid UTF-8 or not a safe
    /// relative path; the caller logs the count.
    pub skipped_records: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusParseError {
    pub detail: String,
}

impl StatusParseError {
    fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
        }
    }
}

pub fn parse_status(output: &[u8]) -> Result<ParsedStatus, StatusParseError> {
    let mut records = output
        .split(|byte| *byte == RECORD_SEPARATOR)
        .collect::<Vec<_>>();
    // `-z` ends every record with NUL, so the split yields one trailing empty piece.
    if records.last().is_some_and(|last| last.is_empty()) {
        records.pop();
    }

    let mut entries = Vec::new();
    let mut skipped_records = 0;
    let mut branch = ParsedBranch::default();
    let mut remaining = records.into_iter();
    while let Some(record) = remaining.next() {
        let Ok(text) = std::str::from_utf8(record) else {
            // A name that is not UTF-8 cannot be shown or addressed through the IPC; a
            // rename also owns the next record, which must not be read as a record itself.
            if record.first() == RENAMED_RECORD.as_bytes().first() {
                remaining.next();
            }
            skipped_records += 1;
            continue;
        };
        let record_type = text.split(FIELD_SEPARATOR).next().unwrap_or_default();
        let parsed = match record_type {
            HEADER_RECORD => {
                // Unknown headers are ignored.
                if let Some(oid) = text.strip_prefix(BRANCH_OID_HEADER_PREFIX) {
                    branch.oid = (oid != UNBORN_OID_MARKER).then(|| oid.to_owned());
                } else if let Some(head) = text.strip_prefix(BRANCH_HEAD_HEADER_PREFIX) {
                    branch.head = (head != DETACHED_HEAD_MARKER).then(|| head.to_owned());
                } else if let Some(upstream) = text.strip_prefix(BRANCH_UPSTREAM_HEADER_PREFIX) {
                    branch.upstream = Some(upstream.to_owned());
                } else if let Some(counts) = text.strip_prefix(BRANCH_AHEAD_BEHIND_HEADER_PREFIX) {
                    (branch.ahead, branch.behind) = parse_ahead_behind(counts);
                }
                continue;
            }
            CHANGED_RECORD => parse_changed(text)?,
            RENAMED_RECORD => {
                let original = remaining
                    .next()
                    .ok_or_else(|| StatusParseError::new("rename record without original path"))?;
                parse_renamed(text, original)?
            }
            UNMERGED_RECORD => parse_unmerged(text)?,
            UNTRACKED_RECORD => parse_marker(text, FileChange::Untracked)?,
            IGNORED_RECORD => parse_marker(text, FileChange::Ignored)?,
            other => {
                return Err(StatusParseError::new(format!(
                    "unknown record type {other:?}"
                )))
            }
        };
        match parsed {
            Some(entry) => entries.push(entry),
            None => skipped_records += 1,
        }
    }
    Ok(ParsedStatus {
        entries,
        branch,
        skipped_records,
    })
}

/// `+<ahead> -<behind>`; both counts or neither, so a half-understood line never shows a
/// wrong number.
fn parse_ahead_behind(counts: &str) -> (Option<u64>, Option<u64>) {
    let mut fields = counts.split(FIELD_SEPARATOR);
    let (Some(ahead), Some(behind), None) = (fields.next(), fields.next(), fields.next()) else {
        return (None, None);
    };
    match (
        parse_count(ahead, AHEAD_COUNT_SIGN),
        parse_count(behind, BEHIND_COUNT_SIGN),
    ) {
        (Some(ahead), Some(behind)) => (Some(ahead), Some(behind)),
        _ => (None, None),
    }
}

fn parse_count(field: &str, sign: char) -> Option<u64> {
    let digits = field.strip_prefix(sign)?;
    // `u64::from_str` would accept a leading `+`.
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// `None` when the path is not safe to hand on.
type ParsedRecord = Result<Option<StatusEntry>, StatusParseError>;

fn parse_changed(text: &str) -> ParsedRecord {
    let fields = split_fields(text, CHANGED_FIELD_COUNT)?;
    let (index, worktree) = parse_change_codes(fields[1])?;
    Ok(build_entry(
        fields[CHANGED_FIELD_COUNT - 1],
        None,
        index,
        worktree,
    ))
}

fn parse_renamed(text: &str, original_record: &[u8]) -> ParsedRecord {
    let fields = split_fields(text, RENAMED_FIELD_COUNT)?;
    let (index, worktree) = parse_change_codes(fields[1])?;
    let Ok(original) = std::str::from_utf8(original_record) else {
        return Ok(None);
    };
    Ok(build_entry(
        fields[RENAMED_FIELD_COUNT - 1],
        Some(original),
        index,
        worktree,
    ))
}

/// Every unmerged combination (`DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`) is a conflict;
/// the UI does not need which side did what.
fn parse_unmerged(text: &str) -> ParsedRecord {
    let fields = split_fields(text, UNMERGED_FIELD_COUNT)?;
    // Validates the code only: every unmerged combination is one conflict.
    parse_change_codes(fields[1])?;
    Ok(build_entry(
        fields[UNMERGED_FIELD_COUNT - 1],
        None,
        FileChange::Unmerged,
        FileChange::Unmerged,
    ))
}

/// `? <path>` / `! <path>`: the file is in neither state of the index, so both sides carry
/// the marker (like `??` in the short format).
fn parse_marker(text: &str, change: FileChange) -> ParsedRecord {
    let fields = split_fields(text, 2)?;
    Ok(build_entry(fields[1], None, change, change))
}

/// Splits into exactly `count` fields; the last one is the path and keeps its spaces.
fn split_fields(text: &str, count: usize) -> Result<Vec<&str>, StatusParseError> {
    let fields: Vec<&str> = text.splitn(count, FIELD_SEPARATOR).collect();
    if fields.len() != count || fields[count - 1].is_empty() {
        return Err(StatusParseError::new(format!(
            "record has fewer than {count} fields"
        )));
    }
    Ok(fields)
}

fn parse_change_codes(code: &str) -> Result<(FileChange, FileChange), StatusParseError> {
    let mut characters = code.chars();
    match (characters.next(), characters.next(), characters.next()) {
        (Some(index), Some(worktree), None) if code.len() == STATUS_CODE_LENGTH => {
            Ok((map_change_code(index)?, map_change_code(worktree)?))
        }
        _ => Err(StatusParseError::new(format!(
            "invalid status code {code:?}"
        ))),
    }
}

fn map_change_code(code: char) -> Result<FileChange, StatusParseError> {
    Ok(match code {
        UNMODIFIED_CODE => FileChange::Unmodified,
        'M' => FileChange::Modified,
        'T' => FileChange::TypeChanged,
        'A' => FileChange::Added,
        'D' => FileChange::Deleted,
        'R' => FileChange::Renamed,
        'C' => FileChange::Copied,
        'U' => FileChange::Unmerged,
        other => {
            return Err(StatusParseError::new(format!(
                "unknown status code {other:?}"
            )))
        }
    })
}

fn build_entry(
    path: &str,
    original_path: Option<&str>,
    index: FileChange,
    worktree: FileChange,
) -> Option<StatusEntry> {
    // Git only prints repository-relative paths; anything else is dropped rather than
    // passed on, so a hostile repository cannot make the UI address files outside it.
    let path = validate_project_relative_path(path).ok()?.into_string();
    let original_path = match original_path {
        Some(original) => Some(validate_project_relative_path(original).ok()?.into_string()),
        None => None,
    };
    Some(StatusEntry {
        path,
        index,
        worktree,
        original_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "0000000000000000000000000000000000000000";

    fn changed(code: &str, path: &str) -> String {
        format!("1 {code} N... 100644 100644 100644 {HASH} {HASH} {path}\0")
    }

    fn renamed(code: &str, path: &str, original: &str) -> String {
        format!("2 {code} N... 100644 100644 100644 {HASH} {HASH} R100 {path}\0{original}\0")
    }

    fn unmerged(code: &str, path: &str) -> String {
        format!("u {code} N... 100644 100644 100644 100644 {HASH} {HASH} {HASH} {path}\0")
    }

    fn parse(text: &str) -> ParsedStatus {
        parse_status(text.as_bytes()).unwrap()
    }

    fn entry(path: &str, index: FileChange, worktree: FileChange) -> StatusEntry {
        StatusEntry {
            path: path.to_owned(),
            index,
            worktree,
            original_path: None,
        }
    }

    #[test]
    fn empty_output_is_a_clean_working_tree() {
        assert_eq!(parse("").entries, []);
    }

    #[test]
    fn ordinary_changes_map_both_sides() {
        let parsed = parse(&format!(
            "{}{}{}{}{}{}",
            changed(".M", "worktree-modified.md"),
            changed("M.", "staged-modified.md"),
            changed("MM", "both.md"),
            changed("A.", "added.md"),
            changed(".D", "deleted.md"),
            changed("TM", "type.md"),
        ));

        assert_eq!(
            parsed.entries,
            [
                entry(
                    "worktree-modified.md",
                    FileChange::Unmodified,
                    FileChange::Modified
                ),
                entry(
                    "staged-modified.md",
                    FileChange::Modified,
                    FileChange::Unmodified
                ),
                entry("both.md", FileChange::Modified, FileChange::Modified),
                entry("added.md", FileChange::Added, FileChange::Unmodified),
                entry("deleted.md", FileChange::Unmodified, FileChange::Deleted),
                entry("type.md", FileChange::TypeChanged, FileChange::Modified),
            ]
        );
        assert_eq!(parsed.skipped_records, 0);
    }

    #[test]
    fn a_rename_carries_its_original_path_and_the_next_record_is_not_confused() {
        let parsed = parse(&format!(
            "{}{}",
            renamed("R.", "new name.md", "old name.md"),
            changed(".M", "after.md"),
        ));

        assert_eq!(
            parsed.entries,
            [
                StatusEntry {
                    path: "new name.md".to_owned(),
                    index: FileChange::Renamed,
                    worktree: FileChange::Unmodified,
                    original_path: Some("old name.md".to_owned()),
                },
                entry("after.md", FileChange::Unmodified, FileChange::Modified),
            ]
        );
    }

    #[test]
    fn a_copy_is_reported_as_copied() {
        let parsed = parse(&renamed("C.", "copy.md", "source.md"));

        assert_eq!(parsed.entries[0].index, FileChange::Copied);
        assert_eq!(
            parsed.entries[0].original_path.as_deref(),
            Some("source.md")
        );
    }

    #[test]
    fn every_unmerged_combination_is_a_conflict_on_both_sides() {
        for code in ["DD", "AU", "UD", "UA", "DU", "AA", "UU"] {
            let parsed = parse(&unmerged(code, "conflict.md"));
            assert_eq!(
                parsed.entries,
                [entry(
                    "conflict.md",
                    FileChange::Unmerged,
                    FileChange::Unmerged
                )],
                "{code}"
            );
        }
    }

    #[test]
    fn untracked_and_ignored_records() {
        let parsed = parse("? new file.md\0? dir/inner.md\0! build/out.bin\0");

        assert_eq!(
            parsed.entries,
            [
                entry("new file.md", FileChange::Untracked, FileChange::Untracked),
                entry("dir/inner.md", FileChange::Untracked, FileChange::Untracked),
                entry("build/out.bin", FileChange::Ignored, FileChange::Ignored),
            ]
        );
    }

    #[test]
    fn japanese_and_metacharacter_names_are_kept_verbatim() {
        let parsed = parse(&format!(
            "{}? a; b & c | d > e < f $g `h`.md\0",
            changed(".M", "設計/概要 資料.md")
        ));

        assert_eq!(parsed.entries[0].path, "設計/概要 資料.md");
        assert_eq!(parsed.entries[1].path, "a; b & c | d > e < f $g `h`.md");
    }

    #[test]
    fn headers_are_ignored() {
        let parsed = parse(&format!(
            "# branch.oid {HASH}\0# branch.head main\0{}",
            changed(".M", "a.md")
        ));

        assert_eq!(parsed.entries.len(), 1);
    }

    #[test]
    fn unsafe_paths_are_skipped_and_counted() {
        let parsed = parse(&format!(
            "{}{}{}{}",
            changed(".M", "/etc/passwd"),
            changed(".M", "../outside.md"),
            renamed("R.", "inside.md", "../origin.md"),
            changed(".M", "kept.md"),
        ));

        assert_eq!(
            parsed.entries,
            [entry(
                "kept.md",
                FileChange::Unmodified,
                FileChange::Modified
            )]
        );
        assert_eq!(parsed.skipped_records, 3);
    }

    #[test]
    fn a_name_that_is_not_utf8_is_skipped_without_losing_the_following_record() {
        let mut output = b"? ".to_vec();
        output.extend_from_slice(&[0xff, 0xfe]);
        output.push(0);
        output.extend_from_slice(b"2 R. N... 100644 100644 100644 ");
        output.extend_from_slice(format!("{HASH} {HASH} R100 new.md").as_bytes());
        output.push(0);
        output.extend_from_slice(&[0xff]);
        output.push(0);
        output.extend_from_slice(changed(".M", "kept.md").as_bytes());

        let parsed = parse_status(&output).unwrap();

        assert_eq!(
            parsed.entries,
            [entry(
                "kept.md",
                FileChange::Unmodified,
                FileChange::Modified
            )]
        );
        assert_eq!(parsed.skipped_records, 2);
    }

    #[test]
    fn malformed_input_is_rejected() {
        let cases = [
            "x unknown record\0",
            "1 .M N... 100644 100644\0",
            "1 .M N... 100644 100644 100644 h h \0",
            "1 ?M N... 100644 100644 100644 h h a.md\0",
            "1 M N... 100644 100644 100644 h h a.md\0",
            "1 MMM N... 100644 100644 100644 h h a.md\0",
            "2 R. N... 100644 100644 100644 h h R100 new.md\0",
            "u ?? N... 1 2 3 4 h h h a.md\0",
            "u UU N... 1 2 3\0",
            "?\0",
            "? \0",
        ];
        for case in cases {
            assert!(parse_status(case.as_bytes()).is_err(), "{case:?}");
        }
    }

    #[test]
    fn branch_headers_are_read_and_other_headers_ignored() {
        let parsed = parse(&format!(
            "# branch.oid {HASH}\0# branch.head feature/日本語\0# branch.upstream origin/x\0# branch.ab +1 -2\0# future.thing 1\0{}",
            changed(".M", "a.md")
        ));

        assert_eq!(parsed.branch.head.as_deref(), Some("feature/日本語"));
        assert_eq!(parsed.branch.oid.as_deref(), Some(HASH));
        assert_eq!(parsed.branch.upstream.as_deref(), Some("origin/x"));
        assert_eq!(parsed.branch.ahead, Some(1));
        assert_eq!(parsed.branch.behind, Some(2));
        assert_eq!(parsed.entries.len(), 1);
    }

    #[test]
    fn an_upstream_without_counts_has_no_ahead_or_behind() {
        let parsed =
            parse("# branch.oid {HASH}\0# branch.head main\0# branch.upstream origin/gone\0");

        assert_eq!(parsed.branch.upstream.as_deref(), Some("origin/gone"));
        assert_eq!((parsed.branch.ahead, parsed.branch.behind), (None, None));
    }

    #[test]
    fn malformed_counts_give_neither_number() {
        for counts in [
            "",
            "+1",
            "+1 -2 -3",
            "1 2",
            "+a -2",
            "+1 -",
            "++1 -2",
            "+1 --2",
            "+-1 -2",
            "+1  -2",
            "-1 +2",
            "+99999999999999999999999 -1",
        ] {
            let parsed = parse(&format!("# branch.ab {counts}\0"));
            assert_eq!(
                (parsed.branch.ahead, parsed.branch.behind),
                (None, None),
                "{counts:?}"
            );
        }
    }

    #[test]
    fn zero_counts_are_numbers() {
        let parsed = parse("# branch.ab +0 -0\0");

        assert_eq!(
            (parsed.branch.ahead, parsed.branch.behind),
            (Some(0), Some(0))
        );
    }

    #[test]
    fn a_detached_head_has_no_branch_name() {
        let parsed = parse(&format!("# branch.oid {HASH}\0# branch.head (detached)\0"));

        assert_eq!(parsed.branch.head, None);
        assert_eq!(parsed.branch.oid.as_deref(), Some(HASH));
    }

    #[test]
    fn an_unborn_branch_has_a_name_but_no_commit() {
        let parsed = parse("# branch.oid (initial)\0# branch.head main\0");

        assert_eq!(parsed.branch.head.as_deref(), Some("main"));
        assert_eq!(parsed.branch.oid, None);
    }

    #[test]
    fn missing_branch_headers_give_an_empty_branch() {
        let parsed = parse(&changed(".M", "a.md"));

        assert_eq!(parsed.branch, ParsedBranch::default());
    }
}
