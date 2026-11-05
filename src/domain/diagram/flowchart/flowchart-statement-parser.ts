import {
  FLOWCHART_ACC_DESCR_KEYWORD,
  FLOWCHART_ACC_TITLE_KEYWORD,
  FLOWCHART_AMPERSAND,
  FLOWCHART_CLASS_DEF_KEYWORD,
  FLOWCHART_CLASS_KEYWORD,
  FLOWCHART_CLICK_KEYWORD,
  FLOWCHART_CLICK_TARGETS,
  FLOWCHART_DIRECTION_KEYWORD,
  FLOWCHART_DIRECTION_TOKENS,
  FLOWCHART_END_KEYWORD,
  FLOWCHART_LINK_STYLE_DEFAULT,
  FLOWCHART_LINK_STYLE_KEYWORD,
  FLOWCHART_RESERVED_IDS,
  FLOWCHART_STYLE_FORBIDDEN_SEQUENCES,
  FLOWCHART_STYLE_KEYWORD,
  FLOWCHART_STYLE_TEXT_PATTERN,
  FLOWCHART_SUBGRAPH_KEYWORD,
  type FlowchartDirectionToken,
} from "./flowchart-config";
import { readLink } from "./flowchart-link-parser";
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
import type { RawSegment } from "./flowchart-segments";
import {
  readClassName,
  readId,
  readNodeTerm,
  readQuotedLabel,
  readUnquotedLabel,
} from "./flowchart-term-parser";
import type {
  FlowchartClickForm,
  FlowchartLabel,
  FlowchartLink,
  FlowchartNodeTerm,
  FlowchartOpaqueReason,
  FlowchartStatement,
  FlowchartTermGroup,
  FlowchartToken,
} from "./flowchart-types";

// Turns one statement segment into a statement of the recognised kinds (or an opaque
// reason). Context rules that need the statements before it (an edge id that already
// exists, an out-of-range linkStyle index, nesting of subgraphs) are checked later, by the
// resolver; nothing here looks at another statement.

type DistributiveOmit<Type, Key extends PropertyKey> = Type extends unknown
  ? Omit<Type, Key>
  : never;

export type PendingStatement = DistributiveOmit<FlowchartStatement, "index">;

// A stray `;` (see segments). Not a statement of the reading: the resolver drops it, or
// refuses it inside a subgraph block.
export interface StraySeparator {
  readonly kind: "straySeparator";
  readonly lineIndex: number;
  readonly text: string;
  readonly span: { readonly start: number; readonly end: number };
}

export type SegmentParse =
  | {
      readonly ok: true;
      readonly statement: PendingStatement | StraySeparator;
    }
  | { readonly ok: false; readonly reason: FlowchartOpaqueReason };

const DIRECTION_STATEMENT_PATTERN = new RegExp(
  `^${FLOWCHART_DIRECTION_KEYWORD}[ \\t]+(${FLOWCHART_DIRECTION_TOKENS.join("|")})$`,
);
const NUMBER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const TOOLTIP_PATTERN = /^"[^"]+"$/;
// Only characters that cannot be mistaken for syntax; Mermaid rejects parentheses and some
// other characters in a click target.
const URL_PATTERN = /^"[A-Za-z0-9:/._~%#?&=+@-]+"$/;
const CALL_PATTERN = /^call +\w+\([A-Za-z0-9_, .-]*\)(?: +("[^"]+"))?$/d;
const CALLBACK_PATTERN = /^\w+(?: +("[^"]+"))?$/d;
const CLICK_TARGET_PATTERN = new RegExp(
  `^(?:${FLOWCHART_CLICK_TARGETS.join("|")})$`,
);
const CALL_KEYWORD = "call";
const HREF_KEYWORD = "href";
const INTERPOLATE_KEYWORD = "interpolate";
const COMMA = ",";
const BACKSLASH = "\\";

function startsWithKeyword(text: string, keyword: string): boolean {
  return text.startsWith(keyword) && isBlankCharacter(text[keyword.length]);
}

// Mermaid cuts a style text at each comma and keeps the pieces as written, blanks included
// (`stroke:red, fill:blue` holds " fill:blue", which does not start with "fill": the
// linkStyle rule for adding `fill:none` depends on that). An empty piece or a backslash
// (`\,` is an escaped comma) is refused rather than guessed.
export function splitStyleItems(raw: string): readonly string[] | null {
  if (raw.includes(BACKSLASH)) return null;
  const items = raw.split(COMMA);
  return items.some((item) => item.trim() === "") ? null : items;
}

function readClassNameList(
  scan: Scan,
  position: number,
): ParseOutcome<readonly FlowchartToken[]> {
  const names: FlowchartToken[] = [];
  let cursor = position;
  for (;;) {
    const name = readClassName(scan, cursor);
    if (!name.ok) return name;
    names.push(name.value);
    cursor = name.end;
    if (scan.text[cursor] !== COMMA) return parsed(names, cursor);
    cursor += 1;
  }
}

function readIdList(
  scan: Scan,
  position: number,
): ParseOutcome<readonly FlowchartToken[]> {
  const ids: FlowchartToken[] = [];
  let cursor = position;
  for (;;) {
    const id = readId(scan, cursor, COMMA);
    if (!id.ok) return id;
    ids.push(id.value);
    cursor = id.end;
    if (scan.text[cursor] !== COMMA) return parsed(ids, cursor);
    cursor += 1;
  }
}

// The rest of a style statement from `position`: needs at least one blank before it, and
// at least one style.
function readStyleText(
  scan: Scan,
  position: number,
): ParseOutcome<{ token: FlowchartToken; styles: readonly string[] }> {
  if (!isBlankCharacter(scan.text[position]))
    return failed("unrecognizedStatement");
  const start = skipBlanks(scan.text, position);
  if (start >= scan.text.length) return failed("unrecognizedStatement");
  const token = tokenOf(scan, start, scan.text.length);
  if (
    !FLOWCHART_STYLE_TEXT_PATTERN.test(token.text) ||
    FLOWCHART_STYLE_FORBIDDEN_SEQUENCES.some((sequence) =>
      token.text.includes(sequence),
    )
  ) {
    return failed("unsupportedStyle");
  }
  // A word that is a keyword is lexed as one (`linkStyle` inside a style text breaks it).
  if (
    token.text
      .split(/[^A-Za-z0-9_]+/)
      .some((word) => FLOWCHART_RESERVED_IDS.has(word))
  ) {
    return failed("unsupportedStyle");
  }
  const styles = splitStyleItems(token.text);
  if (styles === null) return failed("unsupportedStyle");
  return parsed({ token, styles }, scan.text.length);
}

function wrap(
  scan: Scan,
  statement: DistributiveOmit<PendingStatement, "text" | "span" | "lineIndex">,
  lineIndex: number,
): PendingStatement {
  return {
    ...statement,
    lineIndex,
    text: scan.text,
    span: spanOf(scan, 0, scan.text.length),
  } as PendingStatement;
}

function parseSubgraph(scan: Scan, lineIndex: number): SegmentParse {
  const idStart = skipBlanks(scan.text, FLOWCHART_SUBGRAPH_KEYWORD.length);
  const first = scan.text.charAt(idStart);
  if (first === "" || first === '"' || first === "[") {
    return { ok: false, reason: "unsupportedSubgraphHeader" };
  }
  const id = readId(scan, idStart);
  if (!id.ok) return { ok: false, reason: id.reason };
  const afterId = skipBlanks(scan.text, id.end);
  let title: FlowchartLabel | null = null;
  if (afterId < scan.text.length) {
    if (scan.text[afterId] !== "[") {
      return { ok: false, reason: "unsupportedSubgraphHeader" };
    }
    const label = readSquareTitle(scan, afterId);
    if (!label.ok) return { ok: false, reason: label.reason };
    if (skipBlanks(scan.text, label.end) < scan.text.length) {
      return { ok: false, reason: "unsupportedSubgraphHeader" };
    }
    title = label.value;
  }
  return {
    ok: true,
    statement: wrap(
      scan,
      { kind: "subgraphStart", id: id.value, title },
      lineIndex,
    ),
  };
}

// `[title]` or `["title"]` after a subgraph id.
function readSquareTitle(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartLabel> {
  // As for node labels, the quote must touch the bracket on both sides.
  const start = position + 1;
  if (scan.text[start] === '"') {
    const quoted = readQuotedLabel(scan, start);
    if (!quoted.ok) return quoted;
    const closeAt = quoted.end;
    if (scan.text[closeAt] !== "]") return failed("unterminatedBracket");
    return parsed(quoted.value, closeAt + 1);
  }
  const closeAt = scan.text.indexOf("]", position + 1);
  if (closeAt === -1) return failed("unterminatedBracket");
  const label = readUnquotedLabel(scan, position + 1, closeAt);
  if (!label.ok) return label;
  return parsed(label.value, closeAt + 1);
}

function parseClassDef(scan: Scan, lineIndex: number): SegmentParse {
  const namesStart = skipBlanks(scan.text, FLOWCHART_CLASS_DEF_KEYWORD.length);
  const names = readClassNameList(scan, namesStart);
  if (!names.ok) return { ok: false, reason: "unsupportedClassDef" };
  const style = readStyleText(scan, names.end);
  if (!style.ok) return { ok: false, reason: "unsupportedClassDef" };
  return {
    ok: true,
    statement: wrap(
      scan,
      {
        kind: "classDef",
        names: names.value,
        styleText: style.value.token,
        styles: style.value.styles,
      },
      lineIndex,
    ),
  };
}

function parseClass(scan: Scan, lineIndex: number): SegmentParse {
  const targetsStart = skipBlanks(scan.text, FLOWCHART_CLASS_KEYWORD.length);
  const targets = readIdList(scan, targetsStart);
  if (!targets.ok) return { ok: false, reason: "unsupportedClass" };
  if (!isBlankCharacter(scan.text[targets.end])) {
    return { ok: false, reason: "unsupportedClass" };
  }
  const nameStart = skipBlanks(scan.text, targets.end);
  const name = readClassName(scan, nameStart);
  if (!name.ok || name.end !== scan.text.length) {
    return { ok: false, reason: "unsupportedClass" };
  }
  return {
    ok: true,
    statement: wrap(
      scan,
      {
        kind: "class",
        targets: targets.value,
        className: tokenOf(scan, nameStart, scan.text.length),
      },
      lineIndex,
    ),
  };
}

function parseStyle(scan: Scan, lineIndex: number): SegmentParse {
  const targetStart = skipBlanks(scan.text, FLOWCHART_STYLE_KEYWORD.length);
  const target = readId(scan, targetStart);
  if (!target.ok) return { ok: false, reason: "unsupportedStyle" };
  const style = readStyleText(scan, target.end);
  if (!style.ok) return { ok: false, reason: "unsupportedStyle" };
  return {
    ok: true,
    statement: wrap(
      scan,
      {
        kind: "style",
        target: target.value,
        styleText: style.value.token,
        styles: style.value.styles,
      },
      lineIndex,
    ),
  };
}

function parseLinkStyle(scan: Scan, lineIndex: number): SegmentParse {
  const targetsStart = skipBlanks(
    scan.text,
    FLOWCHART_LINK_STYLE_KEYWORD.length,
  );
  const targets: FlowchartToken[] = [];
  const indexes: number[] = [];
  let appliesToDefault = false;
  let cursor = targetsStart;
  if (scan.text.startsWith(FLOWCHART_LINK_STYLE_DEFAULT, cursor)) {
    targets.push(
      tokenOf(scan, cursor, cursor + FLOWCHART_LINK_STYLE_DEFAULT.length),
    );
    appliesToDefault = true;
    cursor += FLOWCHART_LINK_STYLE_DEFAULT.length;
  } else {
    for (;;) {
      let end = cursor;
      while (/[0-9]/.test(scan.text.charAt(end))) end += 1;
      const digits = scan.text.slice(cursor, end);
      if (!NUMBER_PATTERN.test(digits)) {
        return { ok: false, reason: "unsupportedLinkStyle" };
      }
      targets.push(tokenOf(scan, cursor, end));
      indexes.push(Number(digits));
      cursor = end;
      if (scan.text[cursor] !== COMMA) break;
      cursor += 1;
    }
  }
  let interpolate: FlowchartToken | null = null;
  let styleText: FlowchartToken | null = null;
  let styles: readonly string[] = [];
  let rest = skipBlanks(scan.text, cursor);
  if (rest === cursor && rest < scan.text.length) {
    return { ok: false, reason: "unsupportedLinkStyle" };
  }
  if (
    scan.text.startsWith(INTERPOLATE_KEYWORD, rest) &&
    isBlankCharacter(scan.text[rest + INTERPOLATE_KEYWORD.length])
  ) {
    const wordStart = skipBlanks(scan.text, rest + INTERPOLATE_KEYWORD.length);
    let wordEnd = wordStart;
    while (/\w/.test(scan.text.charAt(wordEnd))) wordEnd += 1;
    if (wordEnd === wordStart) {
      return { ok: false, reason: "unsupportedLinkStyle" };
    }
    interpolate = tokenOf(scan, wordStart, wordEnd);
    const afterWord = skipBlanks(scan.text, wordEnd);
    if (afterWord < scan.text.length && afterWord === wordEnd) {
      return { ok: false, reason: "unsupportedLinkStyle" };
    }
    rest = afterWord;
  }
  if (rest < scan.text.length) {
    const style = readStyleText(scan, rest - 1);
    if (!style.ok) return { ok: false, reason: "unsupportedLinkStyle" };
    styleText = style.value.token;
    styles = style.value.styles;
  }
  if (interpolate === null && styleText === null) {
    return { ok: false, reason: "unsupportedLinkStyle" };
  }
  return {
    ok: true,
    statement: wrap(
      scan,
      {
        kind: "linkStyle",
        targets,
        appliesToDefault,
        indexes,
        interpolate,
        styleText,
        styles,
      },
      lineIndex,
    ),
  };
}

interface ClickRest {
  readonly form: FlowchartClickForm;
  readonly url: FlowchartToken | null;
  readonly tooltip: FlowchartToken | null;
}

// `click A "url" ["tip"] [_blank]`, `click A href "url" ...`, `click A call fn(args) ["tip"]`,
// `click A fn ["tip"]`.
function readClickRest(scan: Scan, position: number): ClickRest | null {
  let cursor = position;
  let form: FlowchartClickForm = "link";
  if (startsWithKeyword(scan.text.slice(cursor), HREF_KEYWORD)) {
    form = "href";
    cursor = skipBlanks(scan.text, cursor + HREF_KEYWORD.length);
  }
  if (scan.text[cursor] === '"') {
    const urlEnd = scan.text.indexOf('"', cursor + 1);
    if (urlEnd === -1) return null;
    const rawUrl = scan.text.slice(cursor, urlEnd + 1);
    if (!URL_PATTERN.test(rawUrl)) return null;
    const url = tokenOf(scan, cursor + 1, urlEnd);
    cursor = urlEnd + 1;
    let tooltip: FlowchartToken | null = null;
    let next = skipBlanks(scan.text, cursor);
    if (next > cursor && scan.text[next] === '"') {
      const tipEnd = scan.text.indexOf('"', next + 1);
      if (tipEnd === -1 || tipEnd === next + 1) return null;
      tooltip = tokenOf(scan, next + 1, tipEnd);
      cursor = tipEnd + 1;
      next = skipBlanks(scan.text, cursor);
    }
    if (next > cursor) {
      const target = scan.text.slice(next);
      if (!CLICK_TARGET_PATTERN.test(target)) return null;
      return { form, url, tooltip };
    }
    return next === scan.text.length ? { form, url, tooltip } : null;
  }
  if (form === "href") return null;
  const rest = scan.text.slice(cursor);
  if (startsWithKeyword(rest, CALL_KEYWORD)) {
    const call = CALL_PATTERN.exec(rest);
    if (call === null) return null;
    return { form: "call", url: null, tooltip: tooltipOf(scan, cursor, call) };
  }
  const callback = CALLBACK_PATTERN.exec(rest);
  if (callback === null) return null;
  return {
    form: "callback",
    url: null,
    tooltip: tooltipOf(scan, cursor, callback),
  };
}

function tooltipOf(
  scan: Scan,
  restStart: number,
  match: RegExpExecArray,
): FlowchartToken | null {
  const indices = (
    match as RegExpExecArray & {
      indices?: readonly ([number, number] | undefined)[];
    }
  ).indices;
  const group = indices?.[1];
  if (group === undefined || match[1] === undefined) return null;
  if (!TOOLTIP_PATTERN.test(match[1])) return null;
  return tokenOf(scan, restStart + group[0] + 1, restStart + group[1] - 1);
}

function parseClick(scan: Scan, lineIndex: number): SegmentParse {
  const targetsStart = skipBlanks(scan.text, FLOWCHART_CLICK_KEYWORD.length);
  const targets = readIdList(scan, targetsStart);
  if (!targets.ok) return { ok: false, reason: "unsupportedClick" };
  if (!isBlankCharacter(scan.text[targets.end])) {
    return { ok: false, reason: "unsupportedClick" };
  }
  const rest = readClickRest(scan, skipBlanks(scan.text, targets.end));
  if (rest === null) return { ok: false, reason: "unsupportedClick" };
  return {
    ok: true,
    statement: wrap(
      scan,
      {
        kind: "click",
        targets: targets.value,
        form: rest.form,
        url: rest.url,
        tooltip: rest.tooltip,
      },
      lineIndex,
    ),
  };
}

function readAmpersand(scan: Scan, position: number): number | null {
  const at = skipBlanks(scan.text, position);
  if (at === position || scan.text[at] !== FLOWCHART_AMPERSAND) return null;
  if (!isBlankCharacter(scan.text[at + 1])) return null;
  return at;
}

function readGroup(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartTermGroup> {
  const terms: FlowchartNodeTerm[] = [];
  const ampersands: FlowchartToken[] = [];
  let cursor = position;
  for (;;) {
    const term = readNodeTerm(scan, cursor);
    if (!term.ok) return term;
    terms.push(term.value);
    cursor = term.end;
    const ampersandAt = readAmpersand(scan, cursor);
    if (ampersandAt === null) break;
    ampersands.push(tokenOf(scan, ampersandAt, ampersandAt + 1));
    cursor = skipBlanks(scan.text, ampersandAt + 1);
  }
  return parsed(
    {
      terms,
      ampersands,
      text: scan.text.slice(position, cursor),
      span: spanOf(scan, position, cursor),
    },
    cursor,
  );
}

function parseVertexStatement(scan: Scan, lineIndex: number): SegmentParse {
  const groups: FlowchartTermGroup[] = [];
  const links: FlowchartLink[] = [];
  let cursor = 0;
  for (;;) {
    const group = readGroup(scan, cursor);
    if (!group.ok) return { ok: false, reason: group.reason };
    groups.push(group.value);
    cursor = skipBlanks(scan.text, group.end);
    if (cursor >= scan.text.length) break;
    const link = readLink(scan, cursor);
    if (!link.ok) return { ok: false, reason: link.reason };
    links.push(link.value);
    cursor = skipBlanks(scan.text, link.end);
  }
  return {
    ok: true,
    statement: wrap(
      scan,
      { kind: links.length === 0 ? "node" : "edge", groups, links },
      lineIndex,
    ),
  };
}

// Dispatches on the first word. A word that is only a prefix of an id (`style1`, `endA`)
// is an id, so a keyword counts only when a blank follows it (or, for `end`, when it is the
// whole statement).
export function parseSegment(
  segment: RawSegment,
  lineIndex: number,
): SegmentParse {
  const scan: Scan = { text: segment.text, base: segment.start };
  if (segment.flag === "stray") {
    return {
      ok: true,
      statement: {
        kind: "straySeparator",
        lineIndex,
        text: segment.text,
        span: spanOf(scan, 0, scan.text.length),
      },
    };
  }
  if (segment.flag === "unterminatedQuote") {
    return { ok: false, reason: "unterminatedQuote" };
  }
  if (segment.flag === "entityLike") {
    return { ok: false, reason: "entityLikeText" };
  }
  if (segment.flag === "accessibility") {
    return parseAccessibility(scan, lineIndex);
  }
  const text = scan.text;
  if (text === FLOWCHART_END_KEYWORD) {
    return {
      ok: true,
      statement: wrap(scan, { kind: "subgraphEnd" }, lineIndex),
    };
  }
  if (startsWithKeyword(text, FLOWCHART_SUBGRAPH_KEYWORD)) {
    // Blanks after the header are part of its title for Mermaid (`subgraph I ` gets a
    // generated id), so a header with trailing blanks is not read.
    if (segment.trailingBlanks > 0) {
      return { ok: false, reason: "unsupportedSubgraphHeader" };
    }
    return parseSubgraph(scan, lineIndex);
  }
  if (startsWithKeyword(text, FLOWCHART_DIRECTION_KEYWORD)) {
    const direction = DIRECTION_STATEMENT_PATTERN.exec(text);
    if (direction === null)
      return { ok: false, reason: "unsupportedDirection" };
    const value = direction[1] as FlowchartDirectionToken;
    const start = text.length - value.length;
    return {
      ok: true,
      statement: wrap(
        scan,
        {
          kind: "subgraphDirection",
          direction: tokenOf(scan, start, text.length),
          value,
        },
        lineIndex,
      ),
    };
  }
  if (startsWithKeyword(text, FLOWCHART_CLASS_DEF_KEYWORD)) {
    return parseClassDef(scan, lineIndex);
  }
  if (startsWithKeyword(text, FLOWCHART_CLASS_KEYWORD)) {
    return parseClass(scan, lineIndex);
  }
  if (startsWithKeyword(text, FLOWCHART_STYLE_KEYWORD)) {
    return parseStyle(scan, lineIndex);
  }
  if (startsWithKeyword(text, FLOWCHART_LINK_STYLE_KEYWORD)) {
    // Mermaid rejects blanks after a linkStyle statement.
    if (segment.trailingBlanks > 0) {
      return { ok: false, reason: "unsupportedLinkStyle" };
    }
    return parseLinkStyle(scan, lineIndex);
  }
  if (startsWithKeyword(text, FLOWCHART_CLICK_KEYWORD)) {
    // Mermaid rejects blanks after a click statement, and tabs or repeated blanks between its parts.
    if (
      segment.trailingBlanks > 0 ||
      text.includes("\t") ||
      text.includes("  ")
    ) {
      return { ok: false, reason: "unsupportedClick" };
    }
    return parseClick(scan, lineIndex);
  }
  return parseVertexStatement(scan, lineIndex);
}

// `accTitle: text` / `accDescr: text` own the rest of the line; `accDescr { ... }` can run
// over several lines and a `;` in the text ends nothing the reader can rely on, so those are
// refused.
function parseAccessibility(scan: Scan, lineIndex: number): SegmentParse {
  const isTitle = scan.text.startsWith(FLOWCHART_ACC_TITLE_KEYWORD);
  const keyword = isTitle
    ? FLOWCHART_ACC_TITLE_KEYWORD
    : FLOWCHART_ACC_DESCR_KEYWORD;
  const afterKeyword = skipBlanks(scan.text, keyword.length);
  if (scan.text[afterKeyword] !== ":" || scan.text.includes(";")) {
    return { ok: false, reason: "unsupportedAccessibility" };
  }
  return {
    ok: true,
    statement: wrap(
      scan,
      { kind: "accessibility", keyword: isTitle ? "accTitle" : "accDescr" },
      lineIndex,
    ),
  };
}
