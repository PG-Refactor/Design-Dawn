//! Block text encoding rules (docs/file-format.md §9.2).

use crate::infrastructure::error::{PersistenceError, PersistenceErrorKind};
use crate::infrastructure::file_format::constants::{CRLF, LF, UTF8_BOM};

/// Strips a leading BOM and otherwise returns the text unchanged, so that reading and
/// writing back a file does not alter its content (CRLF is only normalized on write).
pub fn decode_text(bytes: &[u8]) -> Result<String, PersistenceError> {
    let without_bom = bytes.strip_prefix(&UTF8_BOM).unwrap_or(bytes);
    String::from_utf8(without_bom.to_vec()).map_err(|error| {
        PersistenceError::new(PersistenceErrorKind::InvalidEncoding, error.to_string())
    })
}

/// CRLF becomes LF so that files written on Windows do not show whole-file Git diffs.
/// Everything else, including the presence of a trailing newline, is kept as typed.
pub fn encode_text(text: &str) -> Vec<u8> {
    text.replace(CRLF, LF).into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_bom_and_keeps_crlf_on_read() {
        assert_eq!(decode_text(b"\xEF\xBB\xBFa\r\nb").unwrap(), "a\r\nb");
    }

    #[test]
    fn rejects_invalid_utf8() {
        let error = decode_text(&[0xFF, 0xFE, 0x41]).unwrap_err();
        assert_eq!(error.kind, PersistenceErrorKind::InvalidEncoding);
    }

    #[test]
    fn normalizes_crlf_but_keeps_missing_trailing_newline() {
        assert_eq!(encode_text("a\r\nb\r\nc"), b"a\nb\nc");
        assert_eq!(encode_text("lone\rcr"), b"lone\rcr");
    }
}
