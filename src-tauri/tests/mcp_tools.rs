//! The MCP tools against temporary copies of the sample Projects:
//! every tool's success and refusals, read-only Projects, conflicts, hostile IDs, and that
//! what the tools write loads in the app's loader without Load Issues.

mod support;

use std::fs;
use std::path::Path;

use design_dawn_lib::application::document_operations::load_document;
use design_dawn_lib::application::local_state::ai_access::AiAccessList;
use design_dawn_lib::application::project_operations::load_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::domain::entity_id::ProjectId;
use design_dawn_lib::infrastructure::filesystem::hashing::sha256_hex;
use design_dawn_lib::mcp::config::{BLOCK_MIN_HEIGHT, BLOCK_MIN_WIDTH};
use design_dawn_lib::mcp::protocol::ToolHost;
use design_dawn_lib::mcp::tools::ToolContext;
use serde_json::{json, Value};
use support::*;

const MERMAID_BLOCK_ID: &str = "01928f3a-a0b1-7c23-a456-789abcdef012";
const IMAGE_BLOCK_ID: &str = "01928f3a-9fa0-7b12-9345-6789abcdef01";
const READ_TOOLS: [&str; 7] = [
    "getProject",
    "getDocument",
    "getSheet",
    "getBlock",
    "listTemplates",
    "searchProject",
    "exportMarkdown",
];
const WRITE_TOOLS: [&str; 11] = [
    "createDocument",
    "createSheet",
    "createBlock",
    "createFromTemplate",
    "updateDocument",
    "updateSheet",
    "updateBlock",
    "moveBlock",
    "updateBlockCaption",
    "deleteBlock",
    "importImage",
];
/// Choosing and offering Projects; listed first.
const ACCESS_TOOLS: [&str; 4] = [
    "listProjects",
    "selectProject",
    "addProject",
    "setWriteAccess",
];
/// What changes the AI access list rather than a Project.
const ACCESS_CHANGING_TOOLS: [&str; 2] = ["addProject", "setWriteAccess"];
const TEXT_LIMIT_PLUS_ONE: usize = 1024 * 1024 + 1;

struct Reply {
    is_error: bool,
    value: Value,
}

impl Reply {
    fn ok(self) -> Value {
        assert!(!self.is_error, "expected success, got {}", self.value);
        self.value
    }

    fn error_kind(self) -> String {
        assert!(self.is_error, "expected an error, got {}", self.value);
        self.value["error"]["kind"]
            .as_str()
            .expect("an error kind")
            .to_owned()
    }
}

fn call(context: &ToolContext, name: &str, arguments: Value) -> Reply {
    let arguments = arguments.as_object().expect("arguments are an object");
    let output = context
        .call_tool(name, arguments)
        .unwrap_or_else(|| panic!("{name} is not a tool"));
    Reply {
        is_error: output.is_error,
        value: output.value,
    }
}

/// The app's settings folder of a test, beside the Project folder in its temporary folder.
fn config_dir_beside(root: &Path) -> std::path::PathBuf {
    root.parent().unwrap().join("app-config")
}

/// A server whose AI access list offers the Project in `root` and has it open in the app.
fn context_for(root: &Path, allow_write: bool) -> ToolContext {
    let config_dir = config_dir_beside(root);
    let project_id = design_dawn_lib::application::project_operations::read_project_identity(root)
        .expect("a Project folder")
        .project_id;
    let mut list = AiAccessList::read(&config_dir).unwrap();
    list.add(project_id, root);
    list.record_used(project_id, root);
    list.set_allow_write(&project_id, allow_write).unwrap();
    list.write(&config_dir).unwrap();
    ToolContext::new(&config_dir)
}

fn all_tools() -> Vec<&'static str> {
    let mut expected: Vec<&str> = ACCESS_TOOLS.to_vec();
    expected.extend(READ_TOOLS);
    expected.extend(WRITE_TOOLS);
    expected
}

fn overview_ids() -> Value {
    json!({ "documentId": DOCUMENT_ID, "sheetId": OVERVIEW_SHEET_ID })
}

fn with(base: Value, extra: Value) -> Value {
    let mut merged = base;
    merged
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    merged
}

fn block_arguments(block_id: &str, extra: Value) -> Value {
    with(with(overview_ids(), json!({ "blockId": block_id })), extra)
}

fn overview_file(root: &Path, relative: &str) -> std::path::PathBuf {
    sheet_dir(root, "overview").join(relative)
}

/// The Project must open and every Document must load without a single Load Issue.
fn assert_loads_without_issues(root: &Path) {
    let loaded = load_project(root).expect("the project loads");
    assert!(
        loaded.snapshot.issues.is_empty(),
        "{:?}",
        loaded.snapshot.issues
    );
    let mut sessions = ProjectSessions::default();
    let project_id = loaded.snapshot.project.project_id.clone();
    sessions.insert(loaded.session);
    for document in &loaded.snapshot.documents {
        let snapshot = load_document(&mut sessions, &project_id, &document.document_id)
            .expect("the document loads");
        assert!(snapshot.issues.is_empty(), "{:?}", snapshot.issues);
    }
}

// ---- reads ----

#[test]
fn get_project_lists_the_project_and_its_documents() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    let project = call(&context, "getProject", json!({})).ok();
    assert_eq!(project["projectId"], PROJECT_ID);
    assert_eq!(project["name"], "Basic Project");
    assert_eq!(project["documents"][0]["documentId"], DOCUMENT_ID);
    assert_eq!(project["documents"][0]["name"], "System Design");
    assert_eq!(project["documents"][0]["folderId"], Value::Null);
    assert_eq!(project["issues"], json!([]));
}

#[test]
fn get_project_shows_the_folder_tree() {
    let (_temp, root) = folders_project_copy();
    let context = context_for(&root, false);
    let project = call(&context, "getProject", json!({})).ok();
    let folders = project["folders"].as_array().unwrap();
    let backend = folders
        .iter()
        .find(|folder| folder["folderId"] == BACKEND_FOLDER_ID)
        .expect("the backend folder");
    assert_eq!(backend["parentFolderId"], ARCHITECTURE_FOLDER_ID);
    let api_design = project["documents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|document| document["documentId"] == API_DESIGN_DOCUMENT_ID)
        .expect("the api design document");
    assert_eq!(api_design["folderId"], BACKEND_FOLDER_ID);
}

#[test]
fn get_document_lists_its_sheets_in_order() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    let document = call(
        &context,
        "getDocument",
        json!({ "documentId": DOCUMENT_ID }),
    )
    .ok();
    assert_eq!(document["name"], "System Design");
    let sheets = document["sheets"].as_array().unwrap();
    assert_eq!(sheets[0]["sheetId"], OVERVIEW_SHEET_ID);
    assert_eq!(sheets[0]["name"], "Overview");
    assert_eq!(sheets[1]["sheetId"], DETAILS_SHEET_ID);
}

#[test]
fn get_sheet_lists_blocks_back_to_front_without_their_text() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    let sheet = call(&context, "getSheet", overview_ids()).ok();
    let blocks = sheet["blocks"].as_array().unwrap();
    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[0]["blockId"], OVERVIEW_MARKDOWN_BLOCK_ID);
    assert_eq!(blocks[0]["blockType"], "markdown");
    assert_eq!(blocks[0]["zIndex"], 0);
    assert_eq!(blocks[0]["position"], json!({ "x": 100, "y": 200 }));
    assert_eq!(blocks[0]["size"], json!({ "width": 480, "height": 320 }));
    assert_eq!(blocks[2]["zIndex"], 2);
    for block in blocks {
        assert!(block.get("text").is_none());
        assert!(block.get("contentPath").is_none());
    }
}

#[test]
fn get_block_returns_text_and_the_hash_of_the_file() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    let block = call(
        &context,
        "getBlock",
        block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({})),
    )
    .ok();
    let file = fs::read(overview_file(&root, "blocks/markdown-1.md")).unwrap();
    assert_eq!(block["text"], String::from_utf8(file.clone()).unwrap());
    assert_eq!(block["contentHash"], sha256_hex(&file));

    let mermaid = call(
        &context,
        "getBlock",
        block_arguments(MERMAID_BLOCK_ID, json!({})),
    )
    .ok();
    assert_eq!(mermaid["blockType"], "mermaid");
    assert!(
        mermaid["text"].as_str().unwrap().contains("graph")
            || mermaid["text"].as_str().unwrap().contains("flowchart")
    );
}

#[test]
fn search_project_finds_text_with_its_place() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    let found = call(&context, "searchProject", json!({ "query": "BASIC" })).ok();
    let matches = found["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0]["blockId"], OVERVIEW_MARKDOWN_BLOCK_ID);
    assert_eq!(matches[0]["line"], 3);
    assert_eq!(found["truncated"], false);
    let exact = call(
        &context,
        "searchProject",
        json!({ "query": "BASIC", "matchCase": true }),
    )
    .ok();
    assert!(exact["matches"].as_array().unwrap().is_empty());
    let pattern = call(
        &context,
        "searchProject",
        json!({ "query": "BAS[a-z]C", "regex": true }),
    )
    .ok();
    assert_eq!(pattern["matches"].as_array().unwrap().len(), 1);
    assert_eq!(pattern["matches"][0]["matchLength"], 5);
    assert_eq!(
        call(
            &context,
            "searchProject",
            json!({ "query": "(", "regex": true }),
        )
        .error_kind(),
        "invalidSearchPattern"
    );
}

#[test]
fn export_markdown_returns_the_document_as_one_text() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    let exported = call(
        &context,
        "exportMarkdown",
        json!({ "documentId": DOCUMENT_ID }),
    )
    .ok();
    let text = exported["markdown"].as_str().unwrap();
    assert!(text.starts_with("# System Design"));
    assert!(text.contains("](assets/pixel.png)"));
}

#[test]
fn get_block_describes_an_image_without_its_bytes() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    let block = call(
        &context,
        "getBlock",
        block_arguments(IMAGE_BLOCK_ID, json!({})),
    )
    .ok();
    assert_eq!(block["image"]["fileName"], "pixel.png");
    assert_eq!(block["image"]["format"], "png");
    assert_eq!(block["image"]["width"], 1);
    assert_eq!(block["image"]["height"], 1);
    assert!(block.get("text").is_none());
    assert!(block.get("contentHash").is_none());
}

// ---- read-only mode ----

fn tool_names(context: &ToolContext) -> Vec<String> {
    context
        .list_tools()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_read_only_project_refuses_every_write_tool() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    // Listed all the same: the permission can change while the session runs.
    assert_eq!(tool_names(&context), all_tools());
    let before = tree_snapshot(&root);
    for name in WRITE_TOOLS {
        let kind = call(&context, name, json!({})).error_kind();
        assert_eq!(kind, "writeDisabled", "{name}");
    }
    // Even with valid arguments the refusal comes first and nothing is touched.
    let kind = call(
        &context,
        "createSheet",
        json!({ "documentId": DOCUMENT_ID, "name": "X" }),
    )
    .error_kind();
    assert_eq!(kind, "writeDisabled");
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn every_tool_is_listed_with_a_closed_input_schema() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    assert_eq!(tool_names(&context), all_tools());
    for tool in context.list_tools() {
        let schema = &tool["inputSchema"];
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        let name = tool["name"].as_str().unwrap();
        // The client asks the user before a call that is not read-only.
        let changes = WRITE_TOOLS.contains(&name) || ACCESS_CHANGING_TOOLS.contains(&name);
        assert_eq!(tool["annotations"]["readOnlyHint"], !changes, "{name}");
    }
}

#[test]
fn unknown_tools_are_not_tools() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    assert!(context
        .call_tool("deleteDocument", &serde_json::Map::new())
        .is_none());
}

// ---- writes ----

#[test]
fn create_document_at_the_root_is_listed_and_loads() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let created = call(&context, "createDocument", json!({ "name": "  Plan  " })).ok();
    let document_id = created["documentId"].as_str().unwrap().to_owned();
    assert_eq!(created["name"], "Plan");

    let project = call(&context, "getProject", json!({})).ok();
    let ids: Vec<&Value> = project["documents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|document| &document["documentId"])
        .collect();
    assert_eq!(ids.last().unwrap().as_str().unwrap(), document_id);
    assert_eq!(
        project["childOrder"].as_array().unwrap().last().unwrap(),
        &json!(document_id)
    );
    // Like the app's new Document: no Sheet yet.
    let document = call(
        &context,
        "getDocument",
        json!({ "documentId": document_id }),
    )
    .ok();
    assert_eq!(document["sheets"], json!([]));
    assert_loads_without_issues(&root);
}

#[test]
fn create_document_in_a_folder_is_listed_by_the_folder() {
    let (_temp, root) = folders_project_copy();
    let context = context_for(&root, true);
    let created = call(
        &context,
        "createDocument",
        json!({ "name": "Notes", "folderId": BACKEND_FOLDER_ID }),
    )
    .ok();
    let project = call(&context, "getProject", json!({})).ok();
    let backend = project["folders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|folder| folder["folderId"] == BACKEND_FOLDER_ID)
        .unwrap();
    assert_eq!(
        backend["childOrder"].as_array().unwrap().last().unwrap(),
        &created["documentId"]
    );
    assert_eq!(project["issues"], json!([]));
    assert_loads_without_issues(&root);
}

#[test]
fn create_document_refuses_a_missing_folder_and_bad_names_and_leaves_no_trace() {
    let (_temp, root) = folders_project_copy();
    let context = context_for(&root, true);
    let before = tree_snapshot(&root);
    assert_eq!(
        call(
            &context,
            "createDocument",
            json!({ "name": "X", "folderId": UNKNOWN_ID })
        )
        .error_kind(),
        "entityNotFound"
    );
    assert_eq!(
        call(
            &context,
            "createDocument",
            json!({ "name": "X", "folderId": "../.." })
        )
        .error_kind(),
        "invalidEntityId"
    );
    for name in ["", "   ", "a\nb", &"x".repeat(201)] {
        assert_eq!(
            call(&context, "createDocument", json!({ "name": name })).error_kind(),
            "invalidDisplayName",
            "{name:?}"
        );
    }
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn create_sheet_appends_to_the_document() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let created = call(
        &context,
        "createSheet",
        json!({ "documentId": DOCUMENT_ID, "name": "Third" }),
    )
    .ok();
    let document = call(
        &context,
        "getDocument",
        json!({ "documentId": DOCUMENT_ID }),
    )
    .ok();
    let sheets = document["sheets"].as_array().unwrap();
    assert_eq!(sheets.len(), 3);
    assert_eq!(sheets[2]["sheetId"], created["sheetId"]);
    assert_eq!(sheets[2]["name"], "Third");
    assert_loads_without_issues(&root);
}

#[test]
fn create_block_writes_the_text_file_and_lists_the_block_in_front() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let created = call(
        &context,
        "createBlock",
        with(
            overview_ids(),
            json!({
                "type": "markdown",
                "text": "# Hello\r\nworld",
                "position": { "x": -5, "y": 7 },
                "size": { "width": 300, "height": 200 },
            }),
        ),
    )
    .ok();
    assert_eq!(created["blockType"], "markdown");
    assert_eq!(created["zIndex"], 3);
    assert_eq!(created["position"], json!({ "x": -5, "y": 7 }));
    assert_eq!(created["size"], json!({ "width": 300, "height": 200 }));
    // The hash is of the bytes on disk (CRLF stored as LF); the file is named after the
    // first heading.
    let file = fs::read(overview_file(&root, "blocks/markdown-2-hello.md")).unwrap();
    assert_eq!(file, b"# Hello\nworld");
    assert_eq!(created["contentHash"], sha256_hex(&file));

    let fetched = call(
        &context,
        "getBlock",
        block_arguments(created["blockId"].as_str().unwrap(), json!({})),
    )
    .ok();
    assert_eq!(fetched["text"], "# Hello\nworld");
    assert_loads_without_issues(&root);
}

#[test]
fn create_block_without_geometry_goes_below_the_lowest_block_at_the_default_size() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let created = call(
        &context,
        "createBlock",
        with(
            overview_ids(),
            json!({ "type": "mermaid", "text": "flowchart TD\n  A --> B" }),
        ),
    )
    .ok();
    // The lowest existing bottom is 200 + 320 (the markdown block); then the default gap.
    assert_eq!(created["position"], json!({ "x": 0, "y": 544 }));
    assert_eq!(created["size"], json!({ "width": 480, "height": 320 }));
    assert!(overview_file(&root, "blocks/mermaid-2.mmd").is_file());
    assert_loads_without_issues(&root);
}

#[test]
fn create_block_refuses_images_unknown_types_bad_geometry_and_huge_text_without_a_trace() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let before = tree_snapshot(&root);
    let base = overview_ids();
    assert_eq!(
        call(
            &context,
            "createBlock",
            with(base.clone(), json!({ "type": "image", "text": "x" }))
        )
        .error_kind(),
        "unsupportedBlockType"
    );
    assert_eq!(
        call(
            &context,
            "createBlock",
            with(base.clone(), json!({ "type": "video", "text": "x" }))
        )
        .error_kind(),
        "unsupportedBlockType"
    );
    // Below the app's resize minimum on either axis (the file format alone would take 1).
    for size in [
        json!({"width": 0, "height": 10}),
        json!({"width": 10, "height": -1}),
        json!({"width": BLOCK_MIN_WIDTH - 1, "height": BLOCK_MIN_HEIGHT}),
        json!({"width": BLOCK_MIN_WIDTH, "height": BLOCK_MIN_HEIGHT - 1}),
    ] {
        assert_eq!(
            call(
                &context,
                "createBlock",
                with(
                    base.clone(),
                    json!({ "type": "markdown", "text": "x", "size": size })
                )
            )
            .error_kind(),
            "invalidSize"
        );
    }
    assert_eq!(
        call(&context, "createBlock", with(base.clone(), json!({ "type": "markdown", "text": "x", "position": {"x": 2147483648_i64, "y": 0} }))).error_kind(),
        "invalidPosition"
    );
    assert_eq!(
        call(
            &context,
            "createBlock",
            with(
                base,
                json!({ "type": "markdown", "text": "x".repeat(TEXT_LIMIT_PLUS_ONE) })
            )
        )
        .error_kind(),
        "contentTooLarge"
    );
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn update_block_replaces_the_text_when_the_hash_matches() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let read = call(
        &context,
        "getBlock",
        block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({})),
    )
    .ok();
    let updated = call(
        &context,
        "updateBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "text": "# New\n", "expectedContentHash": read["contentHash"] }),
        ),
    )
    .ok();
    assert_eq!(updated["written"], true);
    assert_eq!(
        fs::read_to_string(overview_file(&root, "blocks/markdown-1.md")).unwrap(),
        "# New\n"
    );
    assert_eq!(updated["contentHash"], sha256_hex(b"# New\n"));

    // The returned hash is the next expected hash; the same text again writes nothing.
    let again = call(
        &context,
        "updateBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "text": "# New\n", "expectedContentHash": updated["contentHash"] }),
        ),
    )
    .ok();
    assert_eq!(again["written"], false);
    assert_loads_without_issues(&root);
}

#[test]
fn update_block_reports_a_conflict_and_writes_nothing_when_the_text_changed_since() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let read = call(
        &context,
        "getBlock",
        block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({})),
    )
    .ok();
    // Somebody else (the app, an editor, git) changes the file after the AI read it.
    write_text(
        &overview_file(&root, "blocks/markdown-1.md"),
        "# Edited elsewhere\n",
    );
    let kind = call(
        &context,
        "updateBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "text": "# Mine\n", "expectedContentHash": read["contentHash"] }),
        ),
    )
    .error_kind();
    assert_eq!(kind, "conflict");
    assert_eq!(
        fs::read_to_string(overview_file(&root, "blocks/markdown-1.md")).unwrap(),
        "# Edited elsewhere\n"
    );
}

#[test]
fn update_block_refuses_bad_hashes_images_unknown_blocks_and_huge_text() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let before = tree_snapshot(&root);
    let hash = "0".repeat(64);
    for bad_hash in ["", "abc", &"G".repeat(64), &"A".repeat(64)] {
        assert_eq!(
            call(
                &context,
                "updateBlock",
                block_arguments(
                    OVERVIEW_MARKDOWN_BLOCK_ID,
                    json!({ "text": "x", "expectedContentHash": bad_hash })
                )
            )
            .error_kind(),
            "invalidArguments",
            "{bad_hash:?}"
        );
    }
    assert_eq!(
        call(
            &context,
            "updateBlock",
            block_arguments(
                IMAGE_BLOCK_ID,
                json!({ "text": "x", "expectedContentHash": hash })
            )
        )
        .error_kind(),
        "unsupportedBlockType"
    );
    assert_eq!(
        call(
            &context,
            "updateBlock",
            block_arguments(
                UNKNOWN_ID,
                json!({ "text": "x", "expectedContentHash": hash })
            )
        )
        .error_kind(),
        "entityNotFound"
    );
    assert_eq!(
        call(
            &context,
            "updateBlock",
            block_arguments(
                OVERVIEW_MARKDOWN_BLOCK_ID,
                json!({ "text": "x".repeat(TEXT_LIMIT_PLUS_ONE), "expectedContentHash": hash })
            )
        )
        .error_kind(),
        "contentTooLarge"
    );
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn update_document_and_update_sheet_rename() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    call(
        &context,
        "updateDocument",
        json!({ "documentId": DOCUMENT_ID, "name": "Renamed" }),
    )
    .ok();
    call(
        &context,
        "updateSheet",
        with(overview_ids(), json!({ "name": "Start" })),
    )
    .ok();
    let document = call(
        &context,
        "getDocument",
        json!({ "documentId": DOCUMENT_ID }),
    )
    .ok();
    assert_eq!(document["name"], "Renamed");
    assert_eq!(document["sheets"][0]["name"], "Start");
    // The order of the Sheets and the directory names are untouched.
    assert_eq!(document["sheets"][1]["sheetId"], DETAILS_SHEET_ID);
    assert!(sheet_dir(&root, "overview").is_dir());
    assert_eq!(
        call(
            &context,
            "updateDocument",
            json!({ "documentId": DOCUMENT_ID, "name": " " })
        )
        .error_kind(),
        "invalidDisplayName"
    );
    assert_loads_without_issues(&root);
}

#[test]
fn move_block_changes_position_and_optionally_size_keeping_z_order() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let moved = call(
        &context,
        "moveBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "position": { "x": 10, "y": -20 } }),
        ),
    )
    .ok();
    assert_eq!(moved["position"], json!({ "x": 10, "y": -20 }));
    assert_eq!(moved["size"], json!({ "width": 480, "height": 320 }));
    let resized = call(
        &context,
        "moveBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "position": { "x": 0, "y": 0 }, "size": { "width": 50, "height": 60 } }),
        ),
    )
    .ok();
    assert_eq!(resized["size"], json!({ "width": 50, "height": 60 }));
    assert_eq!(resized["zIndex"], 0);
    let smallest = json!({ "width": BLOCK_MIN_WIDTH, "height": BLOCK_MIN_HEIGHT });
    let at_minimum = call(
        &context,
        "moveBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "position": { "x": 0, "y": 0 }, "size": smallest }),
        ),
    )
    .ok();
    assert_eq!(at_minimum["size"], smallest);
    let refused = call(
        &context,
        "moveBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "position": { "x": 0, "y": 0 }, "size": { "width": 1, "height": 1 } }),
        ),
    );
    assert_eq!(refused.error_kind(), "invalidSize");
    assert_loads_without_issues(&root);
}

#[test]
fn move_block_refuses_invalid_geometry_and_unknown_blocks() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let before = tree_snapshot(&root);
    let at_origin = json!({ "x": 0, "y": 0 });
    assert_eq!(
        call(
            &context,
            "moveBlock",
            block_arguments(
                OVERVIEW_MARKDOWN_BLOCK_ID,
                json!({ "position": { "x": -2147483649_i64, "y": 0 } })
            )
        )
        .error_kind(),
        "invalidPosition"
    );
    assert_eq!(
        call(
            &context,
            "moveBlock",
            block_arguments(
                OVERVIEW_MARKDOWN_BLOCK_ID,
                json!({ "position": at_origin, "size": { "width": 0, "height": 5 } })
            )
        )
        .error_kind(),
        "invalidSize"
    );
    assert_eq!(
        call(
            &context,
            "moveBlock",
            block_arguments(
                OVERVIEW_MARKDOWN_BLOCK_ID,
                json!({ "position": { "x": 1.5, "y": 0 } })
            )
        )
        .error_kind(),
        "invalidArguments"
    );
    assert_eq!(
        call(
            &context,
            "moveBlock",
            block_arguments(UNKNOWN_ID, json!({ "position": at_origin }))
        )
        .error_kind(),
        "entityNotFound"
    );
    assert_eq!(
        call(
            &context,
            "moveBlock",
            block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({}))
        )
        .error_kind(),
        "invalidArguments"
    );
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn delete_block_removes_the_text_file_but_keeps_an_images_asset() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let text_block = call(
        &context,
        "deleteBlock",
        block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({})),
    )
    .ok();
    assert_eq!(text_block["contentFileRemoved"], true);
    assert!(!overview_file(&root, "blocks/markdown-1.md").exists());
    let image_block = call(
        &context,
        "deleteBlock",
        block_arguments(IMAGE_BLOCK_ID, json!({})),
    )
    .ok();
    assert_eq!(image_block["contentFileRemoved"], false);
    assert!(document_dir(&root).join("assets/pixel.png").is_file());

    let sheet = call(&context, "getSheet", overview_ids()).ok();
    assert_eq!(sheet["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(sheet["blocks"][0]["blockId"], MERMAID_BLOCK_ID);
    assert_eq!(
        call(
            &context,
            "deleteBlock",
            block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({}))
        )
        .error_kind(),
        "entityNotFound"
    );
    // The image's file stays in `assets/` unreferenced, exactly as after deleting an image
    // Block in the app; the loader does not report unused assets.
    let loaded = load_project(&root).unwrap();
    assert!(loaded.snapshot.issues.is_empty());
}

// ---- hostile input ----

const HOSTILE_IDS: [&str; 9] = [
    "",
    "..",
    "../../etc/passwd",
    "/etc/passwd",
    "C:\\Windows\\System32",
    "documents/system-design",
    "01928F3A-6C7D-7E8F-A012-3456789ABCDE",
    "01928f3a-6c7d-7e8f-a012-3456789abcde/../x",
    "01928f3a-6c7d-7e8f-a012-3456789abcde\0",
];

#[test]
fn path_like_and_malformed_ids_are_refused_by_every_tool_and_touch_nothing() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let before = tree_snapshot(&root);
    let hash = "0".repeat(64);
    for hostile in HOSTILE_IDS {
        let calls = [
            ("getDocument", json!({ "documentId": hostile })),
            (
                "getSheet",
                json!({ "documentId": hostile, "sheetId": OVERVIEW_SHEET_ID }),
            ),
            (
                "getSheet",
                json!({ "documentId": DOCUMENT_ID, "sheetId": hostile }),
            ),
            ("getBlock", block_arguments(hostile, json!({}))),
            (
                "createDocument",
                json!({ "name": "X", "folderId": hostile }),
            ),
            ("createSheet", json!({ "documentId": hostile, "name": "X" })),
            (
                "createBlock",
                with(
                    json!({ "documentId": DOCUMENT_ID, "sheetId": hostile }),
                    json!({ "type": "markdown", "text": "x" }),
                ),
            ),
            (
                "updateDocument",
                json!({ "documentId": hostile, "name": "X" }),
            ),
            (
                "updateSheet",
                json!({ "documentId": DOCUMENT_ID, "sheetId": hostile, "name": "X" }),
            ),
            (
                "updateBlock",
                block_arguments(hostile, json!({ "text": "x", "expectedContentHash": hash })),
            ),
            (
                "moveBlock",
                block_arguments(hostile, json!({ "position": { "x": 0, "y": 0 } })),
            ),
            ("deleteBlock", block_arguments(hostile, json!({}))),
        ];
        for (name, arguments) in calls {
            let reply = call(&context, name, arguments);
            assert!(reply.is_error, "{name} accepted {hostile:?}");
            assert_eq!(reply.error_kind(), "invalidEntityId", "{name} {hostile:?}");
        }
    }
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn well_formed_but_unknown_ids_are_not_found() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    assert_eq!(
        call(&context, "getDocument", json!({ "documentId": UNKNOWN_ID })).error_kind(),
        "entityNotFound"
    );
    assert_eq!(
        call(
            &context,
            "getSheet",
            json!({ "documentId": DOCUMENT_ID, "sheetId": UNKNOWN_ID })
        )
        .error_kind(),
        "entityNotFound"
    );
    assert_eq!(
        call(&context, "getBlock", block_arguments(UNKNOWN_ID, json!({}))).error_kind(),
        "entityNotFound"
    );
}

#[test]
fn wrong_argument_shapes_and_unknown_arguments_are_refused() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    for (name, arguments) in [
        ("getDocument", json!({})),
        ("getDocument", json!({ "documentId": 5 })),
        (
            "getDocument",
            json!({ "documentId": DOCUMENT_ID, "extra": 1 }),
        ),
        ("getProject", json!({ "documentId": DOCUMENT_ID })),
        ("createDocument", json!({ "name": ["a"] })),
        (
            "createBlock",
            with(overview_ids(), json!({ "type": "markdown" })),
        ),
        (
            "createBlock",
            with(
                overview_ids(),
                json!({ "type": "markdown", "text": "x", "position": { "x": 1 } }),
            ),
        ),
        (
            "createBlock",
            with(
                overview_ids(),
                json!({ "type": "markdown", "text": "x", "position": { "x": 1, "y": 2, "z": 3 } }),
            ),
        ),
    ] {
        assert_eq!(
            call(&context, name, arguments.clone()).error_kind(),
            "invalidArguments",
            "{name} {arguments}"
        );
    }
}

// ---- safety properties ----

#[test]
fn no_output_contains_an_absolute_path_even_for_failures() {
    let (temp, root) = project_copy();
    let context = context_for(&root, true);
    let hash = "0".repeat(64);
    let mut outputs = Vec::new();
    let mut record = |reply: Reply| outputs.push(reply.value.to_string());
    record(call(&context, "getProject", json!({})));
    record(call(
        &context,
        "getDocument",
        json!({ "documentId": DOCUMENT_ID }),
    ));
    record(call(&context, "getSheet", overview_ids()));
    for block in [
        OVERVIEW_MARKDOWN_BLOCK_ID,
        MERMAID_BLOCK_ID,
        IMAGE_BLOCK_ID,
        UNKNOWN_ID,
    ] {
        record(call(
            &context,
            "getBlock",
            block_arguments(block, json!({})),
        ));
    }
    record(call(&context, "createDocument", json!({ "name": "A" })));
    record(call(
        &context,
        "createSheet",
        json!({ "documentId": DOCUMENT_ID, "name": "S" }),
    ));
    record(call(
        &context,
        "createBlock",
        with(overview_ids(), json!({ "type": "markdown", "text": "t" })),
    ));
    record(call(
        &context,
        "updateBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "text": "t", "expectedContentHash": hash }),
        ),
    ));
    record(call(
        &context,
        "moveBlock",
        block_arguments(UNKNOWN_ID, json!({ "position": { "x": 0, "y": 0 } })),
    ));
    record(call(
        &context,
        "deleteBlock",
        block_arguments(IMAGE_BLOCK_ID, json!({})),
    ));
    // Failures that come from the file system layer.
    fs::remove_file(overview_file(&root, "blocks/mermaid-1.mmd")).unwrap();
    record(call(
        &context,
        "getBlock",
        block_arguments(MERMAID_BLOCK_ID, json!({})),
    ));
    record(call(
        &context,
        "getDocument",
        json!({ "documentId": "../../x" }),
    ));

    let temp_directory = temp.path().to_string_lossy().into_owned();
    let root_text = root.to_string_lossy().into_owned();
    let parent = std::env::temp_dir().to_string_lossy().into_owned();
    for output in &outputs {
        for forbidden in [&temp_directory, &root_text, &parent] {
            assert!(!output.contains(forbidden.as_str()), "{output}");
        }
    }
}

#[test]
fn a_project_that_is_replaced_under_the_server_is_refused() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    replace_in_file(
        &root.join("project.json"),
        PROJECT_ID,
        "01928f3a-0000-7000-8000-00000000abcd",
    );
    assert_eq!(
        call(&context, "getProject", json!({})).error_kind(),
        "projectChanged"
    );
    assert_eq!(
        call(&context, "createDocument", json!({ "name": "X" })).error_kind(),
        "projectChanged"
    );
}

#[test]
fn a_folder_that_is_not_a_project_cannot_be_added() {
    let temp = TempDir::new();
    let config = TempDir::new();
    let context = ToolContext::new(config.path());
    for folder in [temp.path().to_path_buf(), temp.path().join("missing")] {
        let refused = call(
            &context,
            "addProject",
            json!({ "folder": folder.to_string_lossy() }),
        );
        assert_eq!(refused.value["error"]["kind"], "notAProject");
        assert!(refused.value["error"]["message"]
            .as_str()
            .unwrap()
            .contains("project.json"));
    }
    assert_eq!(
        call(
            &context,
            "addProject",
            json!({ "folder": "relative/project" })
        )
        .error_kind(),
        "invalidArguments"
    );
    assert!(!config.path().join("ai-access.json").exists());
}

#[test]
fn a_block_whose_text_file_is_missing_is_reported_without_a_path() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    fs::remove_file(overview_file(&root, "blocks/markdown-1.md")).unwrap();
    let kind = call(
        &context,
        "getBlock",
        block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({})),
    )
    .error_kind();
    assert_eq!(kind, "fileNotFound");
}

#[test]
fn a_text_file_over_the_limit_is_not_read() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    write_text(
        &overview_file(&root, "blocks/markdown-1.md"),
        &"x".repeat(TEXT_LIMIT_PLUS_ONE),
    );
    let kind = call(
        &context,
        "getBlock",
        block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({})),
    )
    .error_kind();
    assert_eq!(kind, "contentTooLarge");
}

#[test]
fn a_whole_authoring_session_leaves_a_project_the_loader_reads_without_issues() {
    let (_temp, root) = folders_project_copy();
    let context = context_for(&root, true);
    let document = call(
        &context,
        "createDocument",
        json!({ "name": "Design", "folderId": ARCHIVE_FOLDER_ID }),
    )
    .ok();
    let document_id = document["documentId"].as_str().unwrap();
    let sheet = call(
        &context,
        "createSheet",
        json!({ "documentId": document_id, "name": "Main" }),
    )
    .ok();
    let ids = json!({ "documentId": document_id, "sheetId": sheet["sheetId"] });
    let first = call(
        &context,
        "createBlock",
        with(ids.clone(), json!({ "type": "markdown", "text": "# A" })),
    )
    .ok();
    let second = call(
        &context,
        "createBlock",
        with(
            ids.clone(),
            json!({ "type": "mermaid", "text": "flowchart TD\n  A --> B" }),
        ),
    )
    .ok();
    call(
        &context,
        "moveBlock",
        with(
            ids.clone(),
            json!({ "blockId": first["blockId"], "position": { "x": 40, "y": 40 } }),
        ),
    )
    .ok();
    call(&context, "updateBlock", with(ids.clone(), json!({ "blockId": first["blockId"], "text": "# B", "expectedContentHash": first["contentHash"] }))).ok();
    call(
        &context,
        "deleteBlock",
        with(ids.clone(), json!({ "blockId": second["blockId"] })),
    )
    .ok();
    call(
        &context,
        "updateSheet",
        with(ids, json!({ "name": "Main sheet" })),
    )
    .ok();
    assert_loads_without_issues(&root);
}

// ---- which Project: the app's AI access list ----

/// The app's AI access list in a temporary settings folder: `projects` in the order the app
/// used them (the last one is open in the app), with their write permission.
fn app_list(config_dir: &Path, projects: &[(&str, &Path, bool)]) {
    let mut list = AiAccessList::default();
    for (project_id, folder, _) in projects {
        list.add(ProjectId::parse(project_id).unwrap(), folder);
        list.record_used(ProjectId::parse(project_id).unwrap(), folder);
    }
    for (project_id, _, allow_write) in projects {
        list.set_allow_write(&ProjectId::parse(project_id).unwrap(), *allow_write)
            .unwrap();
    }
    list.write(config_dir).unwrap();
}

#[test]
fn following_the_app_uses_the_project_open_in_the_app() {
    let (_first_temp, sample) = project_copy();
    let (_second_temp, folders) = folders_project_copy();
    let config = TempDir::new();
    app_list(
        config.path(),
        &[
            (PROJECT_ID, &sample, false),
            (FOLDERS_PROJECT_ID, &folders, false),
        ],
    );
    let context = ToolContext::new(config.path());

    assert_eq!(tool_names(&context), all_tools());
    assert!(context.instructions().contains("listProjects"));

    // The Project used last in the app.
    let project = call(&context, "getProject", json!({})).ok();
    assert_eq!(project["projectId"], FOLDERS_PROJECT_ID);
    assert_eq!(project["writable"], false);

    let listed = call(&context, "listProjects", json!({})).ok();
    let projects = listed["projects"].as_array().unwrap();
    assert_eq!(projects.len(), 2);
    assert_eq!(projects[0]["projectId"], FOLDERS_PROJECT_ID);
    assert_eq!(projects[0]["lastUsedInApp"], true);
    assert_eq!(projects[0]["inUse"], true);
    assert_eq!(projects[1]["available"], true);
    assert!(projects[1]["name"].is_string());
    // No path reaches the AI: only the folder's own name.
    assert!(!listed.to_string().contains(sample.to_str().unwrap()));
}

#[test]
fn the_ai_chooses_another_listed_project_and_can_follow_the_app_again() {
    let (_first_temp, sample) = project_copy();
    let (_second_temp, folders) = folders_project_copy();
    let config = TempDir::new();
    app_list(
        config.path(),
        &[
            (PROJECT_ID, &sample, false),
            (FOLDERS_PROJECT_ID, &folders, false),
        ],
    );
    let context = ToolContext::new(config.path());

    let selected = call(
        &context,
        "selectProject",
        json!({ "projectId": PROJECT_ID }),
    )
    .ok();
    assert_eq!(selected["followsApp"], false);
    assert_eq!(
        call(&context, "getProject", json!({})).ok()["projectId"],
        PROJECT_ID
    );
    assert_eq!(
        call(&context, "listProjects", json!({})).ok()["selectedProjectId"],
        PROJECT_ID
    );

    // An unlisted or malformed id is refused and the choice stays.
    assert_eq!(
        call(
            &context,
            "selectProject",
            json!({ "projectId": UNKNOWN_ID })
        )
        .error_kind(),
        "projectNotListed"
    );
    assert_eq!(
        call(&context, "selectProject", json!({ "projectId": "../x" })).error_kind(),
        "invalidEntityId"
    );
    assert_eq!(
        call(&context, "getProject", json!({})).ok()["projectId"],
        PROJECT_ID
    );

    call(&context, "selectProject", json!({})).ok();
    assert_eq!(
        call(&context, "getProject", json!({})).ok()["projectId"],
        FOLDERS_PROJECT_ID
    );
}

#[test]
fn writes_follow_the_permission_the_user_set_in_the_app_at_each_call() {
    let (_temp, root) = project_copy();
    let config = TempDir::new();
    app_list(config.path(), &[(PROJECT_ID, &root, false)]);
    let context = ToolContext::new(config.path());
    let before = tree_snapshot(&root);
    let create = json!({ "documentId": DOCUMENT_ID, "name": "From AI" });
    assert_eq!(
        call(&context, "createSheet", create.clone()).error_kind(),
        "writeDisabled"
    );
    assert_eq!(tree_snapshot(&root), before);

    // Allowed in the app while the session runs: the next call may write.
    app_list(config.path(), &[(PROJECT_ID, &root, true)]);
    call(&context, "createSheet", create).ok();
    assert_eq!(
        call(&context, "getProject", json!({})).ok()["writable"],
        true
    );
    assert_loads_without_issues(&root);
}

#[test]
fn following_the_app_before_it_opened_anything_or_after_a_project_moved_explains_itself() {
    let config = TempDir::new();
    let context = ToolContext::new(config.path());
    assert_eq!(
        call(&context, "getProject", json!({})).error_kind(),
        "noProject"
    );
    assert!(call(&context, "listProjects", json!({})).ok()["projects"]
        .as_array()
        .unwrap()
        .is_empty());

    let (temp, root) = project_copy();
    app_list(config.path(), &[(PROJECT_ID, &root, true)]);
    drop(temp);
    let listed = call(&context, "listProjects", json!({})).ok();
    assert_eq!(listed["projects"][0]["available"], false);
    assert!(call(&context, "getProject", json!({})).is_error);

    fs::write(config.path().join("ai-access.json"), "not json").unwrap();
    assert_eq!(
        call(&context, "getProject", json!({})).error_kind(),
        "accessListUnreadable"
    );
}

// ---- captions ----

fn caption_arguments(block_id: &str, extra: Value) -> Value {
    with(block_arguments(block_id, json!({})), extra)
}

fn sheet_block(context: &ToolContext, block_id: &str) -> Value {
    let sheet = call(context, "getSheet", overview_ids()).ok();
    sheet["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|block| block["blockId"] == block_id)
        .cloned()
        .expect("the block is on the sheet")
}

#[test]
fn a_figure_gets_a_caption_that_reads_back_and_loads() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let set = call(
        &context,
        "updateBlockCaption",
        caption_arguments(MERMAID_BLOCK_ID, json!({ "caption": "Figure 1: the flow" })),
    )
    .ok();
    assert_eq!(set["caption"], "Figure 1: the flow");
    assert_eq!(set["captionPosition"], "below");

    // The position changes alone when the text is given again; "below" is not written.
    call(
        &context,
        "updateBlockCaption",
        caption_arguments(
            MERMAID_BLOCK_ID,
            json!({ "caption": "Figure 1: the flow", "position": "above" }),
        ),
    )
    .ok();
    let block = sheet_block(&context, MERMAID_BLOCK_ID);
    assert_eq!(block["captionPosition"], "above");
    let image = call(
        &context,
        "getBlock",
        block_arguments(IMAGE_BLOCK_ID, json!({})),
    )
    .ok();
    assert!(image.get("caption").is_none());
    assert_loads_without_issues(&root);
}

#[test]
fn an_empty_caption_removes_it_with_its_position() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    call(
        &context,
        "updateBlockCaption",
        caption_arguments(
            IMAGE_BLOCK_ID,
            json!({ "caption": "Logo", "position": "above" }),
        ),
    )
    .ok();
    call(
        &context,
        "updateBlockCaption",
        caption_arguments(IMAGE_BLOCK_ID, json!({ "caption": "" })),
    )
    .ok();
    let block = sheet_block(&context, IMAGE_BLOCK_ID);
    assert!(block.get("caption").is_none());
    assert!(block.get("captionPosition").is_none());
    let on_disk = read_text(&overview_file(&root, "sheet.json"));
    assert!(!on_disk.contains("caption"), "{on_disk}");
}

#[test]
fn a_caption_is_refused_on_text_blocks_and_when_it_breaks_the_rules() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let before = tree_snapshot(&root);
    for (block_id, extra) in [
        (OVERVIEW_MARKDOWN_BLOCK_ID, json!({ "caption": "Text" })),
        (MERMAID_BLOCK_ID, json!({ "caption": "two\nlines" })),
        (MERMAID_BLOCK_ID, json!({ "caption": "x".repeat(501) })),
        (
            MERMAID_BLOCK_ID,
            json!({ "caption": "ok", "position": "left" }),
        ),
    ] {
        let kind = call(
            &context,
            "updateBlockCaption",
            caption_arguments(block_id, extra),
        )
        .error_kind();
        assert_eq!(kind, "invalidCaption");
    }
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn the_project_open_in_the_app_is_used_only_when_the_user_offered_it() {
    let (_temp, root) = project_copy();
    let (_folders_temp, folders) = folders_project_copy();
    let config = TempDir::new();
    let mut list = AiAccessList::default();
    list.add(ProjectId::parse(FOLDERS_PROJECT_ID).unwrap(), &folders);
    list.record_used(ProjectId::parse(PROJECT_ID).unwrap(), &root);
    list.write(config.path()).unwrap();
    let context = ToolContext::new(config.path());

    let refused = call(&context, "getProject", json!({}));
    assert!(refused.is_error);
    assert_eq!(refused.value["error"]["kind"], "projectNotListed");
    assert!(refused.value["error"]["message"]
        .as_str()
        .unwrap()
        .contains("open in Design Dawn is not offered"));
    // The offered one can still be chosen.
    call(
        &context,
        "selectProject",
        json!({ "projectId": FOLDERS_PROJECT_ID }),
    )
    .ok();
    assert_eq!(
        call(&context, "getProject", json!({})).ok()["projectId"],
        FOLDERS_PROJECT_ID
    );
}

// ---- offering Projects and allowing changes from the AI client ----

#[test]
fn add_project_offers_a_project_read_only_and_keeps_it_in_the_history() {
    let (_temp, root) = project_copy();
    let config = TempDir::new();
    let context = ToolContext::new(config.path());
    let added = call(
        &context,
        "addProject",
        json!({ "folder": root.to_string_lossy() }),
    )
    .ok();
    assert_eq!(added["projectId"], PROJECT_ID);
    assert_eq!(added["added"], true);
    assert_eq!(added["writable"], false);
    // The app's list has it, as if it was added on the AI integration screen.
    let list = AiAccessList::read(config.path()).unwrap();
    assert!(list.find(&ProjectId::parse(PROJECT_ID).unwrap()).is_some());
    // No path reaches the AI.
    assert!(!added.to_string().contains(root.to_str().unwrap()));

    // Again: nothing changes.
    let again = call(
        &context,
        "addProject",
        json!({ "folder": root.to_string_lossy() }),
    )
    .ok();
    assert_eq!(again["added"], false);
    let history = design_dawn_lib::application::local_state::ai_history::read(
        config.path(),
        &ProjectId::parse(PROJECT_ID).unwrap(),
    );
    // Only the call that added it: the second changed nothing.
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].tool, "addProject");

    // Chosen, it reads; it is read-only until changes are allowed.
    call(
        &context,
        "selectProject",
        json!({ "projectId": PROJECT_ID }),
    )
    .ok();
    assert_eq!(
        call(&context, "getProject", json!({})).ok()["writable"],
        false
    );
}

#[test]
fn set_write_access_allows_and_stops_changes_and_keeps_them_in_the_history() {
    let (_temp, root) = project_copy();
    let config = TempDir::new();
    app_list(config.path(), &[(PROJECT_ID, &root, false)]);
    let context = ToolContext::new(config.path());
    let create = json!({ "documentId": DOCUMENT_ID, "name": "From AI" });
    let refused = call(&context, "createSheet", create.clone());
    assert!(refused.value["error"]["message"]
        .as_str()
        .unwrap()
        .contains("setWriteAccess"));

    let allowed = call(&context, "setWriteAccess", json!({ "writable": true })).ok();
    assert_eq!(allowed["projectId"], PROJECT_ID);
    assert_eq!(allowed["writable"], true);
    assert!(
        AiAccessList::read(config.path())
            .unwrap()
            .find(&ProjectId::parse(PROJECT_ID).unwrap())
            .unwrap()
            .allow_write
    );
    call(&context, "createSheet", create.clone()).ok();

    call(
        &context,
        "setWriteAccess",
        json!({ "writable": false, "projectId": PROJECT_ID }),
    )
    .ok();
    assert_eq!(
        call(&context, "createSheet", create).error_kind(),
        "writeDisabled"
    );
    let tools: Vec<String> = design_dawn_lib::application::local_state::ai_history::read(
        config.path(),
        &ProjectId::parse(PROJECT_ID).unwrap(),
    )
    .into_iter()
    // Newest first.
    .map(|entry| {
        format!(
            "{} {}>{}",
            entry.tool,
            entry.before.unwrap_or_default(),
            entry.after.unwrap_or_default()
        )
    })
    .collect();
    assert_eq!(
        tools,
        [
            "setWriteAccess true>false",
            "createSheet >",
            "setWriteAccess false>true"
        ]
    );
    // Asking for what it is already changes nothing and is not kept.
    let same = call(
        &context,
        "setWriteAccess",
        json!({ "writable": false, "projectId": PROJECT_ID }),
    )
    .ok();
    assert_eq!(same["changed"], false);
    assert_eq!(
        design_dawn_lib::application::local_state::ai_history::read(
            config.path(),
            &ProjectId::parse(PROJECT_ID).unwrap(),
        )
        .len(),
        3
    );
    assert_loads_without_issues(&root);
}

#[test]
fn set_write_access_needs_an_offered_project_and_a_flag() {
    let (_temp, root) = project_copy();
    let config = TempDir::new();
    app_list(config.path(), &[(PROJECT_ID, &root, false)]);
    let context = ToolContext::new(config.path());
    assert_eq!(
        call(
            &context,
            "setWriteAccess",
            json!({ "writable": true, "projectId": FOLDERS_PROJECT_ID })
        )
        .error_kind(),
        "projectNotListed"
    );
    assert_eq!(
        call(&context, "setWriteAccess", json!({})).error_kind(),
        "invalidArguments"
    );
    // An unreadable list is left alone, not replaced.
    fs::write(config.path().join("ai-access.json"), "not json").unwrap();
    assert_eq!(
        call(
            &context,
            "setWriteAccess",
            json!({ "writable": true, "projectId": PROJECT_ID })
        )
        .error_kind(),
        "accessListUnreadable"
    );
    assert_eq!(
        fs::read_to_string(config.path().join("ai-access.json")).unwrap(),
        "not json"
    );
}

#[test]
fn a_text_of_exactly_the_limit_is_written_and_read_back() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let limit_text = "x".repeat(TEXT_LIMIT_PLUS_ONE - 1);
    let created = call(
        &context,
        "createBlock",
        with(
            overview_ids(),
            json!({ "type": "markdown", "text": limit_text }),
        ),
    )
    .ok();
    let block_id = created["blockId"].as_str().unwrap().to_owned();
    let read = call(&context, "getBlock", block_arguments(&block_id, json!({}))).ok();
    assert_eq!(
        read["text"].as_str().unwrap().len(),
        TEXT_LIMIT_PLUS_ONE - 1
    );

    // Replacing it with another text of the limit is accepted as well.
    let replaced = call(
        &context,
        "updateBlock",
        block_arguments(
            &block_id,
            json!({ "text": "y".repeat(TEXT_LIMIT_PLUS_ONE - 1), "expectedContentHash": read["contentHash"] }),
        ),
    )
    .ok();
    assert_eq!(replaced["written"], true);
    assert_loads_without_issues(&root);
}

#[test]
fn a_write_by_a_server_following_the_app_is_kept_in_the_ai_history() {
    let (_temp, sample) = project_copy();
    let config = TempDir::new();
    app_list(config.path(), &[(PROJECT_ID, &sample, true)]);
    let context = ToolContext::new(config.path());
    call(
        &context,
        "selectProject",
        json!({ "projectId": PROJECT_ID }),
    )
    .ok();
    let before = call(
        &context,
        "getBlock",
        block_arguments(OVERVIEW_MARKDOWN_BLOCK_ID, json!({})),
    )
    .ok();
    let updated = call(
        &context,
        "updateBlock",
        block_arguments(
            OVERVIEW_MARKDOWN_BLOCK_ID,
            json!({ "text": "# New", "expectedContentHash": before["contentHash"] }),
        ),
    )
    .ok();
    let history = design_dawn_lib::application::local_state::ai_history::read(
        config.path(),
        &ProjectId::parse(PROJECT_ID).unwrap(),
    );
    assert_eq!(history.len(), 1);
    let entry = &history[0];
    assert_eq!(entry.tool, "updateBlock");
    assert_eq!(entry.block_id.as_deref(), Some(OVERVIEW_MARKDOWN_BLOCK_ID));
    assert_eq!(entry.before.as_deref(), before["text"].as_str());
    assert_eq!(entry.after.as_deref(), Some("# New"));
    assert_eq!(entry.after_hash.as_deref(), updated["contentHash"].as_str());
}

#[test]
fn import_image_adds_an_image_block_with_the_file_copied_into_the_document() {
    let (temp, sample) = project_copy();
    let context = context_for(&sample, true);
    let outside = temp.path().join("photo.png");
    fs::copy(document_dir(&sample).join("assets/pixel.png"), &outside).unwrap();
    let added = call(
        &context,
        "importImage",
        with(
            overview_ids(),
            json!({
                "path": outside.to_str().unwrap(),
                "position": { "x": 5, "y": 6 },
                "caption": "A photo",
            }),
        ),
    )
    .ok();
    assert_eq!(added["blockType"], "image");
    assert_eq!(added["position"]["x"], 5);
    assert_eq!(added["caption"], "A photo");
    let content_path = added["contentPath"].as_str().unwrap();
    assert!(document_dir(&sample).join(content_path).is_file());
    let block_id = added["blockId"].as_str().unwrap().to_owned();
    let sheet = call(&context, "getSheet", overview_ids()).ok();
    assert!(sheet["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|block| block["blockId"] == block_id.as_str()));
    // Kept in the AI history with the file it added.
    let history = design_dawn_lib::application::local_state::ai_history::read(
        &config_dir_beside(&sample),
        &ProjectId::parse(PROJECT_ID).unwrap(),
    );
    let entry = history.last().unwrap();
    assert_eq!(entry.tool, "importImage");
    assert_eq!(entry.block_id.as_deref(), Some(block_id.as_str()));
    assert_eq!(entry.after.as_deref(), Some(content_path));

    // The same file again uses the copy made the first time.
    let again = call(
        &context,
        "importImage",
        with(overview_ids(), json!({ "path": outside.to_str().unwrap() })),
    )
    .ok();
    assert_eq!(again["contentPath"], content_path);
    assert_loads_without_issues(&sample);
}

#[test]
fn import_image_refuses_what_is_not_an_image_file_and_a_read_only_project() {
    let (temp, sample) = project_copy();
    let context = context_for(&sample, true);
    let before = tree_snapshot(&sample);
    let text = temp.path().join("notes.txt");
    fs::write(&text, "x").unwrap();
    for path in [
        "relative.png".to_owned(),
        text.to_string_lossy().into_owned(),
        temp.path()
            .join("missing.png")
            .to_string_lossy()
            .into_owned(),
    ] {
        assert_eq!(
            call(
                &context,
                "importImage",
                with(overview_ids(), json!({ "path": path }))
            )
            .error_kind(),
            "invalidArguments"
        );
    }
    assert_eq!(tree_snapshot(&sample), before);
    let read_only = context_for(&sample, false);
    assert_eq!(
        call(
            &read_only,
            "importImage",
            with(overview_ids(), json!({ "path": text.to_string_lossy() }))
        )
        .error_kind(),
        "writeDisabled"
    );
}

/// A shared template written the way the app writes one (`application::templates`).
fn shared_sheet_template(root: &Path) -> String {
    use design_dawn_lib::application::templates::{
        save_template, TemplateBlockContent, TemplateContent, TemplateKind, TemplateRoots,
        TemplateScope, TemplateSheetContent,
    };
    let roots = TemplateRoots {
        shared: Some(root.join("templates")),
        project: None,
        global: root.join("no-global-templates"),
    };
    let text = |block_type: &str, text: &str, x: i64| TemplateBlockContent {
        block_type: block_type.to_owned(),
        x,
        y: 0,
        width: 320,
        height: 200,
        caption: None,
        caption_position: None,
        text: Some(text.to_owned()),
        asset: None,
    };
    let saved = save_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Sheet,
        &TemplateContent {
            name: "Review".to_owned(),
            block: None,
            sheets: vec![TemplateSheetContent {
                sheet_name: "Review".to_owned(),
                blocks: vec![
                    text("markdown", "# Review\n", 0),
                    text("mermaid", "flowchart LR\n  A --> B\n", 400),
                ],
            }],
            document_name: None,
            assets: Vec::new(),
        },
        &|_| unreachable!("no images"),
    )
    .unwrap();
    saved.template_id
}

#[test]
fn templates_are_listed_and_make_a_sheet_with_their_blocks() {
    let (_temp, root) = project_copy();
    let template_id = shared_sheet_template(&root);
    let context = context_for(&root, true);
    let listed = call(&context, "listTemplates", json!({})).ok();
    let shared: Vec<&Value> = listed["templates"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|template| template["scope"] == "shared")
        .collect();
    assert_eq!(shared.len(), 1);
    assert_eq!(shared[0]["name"], "Review");
    assert_eq!(shared[0]["kind"], "sheet");

    let made = call(
        &context,
        "createFromTemplate",
        json!({
            "scope": "shared",
            "kind": "sheet",
            "templateId": template_id,
            "documentId": DOCUMENT_ID,
            "name": "Review 1",
        }),
    )
    .ok();
    assert_eq!(made["blockIds"].as_array().unwrap().len(), 2);
    let sheet = call(
        &context,
        "getSheet",
        json!({ "documentId": DOCUMENT_ID, "sheetId": made["sheetId"] }),
    )
    .ok();
    assert_eq!(sheet["name"], "Review 1");
    assert_eq!(sheet["blocks"].as_array().unwrap().len(), 2);
    assert_loads_without_issues(&root);
}

#[test]
fn a_template_sheet_brings_its_images_and_reuses_an_identical_one() {
    use design_dawn_lib::application::templates::{
        save_template, TemplateBlockContent, TemplateContent, TemplateKind, TemplateRoots,
        TemplateScope, TemplateSheetContent,
    };
    let (_temp, root) = project_copy();
    let roots = TemplateRoots {
        shared: Some(root.join("templates")),
        project: None,
        global: root.join("no-global-templates"),
    };
    let picture = png_bytes(4, 3);
    let block =
        |block_type: &str, text: Option<&str>, asset: Option<&str>, x: i64| TemplateBlockContent {
            block_type: block_type.to_owned(),
            x,
            y: 0,
            width: 320,
            height: 200,
            caption: None,
            caption_position: None,
            text: text.map(str::to_owned),
            asset: asset.map(str::to_owned),
        };
    let saved = save_template(
        &roots,
        TemplateScope::Shared,
        TemplateKind::Sheet,
        &TemplateContent {
            name: "Pictured".to_owned(),
            block: None,
            sheets: vec![TemplateSheetContent {
                sheet_name: "Pictured".to_owned(),
                blocks: vec![
                    block(
                        "markdown",
                        Some("![p](../../../assets/pic.png) assets/pic.png"),
                        None,
                        0,
                    ),
                    block("image", None, Some("assets/pic.png"), 400),
                ],
            }],
            document_name: None,
            assets: vec!["assets/pic.png".to_owned()],
        },
        &|_| Ok(("pic.png".to_owned(), picture.clone())),
    )
    .unwrap();
    let context = context_for(&root, true);
    let make = || {
        call(
            &context,
            "createFromTemplate",
            json!({
                "scope": "shared",
                "kind": "sheet",
                "templateId": saved.template_id,
                "documentId": DOCUMENT_ID,
            }),
        )
        .ok()
    };
    let text_of = |made: &Value| {
        let block_id = made["blockIds"][0].clone();
        call(
            &context,
            "getBlock",
            json!({ "documentId": DOCUMENT_ID, "sheetId": made["sheetId"], "blockId": block_id }),
        )
        .ok()["text"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let assets = document_dir(&root).join("assets");

    let first = make();
    assert_eq!(first["blockIds"].as_array().unwrap().len(), 2);
    // The image block shows the copied image (read from the sheet's file: MCP does not
    // list contentPaths).
    let sheets = document_dir(&root).join("sheets");
    let shows_picture = fs::read_dir(&sheets).unwrap().any(|entry| {
        let file = entry.unwrap().path().join("sheet.json");
        fs::read_to_string(file)
            .map(|text| text.contains("\"contentPath\": \"assets/pic.png\""))
            .unwrap_or(false)
    });
    assert!(shows_picture);
    assert_eq!(fs::read(assets.join("pic.png")).unwrap(), picture);

    // The same image is already there: used as it is, nothing copied or rewritten.
    let second = make();
    assert!(!assets.join("pic-2.png").exists());
    assert_eq!(
        text_of(&second),
        "![p](../../../assets/pic.png) assets/pic.png"
    );

    // A different file has the name: the image comes under a free name, the texts follow.
    fs::write(assets.join("pic.png"), png_bytes(5, 5)).unwrap();
    let third = make();
    assert_eq!(fs::read(assets.join("pic-2.png")).unwrap(), picture);
    assert!(text_of(&third).contains("assets/pic-2.png"));
    assert_loads_without_issues(&root);
}

#[test]
fn a_block_larger_than_the_app_allows_is_refused() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let before = tree_snapshot(&root);
    let refused = call(
        &context,
        "createBlock",
        with(
            overview_ids(),
            json!({
                "type": "markdown",
                "text": "# Wide",
                "size": { "width": 100_000, "height": 200 },
            }),
        ),
    );
    assert_eq!(refused.error_kind(), "invalidSize");
    assert_eq!(tree_snapshot(&root), before);
    // The largest one allowed is made.
    call(
        &context,
        "createBlock",
        with(
            overview_ids(),
            json!({
                "type": "markdown",
                "text": "# Wide",
                "size": { "width": 10_000, "height": 10_000 },
            }),
        ),
    )
    .ok();
}
