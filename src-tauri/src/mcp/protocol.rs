//! JSON-RPC 2.0 and the MCP methods this server implements: `initialize`, `ping`,
//! `tools/list`, `tools/call`, and the `notifications/initialized` notification. Everything
//! else is a JSON-RPC "method not found". There are no resources, prompts or sampling.

use serde_json::{json, Map, Value};

use super::config::{
    SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION, SUPPORTED_PROTOCOL_VERSIONS,
};
use super::tool_error::ToolError;

const JSONRPC_VERSION: &str = "2.0";

pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;

const METHOD_INITIALIZE: &str = "initialize";
const METHOD_PING: &str = "ping";
const METHOD_TOOLS_LIST: &str = "tools/list";
const METHOD_TOOLS_CALL: &str = "tools/call";

/// What the protocol layer needs from the tools; it knows nothing about Projects.
pub trait ToolHost {
    fn list_tools(&self) -> Vec<Value>;
    /// `None` when no tool has this name (a JSON-RPC error); a tool that fails is `Some` with
    /// `is_error` set.
    fn call_tool(&self, name: &str, arguments: &Map<String, Value>) -> Option<ToolOutput>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutput {
    pub is_error: bool,
    pub value: Value,
}

impl ToolOutput {
    pub fn success(value: Value) -> Self {
        Self {
            is_error: false,
            value,
        }
    }

    pub fn failure(error: &ToolError) -> Self {
        Self {
            is_error: true,
            value: error.to_value(),
        }
    }

    fn to_result(&self) -> Value {
        json!({
            "content": [{ "type": "text", "text": self.value.to_string() }],
            "isError": self.is_error,
        })
    }
}

fn error_response(id: &Value, code: i64, message: &str) -> String {
    json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": id,
        "error": { "code": code, "message": message },
    })
    .to_string()
}

fn result_response(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": JSONRPC_VERSION, "id": id, "result": result }).to_string()
}

/// The answer to a line that is longer than `MESSAGE_MAX_BYTES`. Its `id` cannot be known.
pub fn message_too_large_response() -> String {
    error_response(&Value::Null, INVALID_REQUEST, "the message is too large")
}

/// An `id` is a string or a number (JSON-RPC 2.0); `null` is allowed by JSON-RPC but
/// refused by MCP.
fn is_valid_id(id: &Value) -> bool {
    id.is_string() || id.is_number()
}

fn negotiated_version(requested: &str) -> &'static str {
    SUPPORTED_PROTOCOL_VERSIONS
        .iter()
        .copied()
        .find(|supported| *supported == requested)
        .unwrap_or(SUPPORTED_PROTOCOL_VERSIONS[0])
}

fn initialize(params: Option<&Value>) -> Result<Value, (i64, &'static str)> {
    let requested = params
        .and_then(|params| params.get("protocolVersion"))
        .and_then(Value::as_str)
        .ok_or((INVALID_PARAMS, "protocolVersion is required"))?;
    Ok(json!({
        "protocolVersion": negotiated_version(requested),
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
        "instructions": SERVER_INSTRUCTIONS,
    }))
}

fn call_tool(host: &dyn ToolHost, params: Option<&Value>) -> Result<Value, (i64, &'static str)> {
    let params = params
        .and_then(Value::as_object)
        .ok_or((INVALID_PARAMS, "params must be an object"))?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((INVALID_PARAMS, "name is required"))?;
    let empty = Map::new();
    let arguments = match params.get("arguments") {
        None | Some(Value::Null) => &empty,
        Some(Value::Object(arguments)) => arguments,
        Some(_) => return Err((INVALID_PARAMS, "arguments must be an object")),
    };
    host.call_tool(name, arguments)
        .map(|output| output.to_result())
        .ok_or((INVALID_PARAMS, "unknown tool"))
}

/// Handles one message. `None` means nothing is sent back: notifications never get a
/// response, and neither do responses from the client (this server sends no requests).
pub fn handle_message(host: &dyn ToolHost, line: &[u8]) -> Option<String> {
    let Ok(message) = serde_json::from_slice::<Value>(line) else {
        return Some(error_response(&Value::Null, PARSE_ERROR, "invalid JSON"));
    };
    let Some(object) = message.as_object() else {
        // Batches were removed from MCP in 2025-06-18; one message per line is all we read.
        return Some(error_response(
            &Value::Null,
            INVALID_REQUEST,
            "a message must be a JSON object",
        ));
    };
    let id = object.get("id");
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        // A response to a request we never sent, or something that is not a message at all.
        return match id {
            Some(_) if object.contains_key("result") || object.contains_key("error") => None,
            _ => Some(error_response(
                id.filter(|id| is_valid_id(id)).unwrap_or(&Value::Null),
                INVALID_REQUEST,
                "method is required",
            )),
        };
    };
    // No `id`: a notification, which is never answered.
    let id = id?;
    if !is_valid_id(id) {
        return Some(error_response(
            &Value::Null,
            INVALID_REQUEST,
            "id must be a string or a number",
        ));
    }
    if object.get("jsonrpc").and_then(Value::as_str) != Some(JSONRPC_VERSION) {
        return Some(error_response(
            id,
            INVALID_REQUEST,
            "jsonrpc must be \"2.0\"",
        ));
    }
    let params = object.get("params");
    let outcome = match method {
        METHOD_INITIALIZE => initialize(params),
        METHOD_PING => Ok(json!({})),
        METHOD_TOOLS_LIST => Ok(json!({ "tools": host.list_tools() })),
        METHOD_TOOLS_CALL => call_tool(host, params),
        _ => Err((METHOD_NOT_FOUND, "method not found")),
    };
    Some(match outcome {
        Ok(result) => result_response(id, result),
        Err((code, message)) => error_response(id, code, message),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeHost;

    impl ToolHost for FakeHost {
        fn list_tools(&self) -> Vec<Value> {
            vec![json!({ "name": "echo" })]
        }

        fn call_tool(&self, name: &str, arguments: &Map<String, Value>) -> Option<ToolOutput> {
            match name {
                "echo" => Some(ToolOutput::success(Value::Object(arguments.clone()))),
                "fail" => Some(ToolOutput::failure(&ToolError::invalid_arguments("bad"))),
                _ => None,
            }
        }
    }

    fn send(message: &str) -> Option<Value> {
        handle_message(&FakeHost, message.as_bytes())
            .map(|response| serde_json::from_str(&response).expect("a response is JSON"))
    }

    fn error_code(response: &Value) -> i64 {
        response["error"]["code"].as_i64().expect("an error code")
    }

    #[test]
    fn initialize_answers_with_the_clients_version_when_supported() {
        for version in SUPPORTED_PROTOCOL_VERSIONS {
            let response = send(&format!(
                r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"{version}"}}}}"#
            ))
            .unwrap();
            assert_eq!(response["result"]["protocolVersion"], version);
            assert_eq!(response["result"]["serverInfo"]["name"], SERVER_NAME);
            assert_eq!(
                response["result"]["capabilities"]["tools"]["listChanged"],
                false
            );
        }
    }

    #[test]
    fn initialize_answers_with_the_latest_version_for_an_unknown_one() {
        let response = send(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#,
        )
        .unwrap();
        assert_eq!(
            response["result"]["protocolVersion"],
            SUPPORTED_PROTOCOL_VERSIONS[0]
        );
    }

    #[test]
    fn initialize_without_a_version_is_invalid_params() {
        let response =
            send(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#).unwrap();
        assert_eq!(error_code(&response), INVALID_PARAMS);
    }

    #[test]
    fn ids_are_echoed_as_sent() {
        for id in [r#"7"#, r#""abc""#, r#"0"#] {
            let response =
                send(&format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"ping"}}"#)).unwrap();
            assert_eq!(response["id"].to_string(), id);
            assert_eq!(response["result"], json!({}));
        }
    }

    #[test]
    fn unknown_method_is_method_not_found_with_the_id() {
        let response = send(r#"{"jsonrpc":"2.0","id":"x","method":"resources/list"}"#).unwrap();
        assert_eq!(error_code(&response), METHOD_NOT_FOUND);
        assert_eq!(response["id"], "x");
    }

    #[test]
    fn malformed_json_is_a_parse_error_with_a_null_id() {
        let response = send("{not json").unwrap();
        assert_eq!(error_code(&response), PARSE_ERROR);
        assert_eq!(response["id"], Value::Null);
        assert!(handle_message(&FakeHost, &[0xFF, 0xFE]).is_some());
    }

    #[test]
    fn notifications_get_no_response_even_when_unknown() {
        assert!(send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
        assert!(send(r#"{"jsonrpc":"2.0","method":"anything/at/all","params":{}}"#).is_none());
    }

    #[test]
    fn a_response_from_the_client_gets_no_response() {
        assert!(send(r#"{"jsonrpc":"2.0","id":3,"result":{}}"#).is_none());
    }

    #[test]
    fn requests_that_are_not_valid_are_invalid_request() {
        for message in [
            r#"[1,2]"#,
            r#"42"#,
            r#"{"jsonrpc":"2.0","id":1}"#,
            r#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}"#,
        ] {
            let response = send(message).unwrap();
            assert_eq!(error_code(&response), INVALID_REQUEST, "{message}");
        }
    }

    #[test]
    fn tools_list_returns_the_hosts_tools() {
        let response = send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).unwrap();
        assert_eq!(response["result"]["tools"][0]["name"], "echo");
    }

    #[test]
    fn tools_call_wraps_the_output_as_text_content() {
        let response = send(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"a":1}}}"#,
        )
        .unwrap();
        assert_eq!(response["result"]["isError"], false);
        let text = response["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(serde_json::from_str::<Value>(text).unwrap(), json!({"a":1}));
    }

    #[test]
    fn a_failing_tool_is_a_result_with_is_error_not_a_protocol_error() {
        let response =
            send(r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fail"}}"#)
                .unwrap();
        assert!(response.get("error").is_none());
        assert_eq!(response["result"]["isError"], true);
    }

    #[test]
    fn tools_call_with_a_bad_shape_or_unknown_tool_is_invalid_params() {
        for message in [
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nope"}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":[1]}}"#,
        ] {
            let response = send(message).unwrap();
            assert_eq!(error_code(&response), INVALID_PARAMS, "{message}");
        }
    }

    #[test]
    fn responses_are_single_lines() {
        let response = handle_message(
            &FakeHost,
            br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"t":"a\nb"}}}"#,
        )
        .unwrap();
        assert!(!response.contains('\n'));
    }
}
