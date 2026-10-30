// Syntax values of Mermaid 12.1.0's `sequenceDiagram` that the reader and the operations
// share. What is only needed to WRITE text lives in
// sequence-operation-config.ts.

export const SEQUENCE_HEADER_KEYWORD = "sequenceDiagram";
// Mermaid's default `maxTextSize`; the app does not change it (mermaid-config.ts).
export const SEQUENCE_MAX_SOURCE_LENGTH = 50000;
export const SEQUENCE_STATEMENT_SEPARATOR = ";";
export const SEQUENCE_COMMENT_MARK = "%";
export const SEQUENCE_HASH_COMMENT_MARK = "#";

// A participant id the editor reads: letters, digits and `_`. Mermaid accepts more (spaces,
// `-`, `.` ...), but those forms are where its lexer has corner cases, so a diagram that
// uses them is read-only (measured against Mermaid).
export const SEQUENCE_ID_PATTERN_SOURCE = "[\\p{L}\\p{N}_]+";

// Words that cannot be a participant id. Mermaid rejects the keywords in any letter case; the
// rest (`as`, `left`, `link` ...) are accepted by Mermaid in some places but would make the
// line ambiguous for a line-based reader, so they are refused too. Stored in lower case.
export const SEQUENCE_RESERVED_WORDS: ReadonlySet<string> = new Set(
  [
    "end",
    "loop",
    "opt",
    "alt",
    "else",
    "par",
    "par_over",
    "and",
    "critical",
    "option",
    "break",
    "rect",
    "box",
    "participant",
    "actor",
    "create",
    "destroy",
    "note",
    "over",
    "activate",
    "deactivate",
    "autonumber",
    "off",
    "title",
    "accTitle",
    "accDescr",
    "sequenceDiagram",
    "link",
    "links",
    "properties",
    "details",
    "left",
    "right",
    "of",
    "as",
    "wrap",
    "nowrap",
  ].map((word) => word.toLowerCase()),
);

export function isSequenceReservedWord(word: string): boolean {
  return SEQUENCE_RESERVED_WORDS.has(word.toLowerCase());
}

// The ten arrows the editor reads and writes. Longest first, so that a regular expression
// built from the list prefers `-->>` to `->`. The half arrows (`-|\`, `/|-` ...) and the
// central connection `()` of Mermaid 12.1.0 are not here: a diagram that has one is
// read-only in this version.
export const SEQUENCE_ARROWS = [
  "<<-->>",
  "<<->>",
  "-->>",
  "->>",
  "-->",
  "->",
  "--x",
  "-x",
  "--)",
  "-)",
] as const;
export type SequenceArrow = (typeof SEQUENCE_ARROWS)[number];

export function isSequenceArrow(token: string): token is SequenceArrow {
  return (SEQUENCE_ARROWS as readonly string[]).includes(token);
}

export const SEQUENCE_ACTIVATE_SIGN = "+";
export const SEQUENCE_DEACTIVATE_SIGN = "-";

export const SEQUENCE_PARTICIPANT_KINDS = ["participant", "actor"] as const;
export type SequenceParticipantKind =
  (typeof SEQUENCE_PARTICIPANT_KINDS)[number];

// Blocks that open with a keyword and close with `end`. `par_over` is listed before `par`
// so a pattern built from the list does not stop at the shorter keyword.
export const SEQUENCE_BLOCKS = [
  "loop",
  "opt",
  "alt",
  "par_over",
  "par",
  "critical",
  "break",
  "rect",
] as const;
export type SequenceBlock = (typeof SEQUENCE_BLOCKS)[number];

// A branch keyword and the blocks it may appear in directly.
export const SEQUENCE_BRANCHES = ["else", "and", "option"] as const;
export type SequenceBranch = (typeof SEQUENCE_BRANCHES)[number];
export const SEQUENCE_BRANCH_OWNERS: Readonly<
  Record<SequenceBranch, readonly SequenceBlock[]>
> = {
  else: ["alt"],
  and: ["par", "par_over"],
  option: ["critical"],
};
// The block whose text is a CSS colour: it is read, but its text is not edited.
export const SEQUENCE_COLOUR_BLOCK: SequenceBlock = "rect";

export const SEQUENCE_NOTE_PLACEMENTS = ["leftOf", "rightOf", "over"] as const;
export type SequenceNotePlacement = (typeof SEQUENCE_NOTE_PLACEMENTS)[number];
export const SEQUENCE_NOTE_PLACEMENT_WORDS: Readonly<
  Record<SequenceNotePlacement, string>
> = {
  leftOf: "left of",
  rightOf: "right of",
  over: "over",
};
export const SEQUENCE_NOTE_KEYWORD = "Note";
export const SEQUENCE_PARTICIPANT_ALIAS_WORD = "as";
export const SEQUENCE_AUTONUMBER_KEYWORD = "autonumber";
export const SEQUENCE_TITLE_KEYWORD = "title";
export const SEQUENCE_END_KEYWORD = "end";

const ARROW_ALTERNATIVES = SEQUENCE_ARROWS.map((arrow) =>
  arrow.replace(/[)]/g, "\\$&"),
).join("|");
const KEYWORD_ALTERNATIVES = (words: readonly string[]): string =>
  words.join("|");
const NUMBER_ARGUMENT = "(\\d+(?:\\.\\d{1,2})?|\\.\\d{1,2})";
const ID = `(${SEQUENCE_ID_PATTERN_SOURCE})`;

// One physical statement, already trimmed. All patterns are case-insensitive (Mermaid's
// lexer is) and carry the `d` flag so a token's offsets can be read from the match.
const FLAGS = "diu";
export const SEQUENCE_STATEMENT_PATTERNS = {
  participant: new RegExp(
    `^(create\\s+)?(${SEQUENCE_PARTICIPANT_KINDS.join("|")})\\s+${ID}(?:\\s+as\\s+(.+))?$`,
    FLAGS,
  ),
  destroy: new RegExp(`^destroy\\s+${ID}$`, FLAGS),
  activation: new RegExp(`^(activate|deactivate)\\s+${ID}$`, FLAGS),
  message: new RegExp(
    `^${ID}\\s*(${ARROW_ALTERNATIVES})\\s*([+-])?\\s*${ID}\\s*:\\s*(.*)$`,
    FLAGS,
  ),
  note: new RegExp(
    `^note\\s+(left of|right of|over)\\s+${ID}(?:\\s*,\\s*${ID})?\\s*:\\s*(.*)$`,
    FLAGS,
  ),
  blockStart: new RegExp(
    `^(${KEYWORD_ALTERNATIVES(SEQUENCE_BLOCKS)})(?:\\s+(.*))?$`,
    FLAGS,
  ),
  branch: new RegExp(
    `^(${KEYWORD_ALTERNATIVES(SEQUENCE_BRANCHES)})(?:\\s+(.*))?$`,
    FLAGS,
  ),
  blockEnd: new RegExp(`^${SEQUENCE_END_KEYWORD}$`, FLAGS),
  box: /^box\b/i,
  autonumber: new RegExp(
    `^autonumber(?:\\s+${NUMBER_ARGUMENT})?(?:\\s+${NUMBER_ARGUMENT})?$`,
    FLAGS,
  ),
  autonumberOff: /^autonumber\s+off$/i,
  title: new RegExp(`^title\\s+(.+)$`, FLAGS),
  titleColon: new RegExp(`^title:\\s+(.+)$`, FLAGS),
  linkLike: /^(links?|properties|details)\s/i,
  accessibility: /^acc(Title|Descr)/i,
  // The beginning of a declaration line: a `#` there is part of the id (see the reader).
  declarationStart: /^\s*(create\s+)?(participant|actor|destroy)\b/i,
} as const;

// Wrap prefixes Mermaid consumes from the start of a text or an alias.
export const SEQUENCE_WRAP_PREFIX_PATTERN = /^\s*:?(no)?wrap:/i;
export const SEQUENCE_DIRECTIVE_MARK = "%%{";
export const SEQUENCE_ENTITY_MASK_PATTERN = /#\w+;/g;
export const SEQUENCE_ENTITY_MASK_CHARACTER = "\u0001";
export const SEQUENCE_DEFAULT_AUTONUMBER_STEP = 1;
