import {
  FLOWCHART_BRACKET_FORMS,
  FLOWCHART_UNDRAWABLE_SHAPES,
  type FlowchartBracketShapeName,
  type FlowchartDirection,
  type FlowchartDirectionToken,
  type FlowchartLinkStroke,
  type FlowchartLinkType,
} from "./flowchart-config";

// Values of the Tier 1 operations. The reader's syntax
// values stay in flowchart-config.ts; what is only needed to WRITE text lives here.

// Fallbacks for a source that gives no hint (no statement line to copy the indentation from,
// no line break to copy the line ending from).
export const FLOWCHART_DEFAULT_INDENT = "    ";
export const FLOWCHART_DEFAULT_LINE_ENDING = "\n";

// A node the GUI adds without a chosen shape is a plain rectangle.
export const FLOWCHART_DEFAULT_NEW_NODE_SHAPE: FlowchartEditableShape =
  "square";

// Ids the domain makes up are `N1`, `N2` ...: the first one nothing else uses.
export const FLOWCHART_GENERATED_ID_PREFIX = "N";
export const FLOWCHART_GENERATED_ID_FIRST_NUMBER = 1;
// Subgraph ids the domain makes up are `S1`, `S2` ...
export const FLOWCHART_GENERATED_SUBGRAPH_ID_PREFIX = "S";
// An id a caller supplies. Narrower than what the reader accepts: ASCII only, so a new id can
// never meet the lexical corner cases (`-`, `.`, CJK ...) of Mermaid's id rules.
export const FLOWCHART_NEW_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// A single `x` or `o` next to a link is read as part of the link (flowchart-config.ts,
// FLOWCHART_LINK_ADJACENT_ID_CHARACTERS), so a new node never gets such an id.
export const FLOWCHART_AMBIGUOUS_NEW_IDS: ReadonlySet<string> = new Set([
  "x",
  "o",
]);

// The shapes the GUI may write: every bracket shape except the ones Mermaid cannot draw.
// (FLOWCHART_UNDRAWABLE_SHAPES is typed as a list of names, so the excluded name is spelled
// here; the filter below uses the list, so the two cannot drift apart unnoticed: a test
// compares them.)
export type FlowchartEditableShape = Exclude<
  FlowchartBracketShapeName,
  "ellipse"
>;

const SHAPE_NAMES_IN_CONFIG_ORDER: readonly FlowchartBracketShapeName[] =
  FLOWCHART_BRACKET_FORMS.flatMap((form) =>
    form.closers.map((closer) => closer.shape),
  );

export const FLOWCHART_EDITABLE_SHAPES: readonly FlowchartEditableShape[] =
  SHAPE_NAMES_IN_CONFIG_ORDER.filter(
    (shape): shape is FlowchartEditableShape =>
      !(FLOWCHART_UNDRAWABLE_SHAPES as readonly string[]).includes(shape),
  );

export interface FlowchartBracketPair {
  readonly opener: string;
  readonly closer: string;
}

export function bracketPairOf(
  shape: FlowchartBracketShapeName,
): FlowchartBracketPair | null {
  for (const form of FLOWCHART_BRACKET_FORMS) {
    const closer = form.closers.find((candidate) => candidate.shape === shape);
    if (closer !== undefined)
      return { opener: form.opener, closer: closer.text };
  }
  return null;
}

// `TD` and `TB` are the same direction; the conventional spelling of top-to-bottom is `TD`.
export const FLOWCHART_DIRECTION_WRITE_TOKENS: Readonly<
  Record<FlowchartDirection, FlowchartDirectionToken>
> = {
  TB: "TD",
  BT: "BT",
  RL: "RL",
  LR: "LR",
};

// Labels. A label is always written between double quotes.
export const FLOWCHART_LABEL_QUOTE = '"';
export const FLOWCHART_LABEL_LINE_BREAK_TAG = "<br/>";
export const FLOWCHART_LABEL_LESS_THAN_ENTITY = "#lt;";
export const FLOWCHART_LABEL_GREATER_THAN_ENTITY = "#gt;";
// A line break typed in the GUI; every other control character is refused.
export const FLOWCHART_LABEL_GUI_LINE_BREAK = "\n";
// Entity-like text is rewritten by Mermaid before parsing, so it is never literal text:
// `#word;` (Mermaid's own encodeEntities pattern) and the HTML form `&word;` / `&#35;`.
export const FLOWCHART_LABEL_ENTITY_PATTERNS: readonly RegExp[] = [
  /#\w+;/,
  /&#?\w+;/,
];
export const FLOWCHART_LABEL_DECODE_PATTERN = /<br\s*\/?>|#lt;|#gt;/g;

// Link tokens: which strokes exist for which arrow ends, and how the length is written.
export const FLOWCHART_MIN_LINK_LENGTH = 1;
export const FLOWCHART_LINK_TYPES: readonly FlowchartLinkType[] = [
  "arrow_open",
  "arrow_point",
  "arrow_circle",
  "arrow_cross",
  "double_arrow_point",
  "double_arrow_circle",
  "double_arrow_cross",
];
export const FLOWCHART_LINK_STROKES: readonly FlowchartLinkStroke[] = [
  "normal",
  "thick",
  "dotted",
  "invisible",
];
// The only arrow end an invisible link (`~~~`) has.
export const FLOWCHART_INVISIBLE_LINK_TYPE: FlowchartLinkType = "arrow_open";
