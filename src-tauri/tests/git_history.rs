//! `read_history` against the system `git` in temporary repositories. Every git process runs with a hermetic configuration
//! (no user or system config, a throwaway HOME, identity only from the repository's own
//! config); commit dates are set per commit through the environment. Tests are skipped,
//! with a message, when no `git` is installed.
// Some tests here need Unix (permissions, symlinks, shell scripts as a fake git) and are
// compiled only there; on other platforms their helpers are unused.
#![cfg_attr(
    not(unix),
    allow(dead_code, unused_imports, unused_variables, unused_mut)
)]

mod support;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use design_dawn_lib::application::error::ErrorKind;
use design_dawn_lib::application::git_history::{read_history, GitHistory};
use design_dawn_lib::infrastructure::git::constants::{
    HISTORY_LIMIT_MAX, HISTORY_OFFSET_MAX, HISTORY_OUTPUT_LIMIT_BYTES,
};
use design_dawn_lib::infrastructure::git::executable::find_git_executable;
use design_dawn_lib::infrastructure::git::runner::GitRunner;
use support::*;

const PROJECT_DIRECTORY: &str = "project";
const HOME_DIRECTORY: &str = "home";
const EMPTY_CONFIG_FILE: &str = "empty-gitconfig";
const AUTHOR_NAME: &str = "Design Dawn Test";
const AUTHOR_EMAIL: &str = "test@example.invalid";
const DEFAULT_DATE: &str = "2026-01-02T03:04:05+0000";
const PAGE_SIZE: usize = 2;
const LARGE_HISTORY_COMMITS: usize = 300;

fn hermetic_environment(root: &Path) -> Vec<(OsString, OsString)> {
    let home = root.join(HOME_DIRECTORY);
    fs::create_dir_all(&home).unwrap();
    let empty_config = root.join(EMPTY_CONFIG_FILE);
    fs::write(&empty_config, "").unwrap();
    [
        ("HOME", home.clone().into_os_string()),
        ("XDG_CONFIG_HOME", home.into_os_string()),
        ("GIT_CONFIG_GLOBAL", empty_config.clone().into_os_string()),
        ("GIT_CONFIG_SYSTEM", empty_config.into_os_string()),
        ("GIT_CONFIG_NOSYSTEM", OsString::from("1")),
    ]
    .into_iter()
    .map(|(name, value)| (OsString::from(name), value))
    .collect()
}

struct Fixture {
    temp: TempDir,
    executable: PathBuf,
    environment: Vec<(OsString, OsString)>,
}

impl Fixture {
    fn new() -> Option<Self> {
        let Some(executable) = find_git_executable() else {
            eprintln!("SKIPPED: git was not found on PATH");
            return None;
        };
        let temp = TempDir::new();
        let environment = hermetic_environment(temp.path());
        Some(Self {
            temp,
            executable,
            environment,
        })
    }

    fn runner(&self) -> GitRunner {
        self.runner_for(self.executable.clone())
    }

    fn runner_for(&self, executable: PathBuf) -> GitRunner {
        self.environment
            .iter()
            .fold(GitRunner::new(executable), |runner, (name, value)| {
                runner.with_environment(name, value)
            })
    }

    fn directory(&self, name: &str) -> PathBuf {
        let path = self.temp.path().join(name);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn git_command(&self, directory: &Path, arguments: &[&str]) -> Command {
        let mut command = Command::new(&self.executable);
        command.args(arguments).current_dir(directory);
        for (name, value) in &self.environment {
            command.env(name, value);
        }
        for name in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] {
            command.env_remove(name);
        }
        command
    }

    fn git(&self, directory: &Path, arguments: &[&str]) {
        let output = self
            .git_command(directory, arguments)
            .output()
            .expect("run git");
        assert!(output.status.success(), "git {arguments:?} failed");
    }

    fn git_output(&self, directory: &Path, arguments: &[&str]) -> String {
        let output = self
            .git_command(directory, arguments)
            .output()
            .expect("run git");
        assert!(output.status.success(), "git {arguments:?} failed");
        String::from_utf8(output.stdout).unwrap()
    }

    /// An empty repository (no commit) with an identity in its own config.
    fn empty_repository(&self) -> PathBuf {
        self.empty_repository_named(PROJECT_DIRECTORY)
    }

    fn empty_repository_named(&self, name: &str) -> PathBuf {
        let project = self.directory(name);
        self.git(&project, &["init", "-q"]);
        self.git(&project, &["config", "user.name", AUTHOR_NAME]);
        self.git(&project, &["config", "user.email", AUTHOR_EMAIL]);
        project
    }

    /// An empty commit with the given subject and author / committer date.
    fn commit_dated(&self, project: &Path, subject: &str, date: &str) {
        let mut command = self.git_command(
            project,
            &[
                "commit",
                "-q",
                "--allow-empty",
                "--no-verify",
                "-m",
                subject,
            ],
        );
        command
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date);
        let output = command.output().expect("run git commit");
        assert!(output.status.success(), "commit {subject:?} failed");
    }

    fn commit(&self, project: &Path, subject: &str) {
        self.commit_dated(project, subject, DEFAULT_DATE);
    }

    /// A repository with commits `c1` (oldest) .. `c<count>`.
    fn repository_with(&self, count: usize) -> PathBuf {
        let project = self.empty_repository();
        for number in 1..=count {
            self.commit(&project, &format!("c{number}"));
        }
        project
    }

    /// All commit IDs reachable from `revision`, newest first (the reference answer).
    fn ids(&self, project: &Path, revision: &str) -> Vec<String> {
        self.git_output(project, &["rev-list", revision])
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn head(&self, project: &Path) -> String {
        self.git_output(project, &["rev-parse", "HEAD"])
            .trim()
            .to_owned()
    }

    fn history(&self, project: &Path, limit: usize, cursor: Option<&str>) -> GitHistory {
        read_history(Some(&self.runner()), project, limit, cursor).expect("history")
    }

    fn history_error(&self, project: &Path, limit: usize, cursor: Option<&str>) -> ErrorKind {
        read_history(Some(&self.runner()), project, limit, cursor)
            .expect_err("refused")
            .kind
    }
}

fn write(directory: &Path, name: &str, content: &str) {
    let path = directory.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

macro_rules! fixture_or_skip {
    () => {
        match Fixture::new() {
            Some(fixture) => fixture,
            None => return,
        }
    };
}

fn commit_ids(history: &GitHistory) -> Vec<String> {
    history
        .entries
        .iter()
        .map(|entry| entry.commit_id.clone())
        .collect()
}

fn subjects(history: &GitHistory) -> Vec<String> {
    history
        .entries
        .iter()
        .map(|entry| entry.summary.clone())
        .collect()
}

/// Follows `nextCursor` until it is `null`; returns every page.
fn all_pages(fixture: &Fixture, project: &Path, limit: usize) -> Vec<GitHistory> {
    let mut pages = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page = fixture.history(project, limit, cursor.as_deref());
        cursor = page.next_cursor.clone();
        pages.push(page);
        if cursor.is_none() {
            return pages;
        }
        assert!(pages.len() < 1000, "paging did not terminate");
    }
}

// ---- Content ----

#[test]
fn an_empty_repository_has_an_empty_history() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();

    let history = fixture.history(&project, 10, None);

    assert!(history.entries.is_empty());
    assert_eq!(history.next_cursor, None);
    assert_eq!(
        serde_json::to_value(&history).unwrap(),
        serde_json::json!({ "entries": [], "nextCursor": null })
    );
}

#[test]
fn an_empty_repository_with_a_cursor_is_an_invalid_request() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();

    let kind = fixture.history_error(&project, 10, Some(&format!("{}:1", "a".repeat(40))));

    assert_eq!(kind, ErrorKind::InvalidHistoryRequest);
}

#[test]
fn one_commit_has_all_fields_and_no_parent() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();
    fixture.commit_dated(&project, "first", "2026-03-04T05:06:07+0900");

    let history = fixture.history(&project, 10, None);

    assert_eq!(history.next_cursor, None);
    assert_eq!(history.entries.len(), 1);
    let entry = &history.entries[0];
    assert_eq!(entry.commit_id, fixture.head(&project));
    assert!(entry.parent_ids.is_empty());
    assert_eq!(entry.author_name, AUTHOR_NAME);
    assert_eq!(entry.author_email, AUTHOR_EMAIL);
    assert_eq!(entry.author_date, "2026-03-04T05:06:07+09:00");
    assert_eq!(entry.summary, "first");
    let json = serde_json::to_value(entry).unwrap();
    assert_eq!(
        json.as_object().unwrap().keys().collect::<Vec<_>>(),
        [
            "authorDate",
            "authorEmail",
            "authorName",
            "commitId",
            "parentIds",
            "summary"
        ]
    );
}

#[test]
fn several_commits_are_listed_newest_first_with_their_parents() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(3);

    let history = fixture.history(&project, 10, None);

    assert_eq!(subjects(&history), ["c3", "c2", "c1"]);
    assert_eq!(commit_ids(&history), fixture.ids(&project, "HEAD"));
    assert_eq!(
        history.entries[0].parent_ids,
        [history.entries[1].commit_id.clone()]
    );
    assert_eq!(
        history.entries[1].parent_ids,
        [history.entries[2].commit_id.clone()]
    );
    assert!(history.entries[2].parent_ids.is_empty());
    assert_eq!(history.next_cursor, None);
}

#[test]
fn author_dates_keep_their_offsets() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();
    fixture.commit_dated(&project, "east", "2026-06-01T12:00:00+0900");
    fixture.commit_dated(&project, "west", "2026-06-01T12:00:00-0500");
    fixture.commit_dated(&project, "utc", "2026-06-01T12:00:00+0000");

    let history = fixture.history(&project, 10, None);

    let dates: Vec<_> = history
        .entries
        .iter()
        .map(|entry| entry.author_date.as_str())
        .collect();
    assert_eq!(
        dates,
        [
            "2026-06-01T12:00:00+00:00",
            "2026-06-01T12:00:00-05:00",
            "2026-06-01T12:00:00+09:00"
        ]
    );
}

#[test]
fn a_japanese_subject_is_returned_intact() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();
    fixture.commit(&project, "設計を更新する（日本語 🌅）");

    assert_eq!(
        fixture.history(&project, 10, None).entries[0].summary,
        "設計を更新する（日本語 🌅）"
    );
}

#[test]
fn subjects_that_look_like_separators_or_options_do_not_shift_fields() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();
    let subjects_in = [
        "unit\u{1f}separator\u{1f}here",
        "tab\tseparated\tsubject",
        "literal %x00 and %H and %an",
        "--format=%H",
        "-n 1 --skip=5",
        "quote \" and 'single' and `tick` and $(touch pwned)",
    ];
    for subject in subjects_in {
        fixture.commit(&project, subject);
    }

    let history = fixture.history(&project, 10, None);

    let mut expected: Vec<_> = subjects_in.iter().map(|s| s.to_string()).collect();
    expected.reverse();
    assert_eq!(subjects(&history), expected);
    for entry in &history.entries {
        assert_eq!(entry.author_name, AUTHOR_NAME);
        assert_eq!(entry.author_email, AUTHOR_EMAIL);
        assert_eq!(
            entry.parent_ids.len(),
            usize::from(entry.summary != subjects_in[0])
        );
    }
    assert!(!project.join("pwned").exists());
}

#[test]
fn a_multi_line_message_gives_only_its_subject() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();
    fixture.commit(&project, "subject line\n\nbody line one\nbody line two");

    let history = fixture.history(&project, 10, None);

    assert_eq!(history.entries[0].summary, "subject line");
}

#[test]
fn author_names_and_emails_with_special_characters_are_kept() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();
    let name = "O'Brien $(x) \"q\" 太郎";
    let email = "o'brien+tag@example.invalid";
    let mut command = fixture.git_command(&project, &["commit", "-q", "--allow-empty", "-m", "s"]);
    command
        .env("GIT_AUTHOR_NAME", name)
        .env("GIT_AUTHOR_EMAIL", email);
    assert!(command.output().unwrap().status.success());

    let entry = fixture.history(&project, 10, None).entries.remove(0);

    assert_eq!(entry.author_name, name);
    assert_eq!(entry.author_email, email);
}

#[test]
fn a_merge_commit_has_two_parents() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(1);
    fixture.git(&project, &["checkout", "-q", "-b", "side"]);
    write(&project, "side.md", "side\n");
    fixture.git(&project, &["add", "side.md"]);
    fixture.git(&project, &["commit", "-q", "-m", "side work"]);
    fixture.git(&project, &["checkout", "-q", "-"]);
    write(&project, "main.md", "main\n");
    fixture.git(&project, &["add", "main.md"]);
    fixture.git(&project, &["commit", "-q", "-m", "main work"]);
    fixture.git(
        &project,
        &["merge", "-q", "--no-ff", "side", "-m", "merge side"],
    );

    let history = fixture.history(&project, 10, None);

    assert_eq!(history.entries[0].summary, "merge side");
    assert_eq!(history.entries[0].parent_ids.len(), 2);
    assert_eq!(commit_ids(&history), fixture.ids(&project, "HEAD"));
}

#[test]
fn a_detached_head_lists_the_history_from_it() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(4);
    fixture.git(&project, &["checkout", "-q", "--detach", "HEAD~1"]);

    let history = fixture.history(&project, 10, None);

    assert_eq!(subjects(&history), ["c3", "c2", "c1"]);
}

#[test]
fn a_shallow_clone_lists_what_it_has_and_its_boundary_has_no_parent() {
    let fixture = fixture_or_skip!();
    let source = fixture.repository_with(5);
    let clone_parent = fixture.directory("clone-parent");
    let url = format!("file://{}", source.display());
    let clone = clone_parent.join("clone");
    fixture.git(
        &clone_parent,
        &["clone", "-q", "--depth", "2", &url, "clone"],
    );

    let history = fixture.history(&clone, 10, None);

    assert_eq!(subjects(&history), ["c5", "c4"]);
    assert_eq!(history.entries[0].parent_ids.len(), 1);
    assert!(history.entries[1].parent_ids.is_empty());
    assert_eq!(history.next_cursor, None);
}

// ---- Paging ----

#[test]
fn pages_cover_the_history_without_gaps_or_duplicates() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(5);
    let all = fixture.ids(&project, "HEAD");
    let head = fixture.head(&project);

    let first = fixture.history(&project, PAGE_SIZE, None);
    assert_eq!(commit_ids(&first), all[0..2]);
    assert_eq!(first.next_cursor, Some(format!("{head}:2")));
    let second = fixture.history(&project, PAGE_SIZE, first.next_cursor.as_deref());
    assert_eq!(commit_ids(&second), all[2..4]);
    assert_eq!(second.next_cursor, Some(format!("{head}:4")));
    let third = fixture.history(&project, PAGE_SIZE, second.next_cursor.as_deref());
    assert_eq!(commit_ids(&third), all[4..5]);
    assert_eq!(third.next_cursor, None);

    let pages = all_pages(&fixture, &project, PAGE_SIZE);
    let joined: Vec<_> = pages.iter().flat_map(commit_ids).collect();
    assert_eq!(joined, all);
}

#[test]
fn a_page_that_ends_exactly_at_the_history_has_no_next_cursor() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(4);

    assert_eq!(fixture.history(&project, 4, None).next_cursor, None);
    assert_eq!(fixture.history(&project, 100, None).next_cursor, None);
    let pages = all_pages(&fixture, &project, PAGE_SIZE);
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[1].entries.len(), 2);
    assert_eq!(pages[1].next_cursor, None);
    assert!(fixture.history(&project, 3, None).next_cursor.is_some());
}

#[test]
fn a_head_that_moves_between_pages_does_not_disturb_the_paging() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(5);
    let original = fixture.ids(&project, "HEAD");
    let first = fixture.history(&project, PAGE_SIZE, None);

    fixture.commit(&project, "new commit after the first page");
    fixture.git(&project, &["checkout", "-q", "--detach", "HEAD~3"]);
    let second = fixture.history(&project, PAGE_SIZE, first.next_cursor.as_deref());
    let third = fixture.history(&project, PAGE_SIZE, second.next_cursor.as_deref());

    assert_eq!(commit_ids(&second), original[2..4]);
    assert_eq!(commit_ids(&third), original[4..5]);
    assert_eq!(third.next_cursor, None);
    // A new first page shows the current history.
    assert_ne!(
        commit_ids(&fixture.history(&project, PAGE_SIZE, None)),
        commit_ids(&first)
    );
}

#[test]
fn a_large_history_is_returned_in_pages_bounded_by_the_limit() {
    let fixture = fixture_or_skip!();
    let project = fixture.empty_repository();
    let script = format!(
        "tree=$('{git}' hash-object -t tree -w --stdin </dev/null) || exit 1\nparent=''\ni=0\nwhile [ $i -lt {count} ]; do\n  if [ -z \"$parent\" ]; then parent=$('{git}' commit-tree $tree -m \"n$i\"); else parent=$('{git}' commit-tree $tree -p $parent -m \"n$i\"); fi || exit 1\n  i=$((i+1))\ndone\n'{git}' update-ref HEAD $parent",
        git = fixture.executable.display(),
        count = LARGE_HISTORY_COMMITS
    );
    let mut command = Command::new("sh");
    command.args(["-c", &script]).current_dir(&project);
    for (name, value) in &fixture.environment {
        command.env(name, value);
    }
    // Another test sets GIT_DIR / GIT_INDEX_FILE process-wide while it runs; the git calls of
    // this script must not follow them (git_command removes them for the same reason).
    for name in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] {
        command.env_remove(name);
    }
    let output = command.output().expect("run sh");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let all = fixture.ids(&project, "HEAD");
    assert_eq!(all.len(), LARGE_HISTORY_COMMITS);

    let pages = all_pages(&fixture, &project, HISTORY_LIMIT_MAX);

    assert_eq!(pages.len(), 3);
    assert!(pages
        .iter()
        .all(|page| page.entries.len() <= HISTORY_LIMIT_MAX));
    assert_eq!(pages.iter().flat_map(commit_ids).collect::<Vec<_>>(), all);
}

// ---- Validation ----

#[test]
fn a_limit_outside_the_range_is_an_invalid_request() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(2);

    for limit in [0, HISTORY_LIMIT_MAX + 1, usize::MAX] {
        assert_eq!(
            fixture.history_error(&project, limit, None),
            ErrorKind::InvalidHistoryRequest,
            "{limit}"
        );
    }
    assert!(read_history(Some(&fixture.runner()), &project, 1, None).is_ok());
    assert!(read_history(Some(&fixture.runner()), &project, HISTORY_LIMIT_MAX, None).is_ok());
}

#[test]
fn malformed_cursors_are_invalid_requests() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(3);
    let head = fixture.head(&project);
    let cursors = [
        String::new(),
        head.clone(),
        format!("{head}:"),
        format!("{head}:0"),
        format!("{head}:-1"),
        format!("{head}:1x"),
        format!("{head}:1:1"),
        format!("{}:1", head.to_uppercase()),
        format!("{}:1", &head[..39]),
        format!("{}z:1", &head[..39]),
        format!("{head}:{}", HISTORY_OFFSET_MAX + 1),
        "HEAD:1".to_owned(),
        "--all:1".to_owned(),
    ];
    for cursor in cursors {
        assert_eq!(
            fixture.history_error(&project, 2, Some(&cursor)),
            ErrorKind::InvalidHistoryRequest,
            "{cursor:?}"
        );
    }
}

#[test]
fn a_cursor_of_a_missing_commit_or_a_non_commit_object_is_an_invalid_request() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(2);
    let tree = fixture
        .git_output(&project, &["rev-parse", "HEAD^{tree}"])
        .trim()
        .to_owned();

    for id in ["f".repeat(40), tree] {
        assert_eq!(
            fixture.history_error(&project, 2, Some(&format!("{id}:1"))),
            ErrorKind::InvalidHistoryRequest,
            "{id}"
        );
    }
}

#[test]
fn a_cursor_at_the_largest_offset_is_accepted_and_returns_nothing_beyond_the_history() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(2);
    let cursor = format!("{}:{HISTORY_OFFSET_MAX}", fixture.head(&project));

    let history = fixture.history(&project, 5, Some(&cursor));

    assert!(history.entries.is_empty());
    assert_eq!(history.next_cursor, None);
}

// ---- Repository state and environment ----

#[test]
fn a_repository_that_is_not_ready_is_refused() {
    let fixture = fixture_or_skip!();
    let repository = fixture.repository_with(1);
    write(&repository, "nested-project/inside.md", "x");
    let plain = fixture.directory("plain");
    write(&plain, "file.md", "x");

    for root in [repository.join("nested-project"), plain] {
        assert_eq!(
            fixture.history_error(&root, 10, None),
            ErrorKind::GitNotReady
        );
    }
}

#[test]
fn history_without_git_is_refused() {
    let project = TempDir::new();

    let error = read_history(None, project.path(), 10, None).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitNotReady);
}

#[test]
fn git_dir_and_git_index_file_of_the_process_are_ignored() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(2);
    let other = fixture.empty_repository_named("other-repository");
    fixture.commit(&other, "other history");

    // Only this test sets them and every git start in this binary removes them, so parallel
    // tests are unaffected.
    std::env::set_var("GIT_DIR", other.join(".git"));
    std::env::set_var("GIT_INDEX_FILE", other.join(".git/index"));
    let result = read_history(Some(&fixture.runner()), &project, 10, None);
    std::env::remove_var("GIT_DIR");
    std::env::remove_var("GIT_INDEX_FILE");

    assert_eq!(subjects(&result.unwrap()), ["c2", "c1"]);
}

#[test]
fn head_index_and_working_tree_are_not_changed() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(3);
    write(&project, "staged.md", "staged\n");
    fixture.git(&project, &["add", "staged.md"]);
    write(&project, "untracked.md", "untracked\n");
    let snapshot = |fixture: &Fixture| {
        (
            fixture.head(&project),
            fs::read(project.join(".git/index")).unwrap(),
            fixture.git_output(&project, &["status", "--porcelain=v2", "-z"]),
            fs::read_to_string(project.join("untracked.md")).unwrap(),
        )
    };
    let before = snapshot(&fixture);

    let first = fixture.history(&project, PAGE_SIZE, None);
    fixture.history(&project, PAGE_SIZE, first.next_cursor.as_deref());

    assert!(snapshot(&fixture) == before);
}

#[cfg(unix)]
#[test]
fn signatures_are_not_verified() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(1);
    let marker = fixture.directory("gpg-marker").join("called");
    let gpg = fixture.directory("fake-gpg").join("gpg");
    write_script(&gpg, &format!("touch '{}'\nexit 1", marker.display()));
    fixture.git(&project, &["config", "log.showSignature", "true"]);
    fixture.git(
        &project,
        &["config", "gpg.program", &gpg.display().to_string()],
    );
    // A commit object that carries a `gpgsig` header, so verification has something to do.
    let tree = fixture
        .git_output(&project, &["rev-parse", "HEAD^{tree}"])
        .trim()
        .to_owned();
    let parent = fixture.head(&project);
    let raw = format!(
        "tree {tree}\nparent {parent}\nauthor A <a@example.invalid> 1700000000 +0000\ncommitter A <a@example.invalid> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n AAAA\n -----END PGP SIGNATURE-----\n\nsigned\n"
    );
    let raw_file = fixture.directory("raw").join("commit");
    fs::write(&raw_file, raw).unwrap();
    let signed = fixture
        .git_output(
            &project,
            &[
                "hash-object",
                "-t",
                "commit",
                "-w",
                &raw_file.display().to_string(),
            ],
        )
        .trim()
        .to_owned();
    fixture.git(&project, &["update-ref", "HEAD", &signed]);

    // Control: plain `git log` with this configuration does call the program.
    fixture.git(&project, &["log", "-1"]);
    assert!(marker.exists(), "the control did not trigger verification");
    fs::remove_file(&marker).unwrap();

    let history = fixture.history(&project, 10, None);

    assert_eq!(subjects(&history), ["signed", "c1"]);
    assert!(!marker.exists(), "signature verification was started");
}

#[cfg(unix)]
#[test]
fn output_beyond_the_limit_is_a_command_failure() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(2);
    let real = fixture.executable.display().to_string();
    let script = fixture.directory("fake-git").join("git");
    let oversized = HISTORY_OUTPUT_LIMIT_BYTES + 4096;
    write_script(
        &script,
        &format!(
            "for argument in \"$@\"; do\n  case \"$argument\" in\n    log) head -c {oversized} /dev/zero | tr '\\0' 'a'; exit 0;;\n  esac\ndone\nexec '{real}' \"$@\""
        ),
    );

    let error = read_history(Some(&fixture.runner_for(script)), &project, 10, None).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitCommandFailed);
}

#[cfg(unix)]
#[test]
fn output_that_is_not_made_of_complete_records_is_a_command_failure() {
    let fixture = fixture_or_skip!();
    let project = fixture.repository_with(2);
    let real = fixture.executable.display().to_string();
    let script = fixture.directory("fake-git").join("git");
    write_script(
        &script,
        &format!(
            "for argument in \"$@\"; do\n  case \"$argument\" in\n    log) printf 'not-an-id\\000only\\000three\\000'; exit 0;;\n  esac\ndone\nexec '{real}' \"$@\""
        ),
    );

    let error = read_history(Some(&fixture.runner_for(script)), &project, 10, None).unwrap_err();

    assert_eq!(error.kind, ErrorKind::GitCommandFailed);
}

const FAKE_GIT_PROBE_VARIABLE: &str = "DAWN_FAKE_GIT_PROBE";
#[cfg(unix)]
const TEXT_FILE_BUSY: i32 = 26;
#[cfg(unix)]
const PROBE_ATTEMPTS: u32 = 200;
#[cfg(unix)]
const PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);

/// Writes an executable script (a fake git or a hook) and waits until it can run. Another
/// test thread may fork while the write handle is open; until that child execs, running
/// the script fails with "text file busy", which git would report as a failing hook. The
/// probe run exits at once so nothing of the body happens.
#[cfg(unix)]
fn write_script(script: &Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(script.parent().unwrap()).unwrap();
    fs::write(
        script,
        format!("#!/bin/sh\n[ -n \"${FAKE_GIT_PROBE_VARIABLE}\" ] && exit 0\n{body}\n"),
    )
    .unwrap();
    fs::set_permissions(script, fs::Permissions::from_mode(0o755)).unwrap();
    for _ in 0..PROBE_ATTEMPTS {
        match Command::new(script)
            .env(FAKE_GIT_PROBE_VARIABLE, "1")
            .status()
        {
            Err(error) if error.raw_os_error() == Some(TEXT_FILE_BUSY) => {
                std::thread::sleep(PROBE_INTERVAL);
            }
            Ok(_) => return,
            Err(error) => panic!("script could not run: {error}"),
        }
    }
    panic!("script stayed busy");
}
