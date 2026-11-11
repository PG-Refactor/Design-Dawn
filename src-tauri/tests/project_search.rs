//! Searching a Project's text from disk (the app's Search panel and the MCP `searchProject`).

mod support;

use std::fs;

use design_dawn_lib::application::project_search::{
    search_project, MatchPlace, SearchQuery, SEARCH_MAX_MATCHES,
};
use support::*;

fn query(text: &str, match_case: bool) -> SearchQuery {
    SearchQuery {
        text: text.to_owned(),
        match_case,
        regex: false,
    }
}

#[test]
fn finds_text_in_markdown_blocks_with_where_it_is() {
    let opened = open_copy();
    let result = search_project(&opened.root, query("BASIC", false)).unwrap();
    assert_eq!(result.matches.len(), 1);
    let found = &result.matches[0];
    assert_eq!(found.document_id, DOCUMENT_ID);
    assert_eq!(found.sheet_id, OVERVIEW_SHEET_ID);
    assert_eq!(found.block_id, OVERVIEW_MARKDOWN_BLOCK_ID);
    assert_eq!(found.place, MatchPlace::Text);
    assert_eq!(found.line, 3);
    let shown: String = found
        .excerpt
        .chars()
        .skip(found.match_start)
        .take(found.match_length)
        .collect();
    assert_eq!(shown, "basic");
    assert!(!result.truncated);
}

#[test]
fn match_case_is_honoured_and_an_empty_query_finds_nothing() {
    let opened = open_copy();
    assert!(search_project(&opened.root, query("BASIC", true))
        .unwrap()
        .matches
        .is_empty());
    assert!(search_project(&opened.root, query("", false))
        .unwrap()
        .matches
        .is_empty());
}

#[test]
fn stops_at_the_limit_and_says_so() {
    let opened = open_copy();
    let path = opened
        .root
        .join("documents/system-design/sheets/details/blocks/markdown-1.md");
    fs::write(&path, "x ".repeat(SEARCH_MAX_MATCHES + 10)).unwrap();
    let result = search_project(&opened.root, query("x", false)).unwrap();
    assert_eq!(result.matches.len(), SEARCH_MAX_MATCHES);
    assert!(result.truncated);
}

#[test]
fn an_unreadable_block_is_counted_not_fatal() {
    let opened = open_copy();
    let path = opened
        .root
        .join("documents/system-design/sheets/details/blocks/markdown-1.md");
    fs::remove_file(&path).unwrap();
    let result = search_project(&opened.root, query("basic", false)).unwrap();
    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.unreadable_blocks, 1);
}

#[test]
fn finds_a_regular_expression_line_by_line() {
    let opened = open_copy();
    let result = search_project(
        &opened.root,
        SearchQuery {
            text: r"b\w+c".to_owned(),
            match_case: false,
            regex: true,
        },
    )
    .unwrap();
    assert_eq!(result.matches.len(), 1);
    let found = &result.matches[0];
    let shown: String = found
        .excerpt
        .chars()
        .skip(found.match_start)
        .take(found.match_length)
        .collect();
    assert_eq!(shown, "basic");
}
