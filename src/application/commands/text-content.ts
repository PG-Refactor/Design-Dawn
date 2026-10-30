// Rust normalizes CRLF to LF when it writes a text file, so
// application state must hold the normalized text to equal what ends up on disk.
const CRLF_PATTERN = /\r\n/g;
const LINE_FEED = "\n";

export function normalizeLineEndings(text: string): string {
  return text.replace(CRLF_PATTERN, LINE_FEED);
}
