// Syntax and policy values of the flowchart reader. Every one of them was measured against
// Mermaid 12.3.0; nothing here is a guess about newer
// versions. Values that the reader, the meaning and the editability all need live here so
// they cannot drift apart.

export const FLOWCHART_HEADER_KEYWORDS = ["flowchart", "graph"] as const;
export type FlowchartHeaderKeyword = (typeof FLOWCHART_HEADER_KEYWORDS)[number];

// Keywords the app's type detection maps to a flowchart but this reader does not edit
// (`flowchart-elk`): they are recognised as a flowchart and then refused as an unsupported
// header, so the user sees the line instead of "not a flowchart".
export const FLOWCHART_DETECTED_HEADER_KEYWORDS = [
  ...FLOWCHART_HEADER_KEYWORDS,
  "flowchart-elk",
] as const;

// `TD` is the same direction as `TB`; Mermaid normalises it in the header only.
export const FLOWCHART_DIRECTION_TOKENS = [
  "TB",
  "TD",
  "BT",
  "RL",
  "LR",
] as const;
export type FlowchartDirectionToken =
  (typeof FLOWCHART_DIRECTION_TOKENS)[number];
export type FlowchartDirection = "TB" | "BT" | "RL" | "LR";
export const FLOWCHART_DEFAULT_DIRECTION: FlowchartDirection = "TB";

export function normalizeFlowchartDirection(
  token: FlowchartDirectionToken,
): FlowchartDirection {
  return token === "TD" ? "TB" : token;
}

export const FLOWCHART_STATEMENT_SEPARATOR = ";";
export const FLOWCHART_AMPERSAND = "&";
export const FLOWCHART_COMMENT_MARK = "%%";
export const FLOWCHART_DIRECTIVE_MARK = "%%{";
export const FLOWCHART_CLASS_OPERATOR = ":::";
export const FLOWCHART_AT_BLOCK_OPEN = "@{";
export const FLOWCHART_EDGE_ID_MARK = "@";
export const FLOWCHART_STRING_QUOTE = '"';
export const FLOWCHART_MARKDOWN_QUOTE = "`";
export const FLOWCHART_PIPE = "|";
export const FLOWCHART_END_KEYWORD = "end";
export const FLOWCHART_SUBGRAPH_KEYWORD = "subgraph";
export const FLOWCHART_DIRECTION_KEYWORD = "direction";
export const FLOWCHART_CLASS_DEF_KEYWORD = "classDef";
export const FLOWCHART_CLASS_KEYWORD = "class";
export const FLOWCHART_STYLE_KEYWORD = "style";
export const FLOWCHART_LINK_STYLE_KEYWORD = "linkStyle";
export const FLOWCHART_CLICK_KEYWORD = "click";
export const FLOWCHART_ACC_TITLE_KEYWORD = "accTitle";
export const FLOWCHART_ACC_DESCR_KEYWORD = "accDescr";
export const FLOWCHART_LINK_STYLE_DEFAULT = "default";
export const FLOWCHART_CLICKABLE_CLASS = "clickable";
export const FLOWCHART_LINK_STYLE_FILL_PREFIX = "fill";
export const FLOWCHART_LINK_STYLE_FILL_DEFAULT = "fill:none";

// Limits. They equal Mermaid's own defaults (`maxEdges` 500, `maxTextSize` 50000);
// mermaid-config.ts leaves both at the default and they are secure keys that a diagram
// cannot raise, so a source inside these limits is never cut by Mermaid.
// `maxTextSize` is checked by render() on the raw text length and a longer text is drawn as
// an "exceeded" diagram that still counts as a success, so the limit is checked here too.
export const FLOWCHART_MAX_EDGES = 500;
export const FLOWCHART_MAX_SOURCE_LENGTH = 50000;
// Mermaid caps the length of an edge at this many dashes.
export const FLOWCHART_MAX_LINK_LENGTH = 10;

// Words that are not usable as a node id in any position (measured, FINDINGS 1). The list
// is conservative: a word on it makes the statement opaque rather than guessed. `default`,
// `direction`, `accTitle` ... are legal ids in Mermaid but look like statements, so they are
// refused too.
export const FLOWCHART_RESERVED_IDS: ReadonlySet<string> = new Set([
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "style",
  "class",
  "classDef",
  "linkStyle",
  "interpolate",
  "click",
  "call",
  "href",
  "default",
  "direction",
  "_self",
  "_blank",
  "_parent",
  "_top",
  "accTitle",
  "accDescr",
  "flowchart-elk",
  "swimlane-beta",
]);

// An id that BEGINS with one of these followed by a non-word character (`end-x`,
// `graph.a`) is a lexical error in Mermaid.
export const FLOWCHART_KEYWORD_PREFIXES: readonly string[] = [
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "style",
  "class",
  "classDef",
  "linkStyle",
  "interpolate",
  "click",
  "call",
  "href",
  "default",
  "direction",
  "accTitle",
  "accDescr",
];

// Conservative id alphabet (a deliberate restriction): ASCII letters, digits and `_`, plus the
// letters and numbers of Han, Hiragana, Katakana (with the long-vowel mark) and Hangul
// within the Basic Multilingual Plane (Mermaid rejects astral CJK). `-` and `.` are part of
// an id only between id characters. Everything else Mermaid accepts in an id (`!"#$%&'*+,/:?`
// and backtick, Cyrillic, Greek, accented Latin ...) makes the statement opaque.
export const FLOWCHART_ID_CHARACTER_SOURCE =
  "[A-Za-z0-9_]|ー|(?![\\u{10000}-\\u{10FFFF}])(?=[\\p{L}\\p{N}])[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]";
export const FLOWCHART_ID_PATTERN = new RegExp(
  `(?:${FLOWCHART_ID_CHARACTER_SOURCE})(?:(?:${FLOWCHART_ID_CHARACTER_SOURCE})|[-.](?=${FLOWCHART_ID_CHARACTER_SOURCE}))*`,
  "uy",
);
export const FLOWCHART_WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_]/u;
// Characters Mermaid takes as part of an id although the conservative alphabet does not:
// seeing one right after an id means "unsupported id", not "unrecognised text".
export const FLOWCHART_FOREIGN_ID_CHARACTER_PATTERN =
  /[!"#$%&'*+,/:?\\`]|[^\p{ASCII}]/u;

// Mermaid reads a single `x` or `o` that starts a token and is glued to a link as part of
// the link (`A --> x-->B` is a syntax error), so such a term is refused.
export const FLOWCHART_LINK_ADJACENT_ID_CHARACTERS = ["x", "o"] as const;
export const FLOWCHART_LINK_START_CHARACTERS = "-=.~";

export type FlowchartBracketShapeName =
  | "square"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "doublecircle"
  | "odd"
  | "diamond"
  | "hexagon"
  | "lean_right"
  | "lean_left"
  | "trapezoid"
  | "inv_trapezoid"
  | "ellipse";

export interface FlowchartBracketCloser {
  readonly text: string;
  readonly shape: FlowchartBracketShapeName;
}

export interface FlowchartBracketForm {
  readonly opener: string;
  readonly closers: readonly FlowchartBracketCloser[];
}

// Longest opener first, so `(((` is never read as `(`. The shape names are the db's own
// type names. `[/ /]` and `[/ \]` share an opener: the closer decides.
export const FLOWCHART_BRACKET_FORMS: readonly FlowchartBracketForm[] = [
  { opener: "(((", closers: [{ text: ")))", shape: "doublecircle" }] },
  { opener: "((", closers: [{ text: "))", shape: "circle" }] },
  { opener: "([", closers: [{ text: "])", shape: "stadium" }] },
  { opener: "(-", closers: [{ text: "-)", shape: "ellipse" }] },
  { opener: "(", closers: [{ text: ")", shape: "round" }] },
  { opener: "[[", closers: [{ text: "]]", shape: "subroutine" }] },
  { opener: "[(", closers: [{ text: ")]", shape: "cylinder" }] },
  {
    opener: "[/",
    closers: [
      { text: "/]", shape: "lean_right" },
      { text: "\\]", shape: "trapezoid" },
    ],
  },
  {
    opener: "[\\",
    closers: [
      { text: "\\]", shape: "lean_left" },
      { text: "/]", shape: "inv_trapezoid" },
    ],
  },
  { opener: "[", closers: [{ text: "]", shape: "square" }] },
  { opener: "{{", closers: [{ text: "}}", shape: "hexagon" }] },
  { opener: "{", closers: [{ text: "}", shape: "diamond" }] },
  { opener: ">", closers: [{ text: "]", shape: "odd" }] },
];
// `[|key:value|text]` (a node with properties) parses but is not read.
export const FLOWCHART_PROPS_SHAPE_OPENER = "[|";
// The ellipse parses but Mermaid 12.3.0 cannot draw it ("No such shape: ellipse"), so no
// later step may offer it.
export const FLOWCHART_UNDRAWABLE_SHAPES: readonly FlowchartBracketShapeName[] =
  ["ellipse"];

// What an unquoted label (node, pipe edge label, subgraph title) cannot contain: the
// characters above and the sequences that Mermaid lexes as a link (measured; the sequences
// are refused conservatively).
export const FLOWCHART_UNQUOTED_LABEL_FORBIDDEN_PATTERN =
  /["`|@()[\]{}]|->|--|==|-\./;
// Inline edge labels follow the same rule (`--` ends them).
export const FLOWCHART_INLINE_LABEL_FORBIDDEN_PATTERN =
  FLOWCHART_UNQUOTED_LABEL_FORBIDDEN_PATTERN;
/["`|@()[\]{}]|--|==|-\./;

// Link tokens (measured and read from the lexer). A link
// written whole (`-->`, `-.->`, `==>`, `~~~`) or the two halves of `-- text -->`.
export const FLOWCHART_FULL_LINK_PATTERN =
  /(?:~{3,}|[xo<]?={2,}[=xo>]|[xo<]?-?\.+-[xo>]?|[xo<]?-{2,}[-xo>])/y;
export const FLOWCHART_INLINE_LINK_START_PATTERN =
  /([xo<]?(?:--|==|-\.))(?=[ \t])/y;
export const FLOWCHART_INLINE_LINK_END_PATTERNS: Readonly<
  Record<string, RegExp>
> = {
  "--": /(?:[xo<]?-{2,}[-xo>])/y,
  "==": /(?:[xo<]?={2,}[=xo>])/y,
  "-.": /(?:[xo<]?-?\.+-[xo>]?)/y,
};

export type FlowchartLinkType =
  | "arrow_open"
  | "arrow_point"
  | "arrow_circle"
  | "arrow_cross"
  | "double_arrow_point"
  | "double_arrow_circle"
  | "double_arrow_cross";
export type FlowchartLinkStroke = "normal" | "thick" | "dotted" | "invisible";

// `A@{ shape: ..., label: "..." }`. These are the 147 names and aliases that parse AND draw
// in the app pipeline (measured against the bundled Mermaid version); legacy db names
// (`square`, `round`, `ellipse` ...) and capitalised names are not valid there.
export const FLOWCHART_KNOWN_SHAPE_NAMES: ReadonlySet<string> = new Set([
  "state",
  "choice",
  "note",
  "composite",
  "icon",
  "anchor",
  "rect",
  "proc",
  "process",
  "rectangle",
  "rounded",
  "event",
  "stadium",
  "terminal",
  "pill",
  "fr-rect",
  "subprocess",
  "subproc",
  "framed-rectangle",
  "subroutine",
  "cyl",
  "db",
  "database",
  "cylinder",
  "datastore",
  "data-store",
  "folder",
  "directory",
  "bucket",
  "console",
  "browser",
  "person",
  "circle",
  "circ",
  "bang",
  "cloud",
  "diam",
  "decision",
  "diamond",
  "question",
  "hex",
  "hexagon",
  "prepare",
  "lean-r",
  "lean-right",
  "in-out",
  "lean-l",
  "lean-left",
  "out-in",
  "trap-b",
  "priority",
  "trapezoid-bottom",
  "trapezoid",
  "trap-t",
  "manual",
  "trapezoid-top",
  "inv-trapezoid",
  "dbl-circ",
  "double-circle",
  "doublecircle",
  "text",
  "notch-rect",
  "card",
  "notched-rectangle",
  "lin-rect",
  "lined-rectangle",
  "lined-process",
  "lin-proc",
  "shaded-process",
  "sm-circ",
  "start",
  "small-circle",
  "fr-circ",
  "stop",
  "framed-circle",
  "fork",
  "join",
  "hourglass",
  "collate",
  "brace",
  "comment",
  "brace-l",
  "brace-r",
  "braces",
  "bolt",
  "com-link",
  "lightning-bolt",
  "doc",
  "document",
  "delay",
  "half-rounded-rectangle",
  "h-cyl",
  "das",
  "horizontal-cylinder",
  "lin-cyl",
  "disk",
  "lined-cylinder",
  "curv-trap",
  "curved-trapezoid",
  "display",
  "div-rect",
  "div-proc",
  "divided-rectangle",
  "divided-process",
  "tri",
  "extract",
  "triangle",
  "win-pane",
  "internal-storage",
  "window-pane",
  "f-circ",
  "junction",
  "filled-circle",
  "notch-pent",
  "loop-limit",
  "notched-pentagon",
  "flip-tri",
  "manual-file",
  "flipped-triangle",
  "sl-rect",
  "manual-input",
  "sloped-rectangle",
  "docs",
  "documents",
  "st-doc",
  "stacked-document",
  "st-rect",
  "procs",
  "processes",
  "stacked-rectangle",
  "bow-rect",
  "stored-data",
  "bow-tie-rectangle",
  "cross-circ",
  "summary",
  "crossed-circle",
  "tag-doc",
  "tagged-document",
  "tag-rect",
  "tagged-rectangle",
  "tag-proc",
  "tagged-process",
  "flag",
  "paper-tape",
  "odd",
  "lin-doc",
  "lined-document",
]);
// Keys of the node form and of the edge-attribute form of `id@{ ... }`.
export const FLOWCHART_AT_BLOCK_NODE_KEYS = [
  "shape",
  "label",
  "labelType",
] as const;
export const FLOWCHART_AT_BLOCK_EDGE_KEYS = [
  "animate",
  "animation",
  "curve",
] as const;
export const FLOWCHART_AT_BLOCK_LABEL_TYPES = ["text", "markdown"] as const;
// Mermaid reads the `label` of an `@{}` block as markdown unless `labelType` says otherwise.
export const FLOWCHART_AT_BLOCK_DEFAULT_LABEL_TYPE = "markdown";
export const FLOWCHART_AT_BLOCK_BARE_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/;
export const FLOWCHART_AT_BLOCK_WORD_VALUE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const FLOWCHART_AT_BLOCK_KEY_PATTERN = /^[A-Za-z]+$/;

// The text of `style`, `classDef` and `linkStyle` is read by Mermaid as a run of word,
// number, unit, colon, `#` and `%` tokens. Measured: `( ) < = > @ [ ] ^ { | } ~` are
// rejected, and so are the sequences below (`--`, `-.` start links, `:::` is the class
// operator, `%%` starts a comment). Anything outside this alphabet makes the statement
// opaque; quotes, backslashes and non-ASCII text are refused too, not because Mermaid
// rejects them but because they were not verified.
export const FLOWCHART_STYLE_TEXT_PATTERN = /^[A-Za-z0-9 \t#%.:,_/-]+$/;
export const FLOWCHART_STYLE_FORBIDDEN_SEQUENCES: readonly string[] = [
  "--",
  "-.",
  ":::",
  "%%",
];

export const FLOWCHART_CLICK_TARGETS = [
  "_self",
  "_blank",
  "_parent",
  "_top",
] as const;

// Text that Mermaid rewrites before it reads the diagram: see flowchart-source-issues.ts.
export const FLOWCHART_ENTITY_LIKE_PATTERN = /#\w+;/y;
export const FLOWCHART_STYLE_LIKE_PATTERNS: readonly RegExp[] = [
  /style.*:\S*#.*;/g,
  /classDef.*:\S*#.*;/g,
];
export const FLOWCHART_BARE_COMMENT_PATTERN = /^\s*%%$/;
