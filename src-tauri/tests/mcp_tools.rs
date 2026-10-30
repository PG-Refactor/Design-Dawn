//! The MCP tools against temporary copies of the sample Projects:
//! every tool's success and refusals, the read-only mode, conflicts, hostile IDs, and that
//! what the tools write loads in the app's loader without Load Issues.

mod support;

use std::fs;
use std::path::Path;

use design_dawn_lib::application::document_operations::load_document;
use design_dawn_lib::application::project_operations::load_project;
use design_dawn_lib::application::session::ProjectSessions;
use design_dawn_lib::infrastructure::filesystem::hashing::sha256_hex;
use design_dawn_lib::mcp::protocol::ToolHost;
use design_dawn_lib::mcp::tools::ToolContext;
use serde_json::{json, Value};
use support::*;

const MERMAID_BLOCK_ID: &str = "01928f3a-a0b1-7c23-a456-789abcdef012";
const IMAGE_BLOCK_ID: &str = "01928f3a-9fa0-7b12-9345-6789abcdef01";
const READ_TOOLS: [&str; 4] = ["getProject", "getDocument", "getSheet", "getBlock"];
const WRITE_TOOLS: [&str; 8] = [
    "createDocument",
    "createSheet",
    "createBlock",
    "updateDocument",
    "updateSheet",
    "updateBlock",
    "moveBlock",
    "deleteBlock",
];
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

fn context_for(root: &Path, allow_write: bool) -> ToolContext {
    ToolContext::open(root, allow_write).expect("open the project")
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
fn read_only_mode_lists_only_the_read_tools_and_refuses_the_others() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, false);
    assert_eq!(tool_names(&context), READ_TOOLS);
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
fn write_mode_lists_every_tool_with_a_closed_input_schema() {
    let (_temp, root) = project_copy();
    let context = context_for(&root, true);
    let mut expected: Vec<&str> = READ_TOOLS.to_vec();
    expected.extend(WRITE_TOOLS);
    assert_eq!(tool_names(&context), expected);
    for tool in context.list_tools() {
        let schema = &tool["inputSchema"];
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        let writes = WRITE_TOOLS.contains(&tool["name"].as_str().unwrap());
        assert_eq!(tool["annotations"]["readOnlyHint"], !writes);
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
    // The hash is of the bytes on disk (CRLF stored as LF).
    let file = fs::read(overview_file(&root, "blocks/markdown-2.md")).unwrap();
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
    for size in [
        json!({"width": 0, "height": 10}),
        json!({"width": 10, "height": -1}),
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
fn a_folder_that_is_not_a_project_cannot_be_served() {
    let temp = TempDir::new();
    assert!(ToolContext::open(temp.path(), false).is_err());
    assert!(ToolContext::open(&temp.path().join("missing"), false).is_err());
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
