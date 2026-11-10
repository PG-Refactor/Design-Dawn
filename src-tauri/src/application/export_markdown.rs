//! A Document as one Markdown file, for reading it outside the app or moving it to another
//! tool: Sheets in order, each Sheet's Blocks in reading order (rows from the top, left to
//! right in a row), Mermaid as fenced code, images as image references, captions next to
//! their figure. Read through a session of its own, like the search.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::authoring::read_text_block;
use super::block_content_operations::is_text_block_type;
use super::document_operations::load_document;
use super::error::{ApplicationError, ApplicationResult, ErrorKind};
use super::file_dialogs::{FileDialogs, FileFilter, SaveOutcome};
use super::project_operations::open_project;
use super::session::ProjectSessions;
use crate::domain::block_type::BlockType;
use crate::domain::entity_id::DocumentId;
use crate::infrastructure::file_format::dto::{BlockDto, SheetDto};

pub const MARKDOWN_FILTER: FileFilter = FileFilter {
    name: "Markdown",
    extensions: &["md"],
};
/// Must match the Frontend's `DOCUMENT_ASSETS_DIRECTORY` and the file format's assets folder.
const ASSETS_DIRECTORY: &str = "assets";
const PATH_SEPARATOR: char = '/';
const PARENT_SEGMENT: &str = "..";
const CURRENT_SEGMENT: &str = ".";
/// The exported images go next to the file, in `<file stem>-assets/`, so an export never
/// writes into a folder the user keeps something else in.
const EXPORT_ASSETS_SUFFIX: &str = "-assets";
const MARKDOWN_EXTENSION: &str = "md";
const MAX_HEADING_LEVEL: usize = 6;
/// The Document title is `#` and each Sheet `##`: a Block's own headings move down by two.
const HEADING_SHIFT: usize = 2;
const MIN_FENCE: usize = 3;
const FENCE_CHARACTER: char = '`';
const TILDE_FENCE: &str = "~~~";
const BACKTICK_FENCE: &str = "```";
const MERMAID_LANGUAGE: &str = "mermaid";
const CAPTION_ABOVE: &str = "above";
/// Characters a file name cannot hold on Windows, replaced in the suggested name.
const UNSAFE_FILE_NAME_CHARACTERS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const FALLBACK_FILE_STEM: &str = "document";

/// The Markdown text and the Document's assets it refers to (`assets/<file>`), each once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedMarkdown {
    pub text: String,
    pub assets: Vec<String>,
}

fn number(value: &serde_json::Number) -> f64 {
    value.as_f64().unwrap_or_default()
}

/// Rows from the top: a Block whose vertical range overlaps the current row joins it; a row
/// reads left to right.
fn reading_order(sheet: &SheetDto) -> Vec<&BlockDto> {
    let mut blocks: Vec<&BlockDto> = sheet.blocks.iter().collect();
    blocks.sort_by(|left, right| {
        number(&left.position.y)
            .total_cmp(&number(&right.position.y))
            .then(number(&left.position.x).total_cmp(&number(&right.position.x)))
    });
    let mut ordered = Vec::new();
    let mut row: Vec<&BlockDto> = Vec::new();
    let mut row_bottom = f64::NEG_INFINITY;
    for block in blocks {
        let top = number(&block.position.y);
        let bottom = top + number(&block.size.height);
        if !row.is_empty() && top >= row_bottom {
            row.sort_by(|left, right| {
                number(&left.position.x).total_cmp(&number(&right.position.x))
            });
            ordered.append(&mut row);
            row_bottom = f64::NEG_INFINITY;
        }
        row_bottom = row_bottom.max(bottom);
        row.push(block);
    }
    row.sort_by(|left, right| number(&left.position.x).total_cmp(&number(&right.position.x)));
    ordered.append(&mut row);
    ordered
}

fn fence_of(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    if trimmed.starts_with(BACKTICK_FENCE) {
        Some(BACKTICK_FENCE)
    } else if trimmed.starts_with(TILDE_FENCE) {
        Some(TILDE_FENCE)
    } else {
        None
    }
}

/// ATX headings move down by `HEADING_SHIFT` (at most to `######`); lines inside fenced code
/// are left alone.
fn shift_headings(text: &str) -> String {
    let mut open_fence: Option<&str> = None;
    let mut lines = Vec::new();
    for line in text.split('\n') {
        if let Some(fence) = fence_of(line) {
            open_fence = match open_fence {
                None => Some(fence),
                Some(open) if open == fence => None,
                other => other,
            };
            lines.push(line.to_owned());
            continue;
        }
        let hashes = line
            .chars()
            .take_while(|character| *character == '#')
            .count();
        let is_heading = open_fence.is_none()
            && (1..=MAX_HEADING_LEVEL).contains(&hashes)
            && line[hashes..]
                .chars()
                .next()
                .is_none_or(|character| character == ' ');
        if is_heading {
            let level = (hashes + HEADING_SHIFT).min(MAX_HEADING_LEVEL);
            lines.push(format!("{}{}", "#".repeat(level), &line[hashes..]));
        } else {
            lines.push(line.to_owned());
        }
    }
    lines.join("\n")
}

/// The Document-relative asset (`assets/<file>`) a destination written in the Markdown file at
/// `markdown_path` points at, or None (the same rules as the Frontend's resolver).
fn resolve_asset(markdown_path: &str, destination: &str) -> Option<String> {
    if destination.contains("://") || destination.starts_with('/') || destination.contains(':') {
        return None;
    }
    let mut resolved: Vec<String> = markdown_path
        .split(PATH_SEPARATOR)
        .map(str::to_owned)
        .collect();
    resolved.pop();
    for raw in destination.split(PATH_SEPARATOR) {
        let segment = percent_decode(raw)?;
        if segment.is_empty() || segment.contains(['/', '\\', '?', '#']) {
            return None;
        }
        if segment == CURRENT_SEGMENT && raw == segment {
            continue;
        }
        if segment == PARENT_SEGMENT && raw == segment {
            resolved.pop()?;
            continue;
        }
        resolved.push(segment);
    }
    match resolved.as_slice() {
        [directory, file] if directory == ASSETS_DIRECTORY => {
            Some(format!("{ASSETS_DIRECTORY}{PATH_SEPARATOR}{file}"))
        }
        _ => None,
    }
}

fn percent_decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = segment.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// Spaces and the characters that would end or break a link destination, percent-encoded.
fn encode_destination(path: &str) -> String {
    path.chars()
        .map(|character| match character {
            ' ' => "%20".to_owned(),
            '(' => "%28".to_owned(),
            ')' => "%29".to_owned(),
            '<' => "%3C".to_owned(),
            '>' => "%3E".to_owned(),
            '[' => "%5B".to_owned(),
            ']' => "%5D".to_owned(),
            '%' => "%25".to_owned(),
            other => other.to_string(),
        })
        .collect()
}

/// Rewrites every `](destination` that points at an asset of the Document so it points into
/// `assets_prefix` instead; records each asset once in `assets`.
fn rewrite_image_destinations(
    text: &str,
    markdown_path: &str,
    assets_prefix: &str,
    assets: &mut Vec<String>,
) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find("](") {
        let (before, after) = rest.split_at(index + 2);
        output.push_str(before);
        let trimmed = after.trim_start();
        output.push_str(&after[..after.len() - trimmed.len()]);
        let (written, consumed) = if let Some(inner) = trimmed.strip_prefix('<') {
            match inner.find('>') {
                Some(end) => (&inner[..end], end + 2),
                None => ("", 0),
            }
        } else {
            let end = trimmed
                .find(|character: char| character == ')' || character.is_whitespace())
                .unwrap_or(trimmed.len());
            (&trimmed[..end], end)
        };
        match resolve_asset(markdown_path, written) {
            Some(asset) if consumed > 0 => {
                let file = asset.trim_start_matches(&format!("{ASSETS_DIRECTORY}{PATH_SEPARATOR}"));
                output.push_str(&encode_destination(&format!("{assets_prefix}{file}")));
                if !assets.contains(&asset) {
                    assets.push(asset);
                }
                rest = &trimmed[consumed..];
            }
            _ => rest = trimmed,
        }
    }
    output.push_str(rest);
    output
}

/// A fence longer than any run of backticks in the text, so the text cannot close it.
fn fenced(language: &str, text: &str) -> String {
    let mut longest = 0;
    let mut current = 0;
    for character in text.chars() {
        if character == FENCE_CHARACTER {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 0;
        }
    }
    let fence = FENCE_CHARACTER
        .to_string()
        .repeat((longest + 1).max(MIN_FENCE));
    format!(
        "{fence}{language}\n{}\n{fence}",
        text.trim_end_matches('\n')
    )
}

fn file_stem(content_path: &str) -> &str {
    let file = content_path
        .rsplit(PATH_SEPARATOR)
        .next()
        .unwrap_or(content_path);
    file.rsplit_once('.').map_or(file, |(stem, _)| stem)
}

/// Builds the Markdown of one Document. `assets_prefix` is what image references start with
/// (`assets/` for the text alone, `<stem>-assets/` for a file with copied images).
pub fn document_markdown(
    root: &Path,
    document_id: &str,
    assets_prefix: &str,
) -> ApplicationResult<ExportedMarkdown> {
    let mut sessions = ProjectSessions::default();
    let project = open_project(&mut sessions, root)?;
    let project_id = project.project.project_id.clone();
    let document = load_document(&mut sessions, &project_id, document_id)?;
    let mut parts = vec![format!("# {}", document.document.name)];
    let mut assets = Vec::new();
    for sheet_id in &document.document.sheet_order {
        let Some(sheet) = document
            .sheets
            .iter()
            .find(|entry| &entry.sheet_id == sheet_id)
            .and_then(|entry| entry.sheet.as_ref())
        else {
            continue;
        };
        parts.push(format!("## {}", sheet.name));
        for block in reading_order(sheet) {
            let Ok(block_type) = BlockType::parse(&block.block_type) else {
                continue;
            };
            let body = if is_text_block_type(block_type) {
                let Ok(content) = read_text_block(&mut sessions, &project_id, document_id, block)
                else {
                    continue;
                };
                if block_type == BlockType::Mermaid {
                    fenced(MERMAID_LANGUAGE, &content.text)
                } else {
                    rewrite_image_destinations(
                        &shift_headings(content.text.trim_end_matches('\n')),
                        &block.content_path,
                        assets_prefix,
                        &mut assets,
                    )
                }
            } else {
                let file = block
                    .content_path
                    .trim_start_matches(&format!("{ASSETS_DIRECTORY}{PATH_SEPARATOR}"));
                if !assets.contains(&block.content_path) {
                    assets.push(block.content_path.clone());
                }
                let alt = block
                    .caption
                    .clone()
                    .unwrap_or_else(|| file_stem(&block.content_path).to_owned())
                    .replace(['[', ']'], "");
                format!(
                    "![{alt}]({})",
                    encode_destination(&format!("{assets_prefix}{file}"))
                )
            };
            match &block.caption {
                Some(caption) if block.caption_position.as_deref() == Some(CAPTION_ABOVE) => {
                    parts.push(format!("*{caption}*\n\n{body}"));
                }
                Some(caption) => parts.push(format!("{body}\n\n*{caption}*")),
                None => parts.push(body),
            }
        }
    }
    Ok(ExportedMarkdown {
        text: format!("{}\n", parts.join("\n\n")),
        assets,
    })
}

fn suggested_file_name(document_name: &str) -> String {
    let cleaned: String = document_name
        .chars()
        .map(|character| {
            if UNSAFE_FILE_NAME_CHARACTERS.contains(&character) || character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect();
    let stem = cleaned.trim().trim_end_matches('.');
    let stem = if stem.is_empty() {
        FALLBACK_FILE_STEM
    } else {
        stem
    };
    format!("{stem}.{MARKDOWN_EXTENSION}")
}

fn write_error(detail: String) -> ApplicationError {
    ApplicationError::new(ErrorKind::ExportFailed, detail)
}

/// Writes `text` next to a temporary name first and renames it over the target, so a failed
/// write never leaves half a file where the user asked for one.
pub fn write_file_atomically(target: &Path, bytes: &[u8]) -> ApplicationResult<()> {
    let mut temporary = target.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    fs::write(&temporary, bytes).map_err(|error| write_error(format!("write: {error}")))?;
    fs::rename(&temporary, target).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        write_error(format!("replace: {error}"))
    })
}

/// Asks where to save, then writes the Markdown file and copies the images it refers to into
/// `<stem>-assets/` beside it. The paths stay in Rust; the Frontend gets the file's name.
pub fn export_document_markdown(
    dialogs: &dyn FileDialogs,
    root: &Path,
    document_id: &str,
) -> ApplicationResult<SaveOutcome> {
    let document_name = {
        let mut sessions = ProjectSessions::default();
        let project = open_project(&mut sessions, root)?;
        load_document(&mut sessions, &project.project.project_id, document_id)?
            .document
            .name
    };
    let Some(target) = dialogs.save_file(MARKDOWN_FILTER, &suggested_file_name(&document_name))?
    else {
        return Ok(SaveOutcome::Cancelled);
    };
    let stem = target.file_stem().map_or_else(
        || FALLBACK_FILE_STEM.to_owned(),
        |stem| stem.to_string_lossy().into_owned(),
    );
    let assets_folder_name = format!("{stem}{EXPORT_ASSETS_SUFFIX}");
    let exported = document_markdown(
        root,
        document_id,
        &format!("{assets_folder_name}{PATH_SEPARATOR}"),
    )?;
    if !exported.assets.is_empty() {
        let mut sessions = ProjectSessions::default();
        let project = open_project(&mut sessions, root)?;
        let project_id = project.project.project_id.clone();
        load_document(&mut sessions, &project_id, document_id)?;
        let session = sessions.session_mut(&project_id)?;
        let base = session.document_base(&DocumentId::parse(document_id)?)?;
        let folder = target.with_file_name(&assets_folder_name);
        fs::create_dir_all(&folder)
            .map_err(|error| write_error(format!("assets folder: {error}")))?;
        for asset in &exported.assets {
            // An image that is gone or outside the Document is skipped; its reference stays.
            let Ok(source) = session.resolve_existing_path(&base, asset) else {
                continue;
            };
            let file = asset.trim_start_matches(&format!("{ASSETS_DIRECTORY}{PATH_SEPARATOR}"));
            fs::copy(&source, folder.join(file))
                .map_err(|error| write_error(format!("copy {file:?}: {error}")))?;
        }
    }
    write_file_atomically(&target, exported.text.as_bytes())?;
    Ok(SaveOutcome::Saved {
        file_name: target
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_move_down_except_in_code() {
        assert_eq!(
            shift_headings("# A\n## B\n```\n# not\n```\n###### deep\n#tag"),
            "### A\n#### B\n```\n# not\n```\n###### deep\n#tag"
        );
    }

    #[test]
    fn asset_destinations_point_into_the_export_folder() {
        let mut assets = Vec::new();
        let text = rewrite_image_destinations(
            "![a](../../../assets/a%20b.png) [x](https://e.x) ![c](<../../../assets/c.png>)",
            "sheets/s/blocks/markdown-1.md",
            "out-assets/",
            &mut assets,
        );
        assert_eq!(
            text,
            "![a](out-assets/a%20b.png) [x](https://e.x) ![c](out-assets/c.png)"
        );
        assert_eq!(assets, ["assets/a b.png", "assets/c.png"]);
    }

    #[test]
    fn a_fence_is_longer_than_any_backticks_inside() {
        assert_eq!(
            fenced("mermaid", "a ```` b\n"),
            "`````mermaid\na ```` b\n`````"
        );
        assert_eq!(fenced("mermaid", "graph TD"), "```mermaid\ngraph TD\n```");
    }

    #[test]
    fn suggested_names_are_safe_file_names() {
        assert_eq!(suggested_file_name("A/B: c?"), "A_B_ c_.md");
        assert_eq!(suggested_file_name(" . "), "document.md");
    }
}
