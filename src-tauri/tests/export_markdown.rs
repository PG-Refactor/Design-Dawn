//! "Export as Markdown…" and the MCP `exportMarkdown`, against the basic sample project.

mod support;

use std::fs;
use std::path::PathBuf;

use design_dawn_lib::application::export_markdown::{document_markdown, export_document_markdown};
use design_dawn_lib::application::file_dialogs::{FileDialogs, FileFilter, SaveOutcome};
use design_dawn_lib::application::folder_selection::FolderPickerError;
use support::*;

struct SavingTo(Option<PathBuf>);

impl FileDialogs for SavingTo {
    fn pick_file(&self, _: FileFilter) -> Result<Option<PathBuf>, FolderPickerError> {
        Ok(None)
    }

    fn save_file(
        &self,
        _: FileFilter,
        default_name: &str,
    ) -> Result<Option<PathBuf>, FolderPickerError> {
        assert_eq!(default_name, "System Design.md");
        Ok(self.0.clone())
    }
}

#[test]
fn the_text_has_the_document_its_sheets_and_blocks_in_order() {
    let opened = open_copy();
    let exported = document_markdown(&opened.root, DOCUMENT_ID, "assets/").unwrap();
    let text = &exported.text;
    assert!(text.starts_with("# System Design\n\n## Overview\n\n"));
    // The block's own "# Overview" heading moves below the Sheet heading.
    assert!(text.contains("### Overview"));
    assert!(text.contains("```mermaid\n"));
    assert!(text.contains("](assets/pixel.png)"));
    let overview = text.find("## Overview").unwrap();
    let details = text.find("## Details").unwrap();
    assert!(overview < details);
    assert_eq!(exported.assets, ["assets/pixel.png"]);
}

#[test]
fn the_file_is_written_with_its_images_beside_it() {
    let opened = open_copy();
    let out = opened.temp.path().join("out");
    fs::create_dir_all(&out).unwrap();
    let target = out.join("design.md");
    let result = export_document_markdown(
        &SavingTo(Some(target.clone())),
        &opened.root,
        DOCUMENT_ID,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        result,
        SaveOutcome::Saved {
            file_name: "design.md".to_owned()
        }
    );
    let text = fs::read_to_string(&target).unwrap();
    assert!(text.contains("](design-assets/pixel.png)"));
    assert!(out.join("design-assets/pixel.png").is_file());
    assert!(!out.join("design.md.tmp").exists());
}

#[test]
fn a_cancelled_dialog_writes_nothing() {
    let opened = open_copy();
    assert_eq!(
        export_document_markdown(&SavingTo(None), &opened.root, DOCUMENT_ID, None, None).unwrap(),
        SaveOutcome::Cancelled
    );
}
