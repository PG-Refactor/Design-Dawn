//! Writing an export the Frontend made (an SVG, a PNG, an HTML page, a PDF) where the user
//! chooses, and a Document's Markdown into a chosen folder.

mod support;

use std::fs;
use std::path::PathBuf;

use design_dawn_lib::application::export_file::{
    check_export, export_bytes, ExportKind, EXPORT_MAX_BYTES,
};
use design_dawn_lib::application::export_markdown::export_document_markdown_into;
use design_dawn_lib::application::file_dialogs::{FileDialogs, FileFilter, SaveOutcome};
use design_dawn_lib::application::folder_selection::FolderPickerError;
use support::*;

struct SavingTo(Option<PathBuf>);

impl FileDialogs for SavingTo {
    fn pick_file(&self, _: FileFilter) -> Result<Option<PathBuf>, FolderPickerError> {
        Ok(None)
    }

    fn save_file(&self, _: FileFilter, _: &str) -> Result<Option<PathBuf>, FolderPickerError> {
        Ok(self.0.clone())
    }
}

#[test]
fn the_kinds_are_named_like_their_files() {
    for name in ["svg", "png", "html", "pdf"] {
        assert!(ExportKind::parse(name).is_some(), "{name}");
    }
    assert!(ExportKind::parse("docx").is_none());
}

#[test]
fn an_export_is_written_where_the_user_chose_or_not_at_all() {
    let temp = TempDir::new();
    let target = temp.path().join("figure.svg");
    let saved = export_bytes(
        &SavingTo(Some(target.clone())),
        ExportKind::Svg,
        "Figure",
        b"<svg/>",
    )
    .unwrap();
    assert_eq!(
        saved,
        SaveOutcome::Saved {
            file_name: "figure.svg".to_owned()
        }
    );
    assert_eq!(fs::read(&target).unwrap(), b"<svg/>");
    assert_eq!(
        export_bytes(&SavingTo(None), ExportKind::Svg, "Figure", b"<svg/>").unwrap(),
        SaveOutcome::Cancelled
    );
    assert!(export_bytes(&SavingTo(None), ExportKind::Png, "Figure", b"not a png").is_err());
}

#[test]
fn an_export_larger_than_the_limit_is_refused() {
    let bytes = vec![b'a'; EXPORT_MAX_BYTES + 1];
    assert!(check_export(ExportKind::Svg, &bytes).is_err());
}

#[test]
fn a_documents_markdown_is_written_into_a_new_folder() {
    let opened = open_copy();
    let folder = opened.temp.path().join("exports").join("today");
    let name =
        export_document_markdown_into(&opened.root, DOCUMENT_ID, &folder, "System Design").unwrap();
    assert_eq!(name, "System Design.md");
    assert!(read_text(&folder.join(&name)).starts_with("# System Design"));
}
