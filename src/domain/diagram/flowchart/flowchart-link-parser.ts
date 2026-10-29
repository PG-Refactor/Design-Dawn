import {
  FLOWCHART_EDGE_ID_MARK,
  FLOWCHART_FULL_LINK_PATTERN,
  FLOWCHART_ID_PATTERN,
  FLOWCHART_INLINE_LABEL_FORBIDDEN_PATTERN,
  FLOWCHART_INLINE_LINK_END_PATTERNS,
  FLOWCHART_INLINE_LINK_START_PATTERN,
  FLOWCHART_LINK_START_CHARACTERS,
  FLOWCHART_MAX_LINK_LENGTH,
  FLOWCHART_PIPE,
  FLOWCHART_STRING_QUOTE,
  type FlowchartLinkStroke,
  type FlowchartLinkType,
} from "./flowchart-config";
import {
  failed,
  isBlankCharacter,
  type ParseOutcome,
  parsed,
  type Scan,
  skipBlanks,
  spanOf,
  tokenOf,
} from "./flowchart-scan";
import {
  readId,
  readQuotedLabel,
  readUnquotedLabel,
} from "./flowchart-term-parser";
import type {
  FlowchartEdgeLabel,
  FlowchartLabel,
  FlowchartLink,
  FlowchartToken,
} from "./flowchart-types";

// Link tokens. The meaning of each form (arrow type, stroke, length) follows Mermaid's own
// destructLink rules, measured and read in docs/architecture.md §16.15.2.

interface LinkInfo {
  readonly type: FlowchartLinkType;
  readonly stroke: FlowchartLinkStroke;
  readonly length: number;
}

const DOT = ".";
const EQUALS = "=";
const TILDE = "~";
const LESS_THAN = "<";
const CROSS_MARK = "x";
const CIRCLE_MARK = "o";
const GREATER_THAN = ">";
// Characters a link can start with, besides the dashes: an id followed by `@` is an edge id
// only when one of these follows.
const EDGE_ID_FOLLOWERS = `${FLOWCHART_LINK_START_CHARACTERS}${CROSS_MARK}${CIRCLE_MARK}${LESS_THAN}`;

function countDots(text: string): number {
  let count = 0;
  for (const character of text) if (character === DOT) count += 1;
  return count;
}

// The ending half of a link (the whole link when it has no label text).
function describeEnd(token: string): LinkInfo & { readonly end: string } {
  const last = token.slice(-1);
  let line = token.slice(0, -1);
  let type: FlowchartLinkType = "arrow_open";
  if (last === CROSS_MARK) {
    type = "arrow_cross";
    if (token.startsWith(CROSS_MARK)) {
      type = "double_arrow_cross";
      line = line.slice(1);
    }
  } else if (last === GREATER_THAN) {
    type = "arrow_point";
    if (token.startsWith(LESS_THAN)) {
      type = "double_arrow_point";
      line = line.slice(1);
    }
  } else if (last === CIRCLE_MARK) {
    type = "arrow_circle";
    if (token.startsWith(CIRCLE_MARK)) {
      type = "double_arrow_circle";
      line = line.slice(1);
    }
  }
  let stroke: FlowchartLinkStroke = "normal";
  let length = line.length - 1;
  if (line.startsWith(EQUALS)) stroke = "thick";
  if (line.startsWith(TILDE)) stroke = "invisible";
  const dots = countDots(line);
  if (dots > 0) {
    stroke = "dotted";
    length = dots;
  }
  return {
    type,
    stroke,
    length: Math.min(length, FLOWCHART_MAX_LINK_LENGTH),
    end: last,
  };
}

// The starting half of an inline-labelled link (`--`, `<--`, `-.`, `==` ...).
function describeStart(token: string): {
  readonly mark: "none" | "arrow" | "cross" | "circle";
  readonly stroke: FlowchartLinkStroke;
} {
  const first = token.charAt(0);
  let mark: "none" | "arrow" | "cross" | "circle" = "none";
  if (first === LESS_THAN) mark = "arrow";
  else if (first === CROSS_MARK) mark = "cross";
  else if (first === CIRCLE_MARK) mark = "circle";
  let stroke: FlowchartLinkStroke = "normal";
  if (token.includes(EQUALS)) stroke = "thick";
  if (token.includes(DOT)) stroke = "dotted";
  return { mark, stroke };
}

const MARK_TO_END_TYPE = {
  arrow: "arrow_point",
  cross: "arrow_cross",
  circle: "arrow_circle",
} as const;
const MARK_TO_DOUBLE_TYPE = {
  arrow: "double_arrow_point",
  cross: "double_arrow_cross",
  circle: "double_arrow_circle",
} as const;

// Combines the two halves of `-- text -->`; null when Mermaid would make an invalid edge.
function combineHalves(startToken: string, endToken: string): LinkInfo | null {
  const end = describeEnd(endToken);
  const start = describeStart(startToken);
  if (start.stroke !== end.stroke) return null;
  if (start.mark === "none") {
    return { type: end.type, stroke: end.stroke, length: end.length };
  }
  if (end.type !== MARK_TO_END_TYPE[start.mark]) return null;
  return {
    type: MARK_TO_DOUBLE_TYPE[start.mark],
    stroke: end.stroke,
    length: end.length,
  };
}

function nonBlankLabel(
  outcome: ParseOutcome<FlowchartLabel>,
): ParseOutcome<FlowchartLabel> {
  if (outcome.ok && outcome.value.value === "") return failed("emptyLabel");
  return outcome;
}

// `|text|` after a link, starting at the pipe.
function readPipeLabel(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartEdgeLabel> {
  const afterOpen = position + 1;
  let label: FlowchartLabel;
  let closeAt: number;
  if (scan.text[afterOpen] === FLOWCHART_STRING_QUOTE) {
    const quoted = nonBlankLabel(readQuotedLabel(scan, afterOpen));
    if (!quoted.ok) return quoted;
    if (scan.text[quoted.end] !== FLOWCHART_PIPE) {
      return failed("invalidEdgeLabel");
    }
    label = quoted.value;
    closeAt = quoted.end;
  } else {
    closeAt = scan.text.indexOf(FLOWCHART_PIPE, afterOpen);
    if (closeAt === -1) return failed("invalidEdgeLabel");
    const unquoted = nonBlankLabel(readUnquotedLabel(scan, afterOpen, closeAt));
    if (!unquoted.ok) return unquoted;
    label = unquoted.value;
  }
  const end = closeAt + 1;
  return parsed(
    {
      form: "pipe",
      label,
      open: tokenOf(scan, position, afterOpen),
      close: tokenOf(scan, closeAt, end),
      text: scan.text.slice(position, end),
      span: spanOf(scan, position, end),
    },
    end,
  );
}

interface InlineParts {
  readonly start: FlowchartToken;
  readonly end: FlowchartToken;
  readonly label: FlowchartLabel;
  readonly info: LinkInfo;
  readonly after: number;
}

function matchSticky(pattern: RegExp, text: string, at: number): string | null {
  pattern.lastIndex = at;
  const match = pattern.exec(text);
  return match === null ? null : match[0];
}

// `-- text -->`, `-. text .->`, `== text ==>`: the link is cut in two around its text.
function readInlineParts(
  scan: Scan,
  position: number,
): ParseOutcome<InlineParts> | null {
  FLOWCHART_INLINE_LINK_START_PATTERN.lastIndex = position;
  const startMatch = FLOWCHART_INLINE_LINK_START_PATTERN.exec(scan.text);
  if (startMatch === null) return null;
  const startToken = startMatch[1] as string;
  const startEnd = position + startToken.length;
  const kind = startToken.replace(/^[xo<]/, "");
  const endPattern = FLOWCHART_INLINE_LINK_END_PATTERNS[kind];
  if (endPattern === undefined) return failed("invalidLink");
  const textStart = skipBlanks(scan.text, startEnd);

  let label: FlowchartLabel;
  let endAt: number;
  let endToken: string;
  if (scan.text[textStart] === FLOWCHART_STRING_QUOTE) {
    const quoted = nonBlankLabel(readQuotedLabel(scan, textStart));
    if (!quoted.ok) return quoted;
    label = quoted.value;
    endAt = skipBlanks(scan.text, quoted.end);
    const matched = matchSticky(endPattern, scan.text, endAt);
    if (matched === null) return failed("invalidLink");
    endToken = matched;
  } else {
    let found = -1;
    let foundToken = "";
    for (let index = textStart; index < scan.text.length; index += 1) {
      if (!isBlankCharacter(scan.text[index - 1])) continue;
      const matched = matchSticky(endPattern, scan.text, index);
      if (matched !== null) {
        found = index;
        foundToken = matched;
        break;
      }
    }
    if (found === -1) return failed("invalidLink");
    const unquoted = nonBlankLabel(
      readUnquotedLabel(
        scan,
        textStart,
        found,
        FLOWCHART_INLINE_LABEL_FORBIDDEN_PATTERN,
      ),
    );
    if (!unquoted.ok) return unquoted;
    label = unquoted.value;
    endAt = found;
    endToken = foundToken;
  }
  const info = combineHalves(startToken, endToken);
  if (info === null) return failed("mismatchedInlineLink");
  const after = endAt + endToken.length;
  return parsed(
    {
      start: tokenOf(scan, position, startEnd),
      end: tokenOf(scan, endAt, after),
      label,
      info,
      after,
    },
    after,
  );
}

function readEdgeId(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartToken> | null {
  FLOWCHART_ID_PATTERN.lastIndex = position;
  const match = FLOWCHART_ID_PATTERN.exec(scan.text);
  if (match === null) return null;
  const markAt = position + match[0].length;
  if (scan.text[markAt] !== FLOWCHART_EDGE_ID_MARK) return null;
  if (!EDGE_ID_FOLLOWERS.includes(scan.text.charAt(markAt + 1))) return null;
  if (scan.text.charAt(markAt + 1) === "") return null;
  const id = readId(scan, position);
  if (!id.ok) return id;
  return parsed(id.value, markAt + 1);
}

// Reads one link (with its edge id and label, if any) starting at `position`.
export function readLink(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartLink> {
  let cursor = position;
  let edgeId: FlowchartToken | null = null;
  const edgeIdOutcome = readEdgeId(scan, cursor);
  if (edgeIdOutcome !== null) {
    if (!edgeIdOutcome.ok) return edgeIdOutcome;
    edgeId = edgeIdOutcome.value;
    cursor = edgeIdOutcome.end;
  }

  const full = matchSticky(FLOWCHART_FULL_LINK_PATTERN, scan.text, cursor);
  if (full !== null) {
    const info = describeEnd(full);
    const tokenEnd = cursor + full.length;
    const token = tokenOf(scan, cursor, tokenEnd);
    let label: FlowchartEdgeLabel | null = null;
    let end = tokenEnd;
    const afterBlanks = skipBlanks(scan.text, tokenEnd);
    if (scan.text[afterBlanks] === FLOWCHART_PIPE) {
      const pipe = readPipeLabel(scan, afterBlanks);
      if (!pipe.ok) return pipe;
      label = pipe.value;
      end = pipe.end;
    }
    return parsed(
      {
        token,
        edgeId,
        label,
        type: info.type,
        stroke: info.stroke,
        length: info.length,
        text: scan.text.slice(position, end),
        span: spanOf(scan, position, end),
      },
      end,
    );
  }

  const inline = readInlineParts(scan, cursor);
  if (inline !== null) {
    if (!inline.ok) return inline;
    const parts = inline.value;
    const label: FlowchartEdgeLabel = {
      form: "inline",
      label: parts.label,
      open: parts.start,
      close: parts.end,
      text: scan.text.slice(parts.start.span.start - scan.base, parts.after),
      span: spanOf(scan, parts.start.span.start - scan.base, parts.after),
    };
    return parsed(
      {
        token: parts.end,
        edgeId,
        label,
        type: parts.info.type,
        stroke: parts.info.stroke,
        length: parts.info.length,
        text: scan.text.slice(position, parts.after),
        span: spanOf(scan, position, parts.after),
      },
      parts.after,
    );
  }
  return failed("invalidLink");
}
