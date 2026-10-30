//! Commit history, one page at a time. Read-only. Pages
//! are cut from a fixed start commit (`<commitId>:<offset>` cursor), so a HEAD that moves
//! between two pages cannot duplicate or skip entries. Author name, email and subject are
//! untrusted repository data and are never logged.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::application::git_operations::{
    not_ready_error, project_root_of, repository_state, run_error, GitRepositoryState,
};
use crate::application::session::ProjectSessions;
use crate::infrastructure::git::constants::{
    ARG_END_OF_OPTIONS, ARG_LOG, ARG_MAX_COUNT, ARG_NO_COLOR, ARG_NO_OPTIONAL_LOCKS,
    ARG_NO_SHOW_SIGNATURE, ARG_NUL_SEPARATED, ARG_QUIET, ARG_REV_PARSE, ARG_SKIP_PREFIX,
    ARG_VERIFY, GIT_COMMAND_TIMEOUT, HISTORY_CURSOR_SEPARATOR, HISTORY_FORMAT, HISTORY_LIMIT_MAX,
    HISTORY_LIMIT_MIN, HISTORY_OFFSET_MAX, HISTORY_OUTPUT_LIMIT_BYTES, REVISION_COMMIT_SUFFIX,
    REVISION_HEAD,
};
use crate::infrastructure::git::log_parser::{is_object_id_bytes, parse_log, LogEntry};
use crate::infrastructure::git::redaction::redact_credentials;
use crate::infrastructure::git::runner::{GitOutput, GitRunner};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryEntry {
    pub commit_id: String,
    pub parent_ids: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    /// ISO 8601 with the author's UTC offset, as git printed it.
    pub author_date: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistory {
    pub entries: Vec<GitHistoryEntry>,
    /// Present only when another page exists.
    pub next_cursor: Option<String>,
}

impl From<LogEntry> for GitHistoryEntry {
    fn from(entry: LogEntry) -> Self {
        Self {
            commit_id: entry.commit_id,
            parent_ids: entry.parent_ids,
            author_name: entry.author_name,
            author_email: entry.author_email,
            author_date: entry.author_date,
            summary: entry.summary,
        }
    }
}

/// Reads one page of the history of the Project's Repository with the `git` found on PATH.
pub fn git_history(
    sessions: &Mutex<ProjectSessions>,
    project_id: &str,
    limit: usize,
    cursor: Option<&str>,
) -> ApplicationResult<GitHistory> {
    let project_root = project_root_of(sessions, project_id)?;
    read_history(
        GitRunner::discover().ok().as_ref(),
        &project_root,
        limit,
        cursor,
    )
}

/// A parsed cursor: the commit the listing started from and how many entries came before.
#[derive(Debug, Clone, PartialEq, Eq)]
struct HistoryCursor {
    start: String,
    offset: usize,
}

fn invalid_request(detail: &str) -> ApplicationError {
    ApplicationError::new(ErrorKind::InvalidHistoryRequest, detail)
}

/// `<commitId>:<offset>`: a 40 / 64 digit lowercase hex ID, a colon, and a decimal offset of
/// `1..=HISTORY_OFFSET_MAX` written with digits only (no sign, no spaces).
fn parse_cursor(cursor: &str) -> Result<HistoryCursor, ApplicationError> {
    let malformed = || invalid_request("the history cursor is malformed");
    let (start, offset) = cursor
        .split_once(HISTORY_CURSOR_SEPARATOR)
        .ok_or_else(malformed)?;
    if !is_object_id_bytes(start.as_bytes())
        || offset.is_empty()
        || !offset.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(malformed());
    }
    // More digits than any valid offset has would only overflow; it is out of range anyway.
    let offset: usize = offset.parse().map_err(|_| malformed())?;
    if !(1..=HISTORY_OFFSET_MAX).contains(&offset) {
        return Err(malformed());
    }
    Ok(HistoryCursor {
        start: start.to_owned(),
        offset,
    })
}

/// One page of history, newest first. Order of checks: repository ready, `limit`, `cursor`
/// syntax, then the start commit (HEAD for the first page; the cursor's commit, which must
/// still exist, for the next ones). A repository without any commit has an empty history.
pub fn read_history(
    runner: Option<&GitRunner>,
    project_root: &Path,
    limit: usize,
    cursor: Option<&str>,
) -> ApplicationResult<GitHistory> {
    let state = repository_state(runner, project_root)?;
    let (GitRepositoryState::Ready, Some(runner)) = (state, runner) else {
        return Err(not_ready_error(state));
    };

    if !(HISTORY_LIMIT_MIN..=HISTORY_LIMIT_MAX).contains(&limit) {
        return Err(invalid_request("the history page size is out of range"));
    }
    let cursor = cursor.map(parse_cursor).transpose()?;

    let (start, offset) = match cursor {
        Some(cursor) => {
            if !commit_exists(runner, project_root, &cursor.start)? {
                return Err(invalid_request("the history cursor names no commit"));
            }
            (cursor.start, cursor.offset)
        }
        None => match resolve_head(runner, project_root)? {
            Some(head) => (head, 0),
            None => {
                return Ok(GitHistory {
                    entries: Vec::new(),
                    next_cursor: None,
                })
            }
        },
    };

    let mut entries = run_log(runner, project_root, &start, offset, limit + 1)?;
    let has_more = entries.len() > limit;
    entries.truncate(limit);
    // A cursor deeper than HISTORY_OFFSET_MAX would be refused on the next request, so the
    // listing ends there instead of handing out a cursor that cannot be used.
    let next_offset = offset + limit;
    let next_cursor = (has_more && next_offset <= HISTORY_OFFSET_MAX)
        .then(|| format!("{start}{HISTORY_CURSOR_SEPARATOR}{next_offset}"));
    Ok(GitHistory {
        entries: entries.into_iter().map(GitHistoryEntry::from).collect(),
        next_cursor,
    })
}

/// `Ok(None)` when the repository has no commit (`--verify --quiet` exits 1); any other
/// failure is an error since guessing "empty" would hide a real problem.
fn resolve_head(runner: &GitRunner, project_root: &Path) -> ApplicationResult<Option<String>> {
    let output = rev_parse_verify(runner, project_root, REVISION_HEAD)?;
    match output.exit_code() {
        Some(0) => Ok(Some(object_id_of(&output, "HEAD")?)),
        Some(1) => Ok(None),
        code => Err(rev_parse_failure(code, &output)),
    }
}

fn commit_exists(runner: &GitRunner, project_root: &Path, id: &str) -> ApplicationResult<bool> {
    let revision = format!("{id}{REVISION_COMMIT_SUFFIX}");
    let output = rev_parse_verify(runner, project_root, &revision)?;
    match output.exit_code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        code => Err(rev_parse_failure(code, &output)),
    }
}

fn rev_parse_verify(
    runner: &GitRunner,
    project_root: &Path,
    revision: &str,
) -> ApplicationResult<GitOutput> {
    runner
        .run(
            &[
                ARG_NO_OPTIONAL_LOCKS,
                ARG_REV_PARSE,
                ARG_VERIFY,
                ARG_QUIET,
                revision,
            ],
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
        )
        .map_err(|error| run_error("history revision lookup", error))
}

fn rev_parse_failure(code: Option<i32>, output: &GitOutput) -> ApplicationError {
    ApplicationError::new(
        ErrorKind::GitCommandFailed,
        format!(
            "git rev-parse exited with {code:?}: {}",
            redact_credentials(output.stderr_text().trim_end())
        ),
    )
}

fn object_id_of(output: &GitOutput, what: &str) -> ApplicationResult<String> {
    let text = String::from_utf8_lossy(&output.stdout);
    let id = text.trim_end_matches(['\n', '\r']);
    if !is_object_id_bytes(id.as_bytes()) {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!("git rev-parse printed no object ID for {what}"),
        ));
    }
    Ok(id.to_owned())
}

/// `start` is a validated object ID, so it cannot be read as an option even though it is
/// placed before `--`.
fn run_log(
    runner: &GitRunner,
    project_root: &Path,
    start: &str,
    offset: usize,
    count: usize,
) -> ApplicationResult<Vec<LogEntry>> {
    let count_text = count.to_string();
    let skip_argument = format!("{ARG_SKIP_PREFIX}{offset}");
    let mut arguments: Vec<&str> = vec![
        ARG_NO_OPTIONAL_LOCKS,
        ARG_LOG,
        ARG_NUL_SEPARATED,
        ARG_NO_SHOW_SIGNATURE,
        ARG_NO_COLOR,
        HISTORY_FORMAT,
        ARG_MAX_COUNT,
        &count_text,
    ];
    if offset > 0 {
        arguments.push(&skip_argument);
    }
    arguments.extend_from_slice(&[start, ARG_END_OF_OPTIONS]);

    let output = runner
        .run_with_stdout_limit(
            &arguments,
            project_root,
            None,
            GIT_COMMAND_TIMEOUT,
            HISTORY_OUTPUT_LIMIT_BYTES,
        )
        .map_err(|error| run_error("log", error))?;
    if !output.success() {
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            format!(
                "git log exited with {:?}: {}",
                output.exit_code(),
                redact_credentials(output.stderr_text().trim_end())
            ),
        ));
    }
    if output.stdout_truncated {
        // A cut page would end in a partial record; it is never parsed.
        return Err(ApplicationError::new(
            ErrorKind::GitCommandFailed,
            "git log printed more than the history output limit",
        ));
    }
    parse_log(&output.stdout)
        .map_err(|error| ApplicationError::new(ErrorKind::GitCommandFailed, error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn a_cursor_is_an_object_id_a_colon_and_a_positive_decimal_offset() {
        assert_eq!(
            parse_cursor(&format!("{ID}:25")),
            Ok(HistoryCursor {
                start: ID.to_owned(),
                offset: 25
            })
        );
        assert!(parse_cursor(&format!("{}:1", "ab".repeat(32))).is_ok());
        assert!(parse_cursor(&format!("{ID}:{HISTORY_OFFSET_MAX}")).is_ok());
    }

    #[test]
    fn malformed_cursors_are_refused() {
        let too_deep = format!("{ID}:{}", HISTORY_OFFSET_MAX + 1);
        let huge = format!("{ID}:99999999999999999999999999");
        let cases = [
            String::new(),
            ID.to_owned(),
            format!("{ID}:"),
            format!("{ID}:0"),
            format!("{ID}:-5"),
            format!("{ID}:+5"),
            format!("{ID}: 5"),
            format!("{ID}:5 "),
            format!("{ID}:5:6"),
            format!("{ID}:5x"),
            format!("{}:5", ID.to_uppercase()),
            format!("{}:5", &ID[..39]),
            format!("{}g:5", &ID[..39]),
            "HEAD:5".to_owned(),
            ":5".to_owned(),
            too_deep,
            huge,
        ];
        for cursor in cases {
            let error = parse_cursor(&cursor).expect_err(&cursor);
            assert_eq!(error.kind, ErrorKind::InvalidHistoryRequest, "{cursor:?}");
        }
    }

    #[test]
    fn the_wire_form_is_camel_case_with_a_null_cursor() {
        let history = GitHistory {
            entries: vec![GitHistoryEntry {
                commit_id: ID.to_owned(),
                parent_ids: vec![],
                author_name: "n".to_owned(),
                author_email: "e".to_owned(),
                author_date: "2026-10-10T00:00:00Z".to_owned(),
                summary: "s".to_owned(),
            }],
            next_cursor: None,
        };
        assert_eq!(
            serde_json::to_value(history).unwrap(),
            serde_json::json!({
                "entries": [{
                    "commitId": ID,
                    "parentIds": [],
                    "authorName": "n",
                    "authorEmail": "e",
                    "authorDate": "2026-10-10T00:00:00Z",
                    "summary": "s"
                }],
                "nextCursor": null
            })
        );
    }
}
