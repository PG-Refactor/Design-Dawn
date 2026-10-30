import type { SequenceArrow } from "./sequence-config";

// Values of the Tier 1 operations (docs/architecture.md §16.16.5). The reader's syntax
// values stay in sequence-config.ts; what is only needed to WRITE text lives here.

// Fallbacks for a source that gives no hint (no statement line to copy the indentation from,
// no line break to copy the line ending from).
export const SEQUENCE_DEFAULT_INDENT = "    ";
export const SEQUENCE_DEFAULT_LINE_ENDING = "\n";

// Ids the domain makes up are `P1`, `P2` ...: the first one nothing else uses.
export const SEQUENCE_GENERATED_ID_PREFIX = "P";
export const SEQUENCE_GENERATED_ID_FIRST_NUMBER = 1;
// An id a caller supplies. Narrower than what the reader accepts: ASCII only, so a new id can
// never meet the lexical corner cases of Mermaid's id rules.
export const SEQUENCE_NEW_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// The arrow a message the GUI adds starts with.
export const SEQUENCE_DEFAULT_ARROW: SequenceArrow = "->>";

// Text encoding (docs/architecture.md §16.16.6). `;` ends a statement and a `#` starts a
// comment, so both are written as entities that Mermaid decodes when it draws. A line break
// typed in the GUI is written as `<br/>` (messages and notes only).
export const SEQUENCE_ENCODED_CHARACTERS: Readonly<Record<string, string>> = {
  ";": "#59;",
  "#": "#35;",
};
export const SEQUENCE_ENCODE_PATTERN = /[#;]/g;
export const SEQUENCE_DECODE_PATTERN = /#59;|#35;|<br\/>/g;
export const SEQUENCE_SEMICOLON_ENTITY = "#59;";
export const SEQUENCE_HASH_ENTITY = "#35;";
export const SEQUENCE_LINE_BREAK_TAG = "<br/>";
export const SEQUENCE_GUI_LINE_BREAK = "\n";
export const SEQUENCE_SEMICOLON = ";";
export const SEQUENCE_HASH = "#";
// Entity-like text other than the two the editor writes: Mermaid decodes it when it draws,
// so the characters in a text field would not be what is drawn.
export const SEQUENCE_ENTITY_LIKE_PATTERN = /#\w+;/g;
export const SEQUENCE_DOUBLE_PERCENT = "%%";

// The text fields of a diagram and what each may hold.
export const SEQUENCE_TEXT_FIELDS = [
  "message",
  "note",
  "alias",
  "blockLabel",
  "title",
] as const;
export type SequenceTextField = (typeof SEQUENCE_TEXT_FIELDS)[number];
// Only messages and notes may hold a line break (`<br/>`); a trailing `%%` is part of their
// text and was measured as harmless, so only they may hold `%%`.
export const SEQUENCE_MULTILINE_FIELDS: ReadonlySet<SequenceTextField> =
  new Set(["message", "note"]);
export const SEQUENCE_PERCENT_FIELDS: ReadonlySet<SequenceTextField> = new Set([
  "message",
  "note",
]);
// A statement that gives its text no place to start (`loop`, `else`, an empty message) needs
// a blank in front of the text that is written.
export const SEQUENCE_TEXT_LEAD = " ";
export const SEQUENCE_ALIAS_LEAD = " as ";
export const SEQUENCE_MESSAGE_TEXT_LEAD = ": ";
export const SEQUENCE_MESSAGE_COLON = ":";
export const SEQUENCE_INLINE_SEPARATOR = "; ";
export const SEQUENCE_UNKNOWN_STATEMENT_INDEX = -1;
export const SEQUENCE_NOTE_ID_SEPARATOR = ",";

// Tier 2 (docs/architecture.md §16.16.9).
// The blocks the GUI can wrap statements in. `rect` takes a colour as its text and `par_over`
// is rare, so neither is offered; both are still read and kept.
export const SEQUENCE_WRAP_BLOCKS = [
  "loop",
  "opt",
  "alt",
  "par",
  "critical",
  "break",
] as const;
export type SequenceWrapBlock = (typeof SEQUENCE_WRAP_BLOCKS)[number];
// How a text is joined to the keyword of a block header or branch (`loop retry`).
export const SEQUENCE_KEYWORD_TEXT_SEPARATOR = " ";
// The indentation unit used when nothing in the file shows one.
export const SEQUENCE_TAB_INDENT = "\t";
export const SEQUENCE_COPY_COLON = ": ";
