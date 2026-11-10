//! Searching the text of a Project: every Markdown and Mermaid Block and every caption, read
//! from disk through a session of its own, so searching never opens a Document in the app's
//! session. Shared by the app (the Search panel) and the MCP server (`searchProject`).

use std::path::Path;

use serde::Serialize;

use super::authoring::read_text_block;
use super::block_content_operations::is_text_block_type;
use super::document_operations::load_document;
use super::error::ApplicationResult;
use super::project_operations::open_project;
use super::session::ProjectSessions;
use super::snapshot::EntityState;
use crate::domain::block_type::BlockType;

/// More would not be read; the result says it stopped there.
pub const SEARCH_MAX_MATCHES: usize = 500;
/// The line shown with a match is cut to about this many characters around it.
pub const SEARCH_CONTEXT_CHARACTERS: usize = 160;
const ELLIPSIS: &str = "…";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchQuery {
    pub text: String,
    pub match_case: bool,
}

/// Where a match is: in a Block's text or in its caption.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MatchPlace {
    Text,
    Caption,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub document_id: String,
    pub document_name: String,
    pub sheet_id: String,
    pub sheet_name: String,
    pub block_id: String,
    pub block_type: String,
    pub place: MatchPlace,
    /// 1-based line of the text (always 1 for a caption).
    pub line: usize,
    /// The line, cut around the match when long.
    pub excerpt: String,
    /// The match inside `excerpt`, in characters (Unicode scalar values).
    pub match_start: usize,
    pub match_length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    /// More matches exist than `SEARCH_MAX_MATCHES`.
    pub truncated: bool,
    /// Blocks whose text could not be read (missing, too large, not UTF-8).
    pub unreadable_blocks: usize,
}

/// Character offsets of every non-overlapping occurrence of `needle` in `line`. Without
/// `match_case` both are compared lower-cased character by character, so offsets stay those
/// of the original line.
pub fn find_in_line(line: &str, needle: &str, match_case: bool) -> Vec<usize> {
    let fold = |character: char| -> char {
        if match_case {
            character
        } else {
            character.to_lowercase().next().unwrap_or(character)
        }
    };
    let haystack: Vec<char> = line.chars().map(fold).collect();
    let pattern: Vec<char> = needle.chars().map(fold).collect();
    if pattern.is_empty() || pattern.len() > haystack.len() {
        return Vec::new();
    }
    let mut found = Vec::new();
    let mut start = 0;
    while start + pattern.len() <= haystack.len() {
        if haystack[start..start + pattern.len()] == pattern[..] {
            found.push(start);
            start += pattern.len();
        } else {
            start += 1;
        }
    }
    found
}

/// The line cut to the context window around a match, with the match's new offset.
fn excerpt(line: &str, start: usize, length: usize) -> (String, usize) {
    let characters: Vec<char> = line.chars().collect();
    if characters.len() <= SEARCH_CONTEXT_CHARACTERS {
        return (line.to_owned(), start);
    }
    let before = SEARCH_CONTEXT_CHARACTERS.saturating_sub(length) / 2;
    let from = start.saturating_sub(before);
    let to = (from + SEARCH_CONTEXT_CHARACTERS).min(characters.len());
    let mut text: String = characters[from..to].iter().collect();
    let mut offset = start - from;
    if from > 0 {
        text.insert_str(0, ELLIPSIS);
        offset += ELLIPSIS.chars().count();
    }
    if to < characters.len() {
        text.push_str(ELLIPSIS);
    }
    (text, offset)
}

struct BlockPlace<'a> {
    document_id: &'a str,
    document_name: &'a str,
    sheet_id: &'a str,
    sheet_name: &'a str,
    block_id: &'a str,
    block_type: &'a str,
}

struct Collector {
    query: SearchQuery,
    result: SearchResult,
}

impl Collector {
    fn full(&self) -> bool {
        self.result.truncated
    }

    fn scan(&mut self, place: &BlockPlace<'_>, match_place: MatchPlace, text: &str) {
        let length = self.query.text.chars().count();
        for (index, line) in text.lines().enumerate() {
            for start in find_in_line(line, &self.query.text, self.query.match_case) {
                if self.result.matches.len() >= SEARCH_MAX_MATCHES {
                    self.result.truncated = true;
                    return;
                }
                let (excerpt, match_start) = excerpt(line, start, length);
                self.result.matches.push(SearchMatch {
                    document_id: place.document_id.to_owned(),
                    document_name: place.document_name.to_owned(),
                    sheet_id: place.sheet_id.to_owned(),
                    sheet_name: place.sheet_name.to_owned(),
                    block_id: place.block_id.to_owned(),
                    block_type: place.block_type.to_owned(),
                    place: match_place,
                    line: index + 1,
                    excerpt,
                    match_start,
                    match_length: length,
                });
            }
        }
    }
}

/// Searches the Project at `root` in Document, Sheet and back-to-front Block order. An empty
/// query finds nothing. Documents and Sheets that fail to load are skipped.
pub fn search_project(root: &Path, query: SearchQuery) -> ApplicationResult<SearchResult> {
    let mut sessions = ProjectSessions::default();
    let project = open_project(&mut sessions, root)?;
    let project_id = project.project.project_id.clone();
    let mut collector = Collector {
        query,
        result: SearchResult {
            matches: Vec::new(),
            truncated: false,
            unreadable_blocks: 0,
        },
    };
    if collector.query.text.is_empty() {
        return Ok(collector.result);
    }
    for entry in &project.documents {
        if entry.state != EntityState::Loaded || collector.full() {
            continue;
        }
        let Ok(document) = load_document(&mut sessions, &project_id, &entry.document_id) else {
            continue;
        };
        let document_name = document.document.name.clone();
        for sheet_entry in &document.sheets {
            let Some(sheet) = &sheet_entry.sheet else {
                continue;
            };
            for block in &sheet.blocks {
                if collector.full() {
                    break;
                }
                let place = BlockPlace {
                    document_id: &entry.document_id,
                    document_name: &document_name,
                    sheet_id: &sheet.sheet_id,
                    sheet_name: &sheet.name,
                    block_id: &block.block_id,
                    block_type: &block.block_type,
                };
                let is_text = BlockType::parse(&block.block_type)
                    .map(is_text_block_type)
                    .unwrap_or(false);
                if is_text {
                    match read_text_block(&mut sessions, &project_id, &entry.document_id, block) {
                        Ok(content) => collector.scan(&place, MatchPlace::Text, &content.text),
                        Err(_) => collector.result.unreadable_blocks += 1,
                    }
                }
                if let Some(caption) = &block.caption {
                    collector.scan(&place, MatchPlace::Caption, caption);
                }
            }
        }
    }
    Ok(collector.result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_every_occurrence_ignoring_case_unless_asked() {
        assert_eq!(
            find_in_line("Order order ORDER", "order", false),
            [0, 6, 12]
        );
        assert_eq!(find_in_line("Order order ORDER", "order", true), [6]);
        assert_eq!(find_in_line("aaaa", "aa", false), [0, 2]);
        assert!(find_in_line("abc", "", false).is_empty());
    }

    #[test]
    fn offsets_are_in_characters_of_the_original_line() {
        assert_eq!(find_in_line("設計書の注文API", "注文", false), [4]);
    }

    #[test]
    fn a_long_line_is_cut_around_the_match() {
        let line = format!("{}needle{}", "a".repeat(400), "b".repeat(400));
        let (text, offset) = excerpt(&line, 400, 6);
        assert!(text.starts_with(ELLIPSIS) && text.ends_with(ELLIPSIS));
        let shown: String = text.chars().skip(offset).take(6).collect();
        assert_eq!(shown, "needle");
    }
}
