//! The built `design-dawn-mcp` binary driven over stdio like an MCP client would, including
//! its exit codes and that nothing but protocol messages reaches stdout.

mod support;

use std::io::Write;
use std::process::{Command, Output, Stdio};

use serde_json::{json, Value};
use support::*;

const BINARY: &str = env!("CARGO_BIN_EXE_design-dawn-mcp");

fn run(arguments: &[&str], input: &[Value]) -> Output {
    let mut child = Command::new(BINARY)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start design-dawn-mcp");
    {
        let mut stdin = child.stdin.take().expect("stdin");
        for message in input {
            writeln!(stdin, "{message}").expect("write a message");
        }
        // Closing stdin is how a client ends the session.
    }
    child.wait_with_output().expect("wait for design-dawn-mcp")
}

fn responses(output: &Output) -> Vec<Value> {
    String::from_utf8(output.stdout.clone())
        .expect("stdout is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("every stdout line is a JSON message"))
        .collect()
}

fn request(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

fn tool_call(id: u64, name: &str, arguments: Value) -> Value {
    request(
        id,
        "tools/call",
        json!({ "name": name, "arguments": arguments }),
    )
}

fn tool_result(response: &Value) -> Value {
    let text = response["result"]["content"][0]["text"]
        .as_str()
        .expect("text content");
    serde_json::from_str(text).expect("the text is JSON")
}

fn handshake() -> Vec<Value> {
    vec![
        request(
            1,
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" },
            }),
        ),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    ]
}

#[test]
fn a_read_write_session_over_stdio() {
    let (_temp, root) = project_copy();
    let root_text = root.to_str().unwrap();
    let mut input = handshake();
    input.extend([
        request(2, "tools/list", json!({})),
        tool_call(3, "getProject", json!({})),
        tool_call(
            4,
            "createSheet",
            json!({ "documentId": DOCUMENT_ID, "name": "From AI" }),
        ),
        tool_call(5, "getDocument", json!({ "documentId": DOCUMENT_ID })),
        request(6, "ping", json!({})),
        request(7, "unknown/method", json!({})),
    ]);
    let output = run(&["--project", root_text, "--allow-write"], &input);

    assert!(output.status.success(), "{:?}", output.status);
    let replies = responses(&output);
    // The notification got no answer: ids 1..7 minus nothing, in order.
    let ids: Vec<u64> = replies
        .iter()
        .map(|reply| reply["id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids, [1, 2, 3, 4, 5, 6, 7]);
    assert_eq!(replies[0]["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(replies[1]["result"]["tools"].as_array().unwrap().len(), 13);
    assert_eq!(tool_result(&replies[2])["projectId"], PROJECT_ID);
    assert_eq!(replies[3]["result"]["isError"], false);
    assert_eq!(
        tool_result(&replies[4])["sheets"].as_array().unwrap().len(),
        3
    );
    assert_eq!(replies[5]["result"], json!({}));
    assert_eq!(replies[6]["error"]["code"], -32601);

    // The change is on disk, and neither stream carries the Project's location.
    let on_disk = read_text(&document_dir(&root).join("document.json"));
    assert!(on_disk.contains("sheetOrder"));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stdout.contains(root_text));
    assert!(!stderr.contains(root_text), "{stderr}");
}

#[test]
fn the_default_is_read_only() {
    let (_temp, root) = project_copy();
    let before = tree_snapshot(&root);
    let mut input = handshake();
    input.extend([
        request(2, "tools/list", json!({})),
        tool_call(3, "createDocument", json!({ "name": "Nope" })),
    ]);
    let output = run(&["--project", root.to_str().unwrap()], &input);

    let replies = responses(&output);
    assert_eq!(replies[1]["result"]["tools"].as_array().unwrap().len(), 4);
    assert_eq!(replies[2]["result"]["isError"], true);
    assert_eq!(tool_result(&replies[2])["error"]["kind"], "writeDisabled");
    assert_eq!(tree_snapshot(&root), before);
}

#[test]
fn bad_input_lines_get_errors_and_the_session_survives() {
    let (_temp, root) = project_copy();
    let mut child = Command::new(BINARY)
        .args(["--project", root.to_str().unwrap()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(b"this is not json\n\n[1]\n").unwrap();
        writeln!(stdin, "{}", request(9, "ping", json!({}))).unwrap();
    }
    let output = child.wait_with_output().unwrap();
    let replies = responses(&output);
    assert_eq!(replies.len(), 3);
    assert_eq!(replies[0]["error"]["code"], -32700);
    assert_eq!(replies[1]["error"]["code"], -32600);
    assert_eq!(replies[2]["id"], 9);
}

#[test]
fn bad_arguments_or_a_wrong_folder_fail_with_a_message_on_stderr() {
    // Following the app, writes are the app's choice per Project, not a switch.
    let output = run(&["--allow-write"], &[]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("--project"));

    let temp = TempDir::new();
    let output = run(&["--project", temp.path().to_str().unwrap()], &[]);
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
}

#[test]
fn without_a_project_it_serves_the_project_open_in_the_app() {
    let (_temp, root) = project_copy();
    let config = TempDir::new();
    let mut list = design_dawn_lib::application::local_state::ai_access::AiAccessList::default();
    let project_id = design_dawn_lib::domain::entity_id::ProjectId::parse(PROJECT_ID).unwrap();
    list.add(project_id, &root);
    list.record_used(project_id, &root);
    list.write(config.path()).unwrap();

    let mut input = handshake();
    input.extend([
        tool_call(2, "listProjects", json!({})),
        tool_call(3, "getProject", json!({})),
        tool_call(
            4,
            "createSheet",
            json!({ "documentId": DOCUMENT_ID, "name": "From AI" }),
        ),
    ]);
    let output = run(
        &["--app-config-dir", config.path().to_str().unwrap()],
        &input,
    );
    assert!(output.status.success(), "{:?}", output.status);
    let replies = responses(&output);
    assert!(replies[0]["result"]["instructions"]
        .as_str()
        .unwrap()
        .contains("selectProject"));
    assert_eq!(tool_result(&replies[1])["projects"][0]["inUse"], true);
    assert_eq!(tool_result(&replies[2])["projectId"], PROJECT_ID);
    // Read-only until the user allows it in the app.
    assert_eq!(replies[3]["result"]["isError"], true);
    assert_eq!(tool_result(&replies[3])["error"]["kind"], "writeDisabled");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains(root.to_str().unwrap()), "{stderr}");
}

#[test]
fn help_and_version_print_to_stdout_and_succeed() {
    let help = run(&["--help"], &[]);
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("--allow-write"));
    let version = run(&["--version"], &[]);
    assert!(String::from_utf8_lossy(&version.stdout).starts_with("design-dawn-mcp "));
}
