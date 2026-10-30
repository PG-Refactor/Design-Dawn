import type {
  FlowchartBracketShapeName,
  FlowchartDirection,
  FlowchartDirectionToken,
  FlowchartHeaderKeyword,
  FlowchartLinkStroke,
  FlowchartLinkType,
} from "./flowchart-config";

// Result types of the flowchart reader. Convention that the tests rely on: every object that
// has a `span` (UTF-16 offsets into the source) also has a `text` that is exactly
// `source.slice(span.start, span.end)`. Nothing in the source is trimmed or rewritten; the
// normalised value Mermaid stores for a label is kept under a different name (`value`).

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface FlowchartToken {
  readonly text: string;
  readonly span: TextSpan;
}

export type FlowchartLabelType = "text" | "markdown";

export interface FlowchartLabel {
  // Everything that belongs to the label as written: the quotes and backticks included.
  readonly text: string;
  readonly span: TextSpan;
  // The characters an edit replaces: the trimmed text for an unquoted label, the text
  // between the quotes for a quoted one, the text between the backticks for a markdown one.
  readonly content: FlowchartToken;
  // What Mermaid stores: trimmed, quotes and backticks removed.
  readonly value: string;
  readonly labelType: FlowchartLabelType;
  readonly quoted: boolean;
}

export interface FlowchartBracketShape {
  readonly shape: FlowchartBracketShapeName;
  readonly opener: FlowchartToken;
  readonly closer: FlowchartToken;
  readonly label: FlowchartLabel;
  // The whole `[...]`, opener to closer.
  readonly text: string;
  readonly span: TextSpan;
}

export interface FlowchartAtEntry {
  readonly key: FlowchartToken;
  // Without the quotes of a quoted value.
  readonly value: FlowchartToken;
  readonly quoted: boolean;
  readonly text: string;
  readonly span: TextSpan;
}

// `@{ key: value, ... }` on one line. Keys are checked later, when it is known whether the
// block belongs to a node or to an edge id.
export interface FlowchartAtBlock {
  readonly entries: readonly FlowchartAtEntry[];
  // The characters between the braces.
  readonly body: FlowchartToken;
  // From `@` to the closing `}`.
  readonly text: string;
  readonly span: TextSpan;
}

export interface FlowchartClassOperator {
  readonly name: FlowchartToken;
  // From `:::` to the end of the name.
  readonly text: string;
  readonly span: TextSpan;
}

export interface FlowchartNodeTerm {
  readonly id: FlowchartToken;
  readonly shape: FlowchartBracketShape | null;
  readonly atBlock: FlowchartAtBlock | null;
  readonly classOperator: FlowchartClassOperator | null;
  readonly text: string;
  readonly span: TextSpan;
}

// `A & B & C`: the terms of one side of a link.
export interface FlowchartTermGroup {
  readonly terms: readonly FlowchartNodeTerm[];
  readonly ampersands: readonly FlowchartToken[];
  readonly text: string;
  readonly span: TextSpan;
}

export type FlowchartEdgeLabelForm = "pipe" | "inline";

export interface FlowchartEdgeLabel {
  readonly form: FlowchartEdgeLabelForm;
  readonly label: FlowchartLabel;
  // pipe form: the two `|`; inline form: the opening half (`--`) and the closing half (`-->`)
  // of the link. The whole label region is `span`.
  readonly open: FlowchartToken;
  readonly close: FlowchartToken;
  readonly text: string;
  readonly span: TextSpan;
}

export interface FlowchartLink {
  // The link token: `-->`, `-.->`, `==>`, `~~~` ... For the inline label form this is the
  // closing half; the opening half is `label.open`.
  readonly token: FlowchartToken;
  readonly edgeId: FlowchartToken | null;
  readonly label: FlowchartEdgeLabel | null;
  readonly type: FlowchartLinkType;
  readonly stroke: FlowchartLinkStroke;
  readonly length: number;
  // From the edge id (or the link) to the end of the label.
  readonly text: string;
  readonly span: TextSpan;
}

export interface FlowchartStatementBase {
  readonly lineIndex: number;
  // Position of the statement among the recognised statements, in source order.
  readonly index: number;
  readonly text: string;
  readonly span: TextSpan;
}

export interface FlowchartVertexStatement extends FlowchartStatementBase {
  // "node" has one group of terms and no link; "edge" has at least one link.
  readonly kind: "node" | "edge";
  readonly groups: readonly FlowchartTermGroup[];
  // links[i] joins groups[i] and groups[i + 1].
  readonly links: readonly FlowchartLink[];
}

export interface FlowchartSubgraphStartStatement
  extends FlowchartStatementBase {
  readonly kind: "subgraphStart";
  readonly id: FlowchartToken;
  // `[title]` or `["title"]` after the id; null when the id is the title.
  readonly title: FlowchartLabel | null;
}

export interface FlowchartSubgraphEndStatement extends FlowchartStatementBase {
  readonly kind: "subgraphEnd";
}

export interface FlowchartSubgraphDirectionStatement
  extends FlowchartStatementBase {
  readonly kind: "subgraphDirection";
  readonly direction: FlowchartToken;
  readonly value: FlowchartDirectionToken;
}

export interface FlowchartClassDefStatement extends FlowchartStatementBase {
  readonly kind: "classDef";
  readonly names: readonly FlowchartToken[];
  readonly styleText: FlowchartToken;
  readonly styles: readonly string[];
}

export interface FlowchartClassStatement extends FlowchartStatementBase {
  readonly kind: "class";
  readonly targets: readonly FlowchartToken[];
  readonly className: FlowchartToken;
}

export interface FlowchartStyleStatement extends FlowchartStatementBase {
  readonly kind: "style";
  readonly target: FlowchartToken;
  readonly styleText: FlowchartToken;
  readonly styles: readonly string[];
}

export interface FlowchartLinkStyleStatement extends FlowchartStatementBase {
  readonly kind: "linkStyle";
  // `default` or the edge indexes; one token per entry.
  readonly targets: readonly FlowchartToken[];
  readonly appliesToDefault: boolean;
  readonly indexes: readonly number[];
  readonly interpolate: FlowchartToken | null;
  readonly styleText: FlowchartToken | null;
  readonly styles: readonly string[];
}

export type FlowchartClickForm = "link" | "href" | "call" | "callback";

export interface FlowchartClickStatement extends FlowchartStatementBase {
  readonly kind: "click";
  readonly targets: readonly FlowchartToken[];
  readonly form: FlowchartClickForm;
  // The link target of the `link` and `href` forms; null for the others.
  readonly url: FlowchartToken | null;
  readonly tooltip: FlowchartToken | null;
}

export interface FlowchartEdgeAttributeEntry {
  readonly key: "animate" | "animation" | "curve";
  readonly value: string;
}

// `e1@{ animate: true }` for an edge id that already exists.
export interface FlowchartEdgeAttributesStatement
  extends FlowchartStatementBase {
  readonly kind: "edgeAttributes";
  readonly id: FlowchartToken;
  readonly atBlock: FlowchartAtBlock;
  readonly entries: readonly FlowchartEdgeAttributeEntry[];
}

export interface FlowchartAccessibilityStatement
  extends FlowchartStatementBase {
  readonly kind: "accessibility";
  readonly keyword: "accTitle" | "accDescr";
}

export type FlowchartStatement =
  | FlowchartVertexStatement
  | FlowchartSubgraphStartStatement
  | FlowchartSubgraphEndStatement
  | FlowchartSubgraphDirectionStatement
  | FlowchartClassDefStatement
  | FlowchartClassStatement
  | FlowchartStyleStatement
  | FlowchartLinkStyleStatement
  | FlowchartClickStatement
  | FlowchartEdgeAttributesStatement
  | FlowchartAccessibilityStatement;

export type FlowchartStatementKind = FlowchartStatement["kind"];

export interface FlowchartHeader {
  readonly lineIndex: number;
  readonly keyword: FlowchartHeaderKeyword;
  readonly keywordToken: FlowchartToken;
  // null when the header has no direction (Mermaid then draws top to bottom).
  readonly directionToken: FlowchartToken | null;
  readonly directionValue: FlowchartDirectionToken | null;
  readonly direction: FlowchartDirection;
  // The `;` that lets statements follow on the header line.
  readonly terminator: FlowchartToken | null;
}

// Why a statement was not understood. Each code is one distinct, documented construct;
// an opaque statement makes the whole diagram read-only.
export const FLOWCHART_OPAQUE_REASONS = [
  "unsupportedHeader",
  "topLevelDirection",
  "unsupportedDirection",
  "unsupportedSubgraphHeader",
  "subgraphSharesLine",
  "strayStatementSeparator",
  "duplicateSubgraphId",
  "unclosedSubgraph",
  "endWithoutSubgraph",
  "duplicateSubgraphDirection",
  "unterminatedQuote",
  "unterminatedBracket",
  "unterminatedAtBlock",
  "backtickInLabel",
  "specialCharsInLabel",
  "emptyLabel",
  "propsShape",
  "keywordLikeId",
  "reservedId",
  "unsupportedId",
  "ambiguousLinkBoundary",
  "entityLikeText",
  "invalidLink",
  "invalidEdgeLabel",
  "mismatchedInlineLink",
  "atBlockUnsupportedKey",
  "atBlockEscape",
  "atBlockDuplicateKey",
  "atBlockUnsupportedValue",
  "atBlockMalformed",
  "atBlockOnSubgraph",
  "atBlockBeforeEdgeId",
  "unknownShape",
  "edgeIdSwallowsNode",
  "unsupportedClassDef",
  "unsupportedClass",
  "unsupportedStyle",
  "unsupportedLinkStyle",
  "linkStyleOutOfRange",
  "unsupportedClick",
  "unsupportedAccessibility",
  "bareCommentMark",
  "nonAsciiWhitespace",
  "unrecognizedStatement",
] as const;
export type FlowchartOpaqueReason = (typeof FLOWCHART_OPAQUE_REASONS)[number];

export interface FlowchartOpaqueStatement {
  readonly lineIndex: number;
  readonly span: TextSpan;
  readonly text: string;
  readonly reason: FlowchartOpaqueReason;
}

// Properties of the whole text that make a line-based reading unreliable because Mermaid
// rewrites the text before it parses (same idea as the pie reader's source issues).
export type FlowchartSourceIssueCode =
  | "loneCarriageReturn"
  | "markupRewrite"
  | "styleLikeText"
  | "inlineDirective";

export interface FlowchartSourceIssue {
  readonly code: FlowchartSourceIssueCode;
  // 0-based line indexes the issue was found on (empty for a whole-text property).
  readonly lineIndexes: readonly number[];
}

export type FlowchartLineKind =
  | "blank"
  | "comment"
  | "directive"
  | "frontMatter"
  | "header"
  | "statement";

export interface FlowchartLine {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly terminator: "" | "\n" | "\r\n";
  readonly text: string;
  readonly kind: FlowchartLineKind;
}
