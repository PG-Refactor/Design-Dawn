//! The stdio loop: one JSON-RPC message per line in, one line out per response. Only
//! protocol messages go to the output; anything else would corrupt the stream.

use std::io::{self, BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};

use serde_json::{Map, Value};

use super::config::MESSAGE_MAX_BYTES;
use super::protocol::{handle_message, message_too_large_response, ToolHost, ToolOutput};
use super::tool_error::{ToolError, KIND_INTERNAL};

#[derive(Debug, PartialEq, Eq)]
enum Line {
    Message(Vec<u8>),
    TooLong,
    EndOfInput,
}

/// Reads up to the next newline without ever holding more than `max_bytes`: a longer line is
/// consumed and reported as `TooLong`, so a client cannot make the server buffer without limit.
fn read_bounded_line(reader: &mut impl BufRead, max_bytes: usize) -> io::Result<Line> {
    let mut line = Vec::new();
    let mut too_long = false;
    let mut read_anything = false;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            break;
        }
        read_anything = true;
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let taken = newline.unwrap_or(buffer.len());
        if !too_long {
            if line.len() + taken > max_bytes {
                too_long = true;
                line.clear();
            } else {
                line.extend_from_slice(&buffer[..taken]);
            }
        }
        let consumed = newline.map_or(taken, |_| taken + 1);
        reader.consume(consumed);
        if newline.is_some() {
            break;
        }
    }
    Ok(match (read_anything, too_long) {
        (false, _) => Line::EndOfInput,
        (true, true) => Line::TooLong,
        (true, false) => Line::Message(line),
    })
}

/// A panic inside a tool must not end the session: the AI gets an error result and the
/// server keeps running. The panic message (which could name a path) is not forwarded.
pub fn call_tool_guarded(
    host: &dyn ToolHost,
    name: &str,
    arguments: &Map<String, Value>,
) -> Option<ToolOutput> {
    catch_unwind(AssertUnwindSafe(|| host.call_tool(name, arguments))).unwrap_or_else(|_| {
        Some(ToolOutput::failure(&ToolError::new(
            KIND_INTERNAL,
            "the tool failed unexpectedly",
        )))
    })
}

struct GuardedHost<'a>(&'a dyn ToolHost);

impl ToolHost for GuardedHost<'_> {
    fn instructions(&self) -> &'static str {
        self.0.instructions()
    }

    fn list_tools(&self) -> Vec<Value> {
        self.0.list_tools()
    }

    fn call_tool(&self, name: &str, arguments: &Map<String, Value>) -> Option<ToolOutput> {
        call_tool_guarded(self.0, name, arguments)
    }
}

/// Serves until the input ends. Write errors end the session (the client is gone).
pub fn serve(
    host: &dyn ToolHost,
    mut input: impl BufRead,
    mut output: impl Write,
) -> io::Result<()> {
    let host = GuardedHost(host);
    loop {
        let response = match read_bounded_line(&mut input, MESSAGE_MAX_BYTES)? {
            Line::EndOfInput => return Ok(()),
            Line::TooLong => Some(message_too_large_response()),
            Line::Message(bytes) if bytes.iter().all(u8::is_ascii_whitespace) => None,
            Line::Message(bytes) => handle_message(&host, &bytes),
        };
        if let Some(response) = response {
            writeln!(output, "{response}")?;
            output.flush()?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn reads_lines_and_a_final_line_without_newline() {
        let mut reader = Cursor::new(b"ab\ncd".to_vec());
        assert_eq!(
            read_bounded_line(&mut reader, 16).unwrap(),
            Line::Message(b"ab".to_vec())
        );
        assert_eq!(
            read_bounded_line(&mut reader, 16).unwrap(),
            Line::Message(b"cd".to_vec())
        );
        assert_eq!(
            read_bounded_line(&mut reader, 16).unwrap(),
            Line::EndOfInput
        );
    }

    #[test]
    fn a_line_over_the_limit_is_skipped_whole_and_the_next_line_is_intact() {
        let mut reader = Cursor::new(b"0123456789\nok\n".to_vec());
        assert_eq!(read_bounded_line(&mut reader, 4).unwrap(), Line::TooLong);
        assert_eq!(
            read_bounded_line(&mut reader, 4).unwrap(),
            Line::Message(b"ok".to_vec())
        );
    }

    #[test]
    fn a_line_of_exactly_the_limit_is_accepted() {
        let mut reader = Cursor::new(b"abcd\n".to_vec());
        assert_eq!(
            read_bounded_line(&mut reader, 4).unwrap(),
            Line::Message(b"abcd".to_vec())
        );
    }

    struct PanickingHost;

    impl ToolHost for PanickingHost {
        fn instructions(&self) -> &'static str {
            ""
        }

        fn list_tools(&self) -> Vec<Value> {
            Vec::new()
        }

        fn call_tool(&self, _: &str, _: &Map<String, Value>) -> Option<ToolOutput> {
            panic!("secret detail /home/user/project");
        }
    }

    #[test]
    fn a_panicking_tool_becomes_an_error_result_and_the_session_continues() {
        let input = concat!(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x"}}"#,
            "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#,
            "\n"
        );
        let mut output = Vec::new();
        serve(&PanickingHost, Cursor::new(input), &mut output).unwrap();
        let text = String::from_utf8(output).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"isError\":true"));
        assert!(!text.contains("secret detail"));
        assert!(lines[1].contains("\"id\":2"));
    }

    #[test]
    fn blank_lines_and_notifications_produce_no_output() {
        let input = "\n   \n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n";
        let mut output = Vec::new();
        serve(&PanickingHost, Cursor::new(input), &mut output).unwrap();
        assert!(output.is_empty());
    }
}
