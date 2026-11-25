//! Custom templates on disk: saved whole into one of three places, listed, read back for
//! creating from them, renamed, moved and deleted; a template never leads out of its folder.

mod support;

use std::fs;

use support::TempDir;

use design_dawn_lib::application::error::ApplicationResult;
use design_dawn_lib::application::templates::{
    delete_template, list_templates, move_template, read_template, rename_template,
    replace_template, save_template, template_asset_path, TemplateBlockContent, TemplateContent,
    TemplateKind, TemplateRoots, TemplateScope, TemplateSheetContent,
};

fn roots(base: &std::path::Path) -> TemplateRoots {
    TemplateRoots {
        shared: Some(base.join("project/templates")),
        project: Some(base.join("local/projects/p1")),
        global: base.join("local/global"),
    }
}

fn text_block(block_type: &str, text: &str, x: i64) -> TemplateBlockContent {
    TemplateBlockContent {
        block_type: block_type.to_owned(),
        x,
        y: 0,
        width: 320,
        height: 200,
        caption: None,
        caption_position: None,
        content_scale_percent: None,
        auto_fit: None,
        text: Some(text.to_owned()),
        asset: None,
    }
}

fn image_block(asset: &str) -> TemplateBlockContent {
    TemplateBlockContent {
        block_type: "image".to_owned(),
        x: 400,
        y: 0,
        width: 160,
        height: 120,
        caption: Some("Logo".to_owned()),
        caption_position: Some("below".to_owned()),
        content_scale_percent: None,
        auto_fit: None,
        text: None,
        asset: Some(asset.to_owned()),
    }
}

fn read_asset(source: &str) -> ApplicationResult<(String, Vec<u8>)> {
    let name = source.rsplit('/').next().unwrap_or(source).to_owned();
    Ok((name, vec![1, 2, 3]))
}

fn block_template(name: &str, text: &str) -> TemplateContent {
    TemplateContent {
        name: name.to_owned(),
        block: Some(text_block("markdown", text, 0)),
        sheets: Vec::new(),
        document_name: None,
        assets: Vec::new(),
    }
}

#[test]
fn a_block_template_is_saved_as_a_readable_folder_and_read_back() {
    let temp = TempDir::new();
    let roots = roots(temp.path());
    let saved = save_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &block_template("議事録", "# 議事録\n"),
        &read_asset,
    )
    .unwrap();
    // Human-readable on disk: template.json next to the Markdown text.
    let folder = temp.path().join("project/templates/markdown");
    let entries: Vec<_> = fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(
        fs::read_to_string(entries[0].join("content.md")).unwrap(),
        "# 議事録\n"
    );
    let content = read_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &saved.template_id,
    )
    .unwrap();
    assert_eq!(content.name, "議事録");
    assert_eq!(content.block.unwrap().text.as_deref(), Some("# 議事録\n"));
}

#[test]
fn sheet_and_document_templates_keep_their_blocks_and_images() {
    let temp = TempDir::new();
    let roots = roots(temp.path());
    let sheet = TemplateSheetContent {
        sheet_name: "Overview".to_owned(),
        blocks: vec![
            text_block("markdown", "# Title\n![](../../../assets/chart.png)\n", 0),
            text_block("mermaid", "flowchart LR\n  A --> B\n", 400),
            image_block("assets/logo.png"),
        ],
    };
    let saved = save_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Document,
        &TemplateContent {
            name: "Design".to_owned(),
            block: None,
            sheets: vec![sheet.clone(), sheet],
            document_name: Some("Design Doc".to_owned()),
            assets: vec!["assets/chart.png".to_owned()],
        },
        &read_asset,
    )
    .unwrap();
    let content = read_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Document,
        &saved.template_id,
    )
    .unwrap();
    assert_eq!(content.document_name.as_deref(), Some("Design Doc"));
    assert_eq!(content.sheets.len(), 2);
    let blocks = &content.sheets[1].blocks;
    assert_eq!(blocks[1].text.as_deref(), Some("flowchart LR\n  A --> B\n"));
    assert_eq!(blocks[2].asset.as_deref(), Some("logo.png"));
    assert_eq!(blocks[2].caption.as_deref(), Some("Logo"));
    let mut assets = content.assets.clone();
    assets.sort();
    assert_eq!(assets, ["chart.png", "logo.png"]);
    assert!(template_asset_path(
        &roots,
        TemplateScope::Global,
        TemplateKind::Document,
        &saved.template_id,
        "logo.png"
    )
    .is_ok());
}

#[test]
fn templates_are_listed_by_place_and_kind_and_can_be_renamed_moved_and_deleted() {
    let temp = TempDir::new();
    let roots = roots(temp.path());
    let first = save_template(
        &roots,
        TemplateScope::Project,
        TemplateKind::Markdown,
        &block_template("Memo", "memo\n"),
        &read_asset,
    )
    .unwrap();
    save_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Mermaid,
        &TemplateContent {
            block: Some(text_block("mermaid", "pie\n", 0)),
            ..block_template("Pie", "")
        },
        &read_asset,
    )
    .unwrap();
    let list = list_templates(&roots);
    assert!(list.issues.is_empty());
    let summary: Vec<_> = list
        .templates
        .iter()
        .map(|t| (t.scope, t.kind, t.name.as_str()))
        .collect();
    assert_eq!(
        summary,
        [
            (TemplateScope::Project, TemplateKind::Markdown, "Memo"),
            (TemplateScope::Global, TemplateKind::Mermaid, "Pie"),
        ]
    );

    rename_template(
        &roots,
        TemplateScope::Project,
        TemplateKind::Markdown,
        &first.template_id,
        "Notes",
    )
    .unwrap();
    move_template(
        &roots,
        TemplateScope::Project,
        TemplateKind::Markdown,
        &first.template_id,
        TemplateScope::Shared,
    )
    .unwrap();
    let moved = read_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &first.template_id,
    )
    .unwrap();
    assert_eq!(moved.name, "Notes");
    assert!(read_template(
        &roots,
        TemplateScope::Project,
        TemplateKind::Markdown,
        &first.template_id
    )
    .is_err());
    delete_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &first.template_id,
    )
    .unwrap();
    assert_eq!(list_templates(&roots).templates.len(), 1);
    // Moving the last Project template away and deleting the last shared one leave no
    // empty folders behind.
    let shared = roots.shared.clone().unwrap();
    assert!(!shared.join("markdown").exists());
    assert!(!shared.exists());
    let project = roots.project.clone().unwrap();
    assert!(!project.join("markdown").exists());
    // A folder that still holds a template stays.
    assert!(roots.global.join("mermaid").is_dir());
}

#[test]
fn a_template_cannot_lead_out_of_its_folder_and_a_broken_one_is_reported() {
    let temp = TempDir::new();
    let roots = roots(temp.path());
    let saved = save_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Markdown,
        &block_template("Memo", "memo\n"),
        &read_asset,
    )
    .unwrap();
    let folder = fs::read_dir(temp.path().join("local/global/markdown"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::write(temp.path().join("secret.txt"), "secret").unwrap();
    let json = fs::read_to_string(folder.join("template.json"))
        .unwrap()
        .replace("content.md", "../../../../secret.txt");
    fs::write(folder.join("template.json"), json).unwrap();
    assert!(read_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Markdown,
        &saved.template_id
    )
    .is_err());
    assert!(template_asset_path(
        &roots,
        TemplateScope::Global,
        TemplateKind::Markdown,
        &saved.template_id,
        "../template.json"
    )
    .is_err());

    fs::create_dir_all(temp.path().join("local/global/markdown/broken")).unwrap();
    fs::write(
        temp.path()
            .join("local/global/markdown/broken/template.json"),
        "{",
    )
    .unwrap();
    let list = list_templates(&roots);
    assert_eq!(list.issues.len(), 1);
    assert_eq!(list.issues[0].folder, "broken");
}

#[test]
fn a_block_template_refuses_a_block_of_another_kind_and_needs_a_name() {
    let temp = TempDir::new();
    let roots = roots(temp.path());
    assert!(save_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Mermaid,
        &block_template("Memo", "memo\n"),
        &read_asset,
    )
    .is_err());
    assert!(save_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Markdown,
        &block_template("  ", "memo\n"),
        &read_asset,
    )
    .is_err());
    // Nothing half-written is left behind.
    let leftovers = temp.path().join("local/global/mermaid");
    assert!(!leftovers.exists() || fs::read_dir(&leftovers).unwrap().next().is_none());
}

#[test]
fn a_template_is_rewritten_in_place_keeping_its_id_name_and_folder() {
    let temp = TempDir::new();
    let roots = roots(temp.path());
    let saved = save_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &block_template("Memo", "old\n"),
        &read_asset,
    )
    .unwrap();
    let folder = temp.path().join("project/templates/markdown");
    let before: Vec<_> = fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    replace_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &saved.template_id,
        &block_template("ignored", "new\n"),
        &read_asset,
    )
    .unwrap();
    let content = read_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &saved.template_id,
    )
    .unwrap();
    assert_eq!(content.name, "Memo");
    assert_eq!(content.block.unwrap().text.as_deref(), Some("new\n"));
    let after: Vec<_> = fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(before, after);
    // A content of the wrong kind leaves the template as it was.
    let wrong = TemplateContent {
        block: Some(text_block("mermaid", "pie\n", 0)),
        ..block_template("x", "")
    };
    assert!(replace_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &saved.template_id,
        &wrong,
        &read_asset,
    )
    .is_err());
    let unchanged = read_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Markdown,
        &saved.template_id,
    )
    .unwrap();
    assert_eq!(unchanged.block.unwrap().text.as_deref(), Some("new\n"));
    assert_eq!(list_templates(&roots).templates.len(), 1);
}

#[test]
fn places_and_kinds_are_named_and_an_unknown_name_is_refused() {
    for name in ["shared", "project", "global"] {
        assert!(TemplateScope::parse(name).is_ok(), "{name}");
    }
    for name in ["markdown", "mermaid", "sheet", "document"] {
        assert!(TemplateKind::parse(name).is_ok(), "{name}");
    }
    assert!(TemplateScope::parse("cloud").is_err());
    assert!(TemplateKind::parse("image").is_err());
}

#[test]
fn a_template_of_another_kind_or_format_is_reported_and_a_link_out_is_refused() {
    let temp = TempDir::new();
    let roots = roots(temp.path());
    let saved = save_template(
        &roots,
        TemplateScope::Global,
        TemplateKind::Markdown,
        &block_template("Memo", "memo\n"),
        &read_asset,
    )
    .unwrap();
    let markdown = temp.path().join("local/global/markdown");
    let folder = fs::read_dir(&markdown)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();

    // The same folder copied into the Mermaid templates, and one with another format.
    let misplaced = temp.path().join("local/global/mermaid/misplaced");
    support::copy_dir_all(&folder, &misplaced);
    let newer = markdown.join("newer");
    support::copy_dir_all(&folder, &newer);
    let json = fs::read_to_string(newer.join("template.json")).unwrap();
    let json = json.replacen("\"schemaVersion\": 1", "\"schemaVersion\": 99", 1);
    fs::write(newer.join("template.json"), json).unwrap();
    let list = list_templates(&roots);
    let mut folders: Vec<_> = list
        .issues
        .iter()
        .map(|issue| issue.folder.as_str())
        .collect();
    folders.sort_unstable();
    assert_eq!(folders, ["misplaced", "newer"]);

    // A file of the template that is a link to a file outside it.
    #[cfg(unix)]
    {
        fs::write(temp.path().join("outside.md"), "outside").unwrap();
        fs::remove_file(folder.join("content.md")).unwrap();
        std::os::unix::fs::symlink(temp.path().join("outside.md"), folder.join("content.md"))
            .unwrap();
        assert!(read_template(
            &roots,
            TemplateScope::Global,
            TemplateKind::Markdown,
            &saved.template_id
        )
        .is_err());
    }
}
