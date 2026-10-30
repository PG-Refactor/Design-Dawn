import {
  FLOWCHART_AT_BLOCK_BARE_VALUE_PATTERN,
  FLOWCHART_AT_BLOCK_KEY_PATTERN,
  FLOWCHART_AT_BLOCK_OPEN,
  FLOWCHART_BRACKET_FORMS,
  FLOWCHART_CLASS_OPERATOR,
  FLOWCHART_FOREIGN_ID_CHARACTER_PATTERN,
  FLOWCHART_ID_PATTERN,
  FLOWCHART_KEYWORD_PREFIXES,
  FLOWCHART_LINK_ADJACENT_ID_CHARACTERS,
  FLOWCHART_LINK_START_CHARACTERS,
  FLOWCHART_MARKDOWN_QUOTE,
  FLOWCHART_PROPS_SHAPE_OPENER,
  FLOWCHART_RESERVED_IDS,
  FLOWCHART_STRING_QUOTE,
  FLOWCHART_UNQUOTED_LABEL_FORBIDDEN_PATTERN,
  FLOWCHART_WORD_CHARACTER_PATTERN,
  type FlowchartBracketForm,
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
import type {
  FlowchartAtBlock,
  FlowchartAtEntry,
  FlowchartBracketShape,
  FlowchartClassOperator,
  FlowchartLabel,
  FlowchartNodeTerm,
  FlowchartOpaqueReason,
  FlowchartToken,
} from "./flowchart-types";

// Parsers for the pieces a node is written with: id, bracket shape and label, `@{}` block,
// `:::class`. Written from the behaviour measured against Mermaid 12.1.0,
// anything not understood is a failure with a reason.

// The reason a character that cannot start or continue an id is reported with.
export function reasonForUnreadableCharacter(
  character: string | undefined,
): FlowchartOpaqueReason {
  if (character === undefined) return "unrecognizedStatement";
  if (/\s/u.test(character) && !isBlankCharacter(character)) {
    return "nonAsciiWhitespace";
  }
  if (
    FLOWCHART_FOREIGN_ID_CHARACTER_PATTERN.test(character) ||
    FLOWCHART_WORD_CHARACTER_PATTERN.test(character)
  ) {
    return "unsupportedId";
  }
  return "unrecognizedStatement";
}

function startsWithKeywordLikeId(id: string): boolean {
  return FLOWCHART_KEYWORD_PREFIXES.some((keyword) => {
    if (!id.startsWith(keyword)) return false;
    const following = id.charAt(keyword.length);
    return (
      following !== "" && !FLOWCHART_WORD_CHARACTER_PATTERN.test(following)
    );
  });
}

// Reads an id at `position` and applies the id rules shared by every id position (node,
// subgraph, class target, edge id).
// `separator` is a character that may follow the id because it belongs to the surrounding
// syntax (the comma of `class A,B name`); otherwise it would count as part of a foreign id.
export function readId(
  scan: Scan,
  position: number,
  separator?: string,
): ParseOutcome<FlowchartToken> {
  FLOWCHART_ID_PATTERN.lastIndex = position;
  const match = FLOWCHART_ID_PATTERN.exec(scan.text);
  if (match === null) {
    return failed(reasonForUnreadableCharacter(scan.text[position]));
  }
  const id = match[0];
  const end = position + id.length;
  const next = scan.text.charAt(end);
  // Mermaid's id alphabet includes `.`, so a dot that is not followed by an id character
  // still belongs to the id (`A.->B` is a syntax error, not a dotted link).
  if (next === ".") return failed("unsupportedId");
  if (/\s/u.test(next) && !isBlankCharacter(next)) {
    return failed("nonAsciiWhitespace");
  }
  if (
    next !== "" &&
    next !== separator &&
    FLOWCHART_FOREIGN_ID_CHARACTER_PATTERN.test(next) &&
    !scan.text.startsWith(FLOWCHART_CLASS_OPERATOR, end)
  ) {
    return failed("unsupportedId");
  }
  if (FLOWCHART_RESERVED_IDS.has(id)) return failed("reservedId");
  if (startsWithKeywordLikeId(id)) return failed("keywordLikeId");
  return parsed(tokenOf(scan, position, end), end);
}

// Mermaid reads a lone `x` or `o` that starts a token and touches a link as part of that
// link (`A --> x-->B` is a syntax error), so the reader refuses it rather than guess.
function isAmbiguousLinkBoundary(scan: Scan, id: FlowchartToken, end: number) {
  return (
    id.text.length === 1 &&
    (FLOWCHART_LINK_ADJACENT_ID_CHARACTERS as readonly string[]).includes(
      id.text,
    ) &&
    FLOWCHART_LINK_START_CHARACTERS.includes(scan.text.charAt(end)) &&
    scan.text.charAt(end) !== ""
  );
}

// A double-quoted label starting at `position` (which holds the quote). `\`text\`` is a
// markdown label. Mermaid trims the text; the spans keep the text as written.
export function readQuotedLabel(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartLabel> {
  const close = scan.text.indexOf(FLOWCHART_STRING_QUOTE, position + 1);
  if (close === -1) return failed("unterminatedQuote");
  const inner = scan.text.slice(position + 1, close);
  const isMarkdown =
    inner.length >= 2 &&
    inner.startsWith(FLOWCHART_MARKDOWN_QUOTE) &&
    inner.endsWith(FLOWCHART_MARKDOWN_QUOTE);
  const body = isMarkdown ? inner.slice(1, -1) : inner;
  if (body.includes(FLOWCHART_MARKDOWN_QUOTE)) return failed("backtickInLabel");
  if (body.length === 0) return failed("emptyLabel");
  const contentStart = position + 1 + (isMarkdown ? 1 : 0);
  const contentEnd = contentStart + body.length;
  return parsed(
    {
      text: scan.text.slice(position, close + 1),
      span: spanOf(scan, position, close + 1),
      content: tokenOf(scan, contentStart, contentEnd),
      value: body.trim(),
      labelType: isMarkdown ? "markdown" : "text",
      quoted: true,
    },
    close + 1,
  );
}

// Unquoted label text between `start` and `end`: Mermaid trims it, and it cannot hold the
// characters that would be read as syntax.
export function readUnquotedLabel(
  scan: Scan,
  start: number,
  end: number,
  forbidden: RegExp = FLOWCHART_UNQUOTED_LABEL_FORBIDDEN_PATTERN,
): ParseOutcome<FlowchartLabel> {
  const raw = scan.text.slice(start, end);
  if (raw.length === 0) return failed("emptyLabel");
  if (raw.includes(FLOWCHART_MARKDOWN_QUOTE)) return failed("backtickInLabel");
  if (forbidden.test(raw)) return failed("specialCharsInLabel");
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  const contentStart = leading === raw.length ? start : start + leading;
  const contentEnd = leading === raw.length ? start : end - trailing;
  return parsed(
    {
      text: scan.text.slice(contentStart, contentEnd),
      span: spanOf(scan, contentStart, contentEnd),
      content: tokenOf(scan, contentStart, contentEnd),
      value: raw.trim(),
      labelType: "text",
      quoted: false,
    },
    end,
  );
}

function readBracketShape(
  scan: Scan,
  position: number,
  form: FlowchartBracketForm,
): ParseOutcome<FlowchartBracketShape> {
  const openerEnd = position + form.opener.length;
  // A blank between the bracket and the quote makes Mermaid lex the label differently
  // (entities and `<` then fail), so a quote must follow the bracket directly; otherwise the
  // text is an unquoted label, which cannot contain a quote.
  let cursor = openerEnd;
  let label: FlowchartLabel;
  let closer: { text: string; shape: FlowchartBracketShape["shape"] };
  let closerStart: number;
  if (scan.text[cursor] === FLOWCHART_STRING_QUOTE) {
    const quoted = readQuotedLabel(scan, cursor);
    if (!quoted.ok) return quoted;
    label = quoted.value;
    cursor = quoted.end;
    const matching = form.closers.find((candidate) =>
      scan.text.startsWith(candidate.text, cursor),
    );
    if (matching === undefined) return failed("unterminatedBracket");
    closer = matching;
    closerStart = cursor;
  } else {
    let earliest = -1;
    let earliestCloser = form.closers[0];
    for (const candidate of form.closers) {
      const at = scan.text.indexOf(candidate.text, cursor);
      if (at !== -1 && (earliest === -1 || at < earliest)) {
        earliest = at;
        earliestCloser = candidate;
      }
    }
    if (earliest === -1 || earliestCloser === undefined) {
      return failed("unterminatedBracket");
    }
    const unquoted = readUnquotedLabel(scan, openerEnd, earliest);
    if (!unquoted.ok) return unquoted;
    label = unquoted.value;
    closer = earliestCloser;
    closerStart = earliest;
  }
  const closerEnd = closerStart + closer.text.length;
  return parsed(
    {
      shape: closer.shape,
      opener: tokenOf(scan, position, openerEnd),
      closer: tokenOf(scan, closerStart, closerEnd),
      label,
      text: scan.text.slice(position, closerEnd),
      span: spanOf(scan, position, closerEnd),
    },
    closerEnd,
  );
}

// The characters between `{` and the matching `}` of an `@{ ... }` block that starts at
// `position`. Quotes hide braces; nesting is counted.
function findAtBlockEnd(text: string, position: number): number {
  // `position` is the opening brace.
  let depth = 1;
  let quote: string | null = null;
  for (let index = position + 1; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

// Splits the body of an `@{}` block at the commas outside quotes.
function splitAtBlockBody(
  body: string,
): readonly { start: number; end: number }[] | null {
  const parts: { start: number; end: number }[] = [];
  let partStart = 0;
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const character = body.charAt(index);
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ",") {
      parts.push({ start: partStart, end: index });
      partStart = index + 1;
    }
  }
  if (quote !== null) return null;
  if (body.slice(partStart).trim() !== "") {
    parts.push({ start: partStart, end: body.length });
  }
  return parts;
}

// `start` and `end` are offsets into scan.text.
function readAtEntry(
  scan: Scan,
  start: number,
  end: number,
): ParseOutcome<FlowchartAtEntry> {
  const raw = scan.text.slice(start, end);
  if (raw.includes("\\")) return failed("atBlockEscape");
  const keyStart = start + (raw.length - raw.trimStart().length);
  const colon = scan.text.indexOf(":", keyStart);
  if (colon === -1 || colon >= end) return failed("atBlockMalformed");
  let keyEnd = colon;
  while (keyEnd > keyStart && isBlankCharacter(scan.text[keyEnd - 1])) {
    keyEnd -= 1;
  }
  const key = scan.text.slice(keyStart, keyEnd);
  if (!FLOWCHART_AT_BLOCK_KEY_PATTERN.test(key))
    return failed("atBlockMalformed");
  // YAML reads `key:value` (no blank after the colon) as one plain key without a value.
  if (!isBlankCharacter(scan.text[colon + 1]))
    return failed("atBlockMalformed");
  const valueStart = skipBlanks(scan.text, colon + 1);
  let valueEnd = end;
  while (valueEnd > valueStart && isBlankCharacter(scan.text[valueEnd - 1])) {
    valueEnd -= 1;
  }
  if (valueEnd <= valueStart) return failed("atBlockMalformed");
  const rawValue = scan.text.slice(valueStart, valueEnd);
  let quoted = false;
  let valueToken: FlowchartToken;
  if (rawValue.startsWith('"')) {
    if (rawValue.length < 2 || !rawValue.endsWith('"')) {
      return failed("atBlockMalformed");
    }
    const inner = rawValue.slice(1, -1);
    if (inner.includes('"')) return failed("atBlockMalformed");
    if (inner.length === 0) return failed("atBlockUnsupportedValue");
    quoted = true;
    valueToken = tokenOf(scan, valueStart + 1, valueEnd - 1);
  } else {
    if (!FLOWCHART_AT_BLOCK_BARE_VALUE_PATTERN.test(rawValue)) {
      return failed("atBlockUnsupportedValue");
    }
    valueToken = tokenOf(scan, valueStart, valueEnd);
  }
  return parsed(
    {
      key: tokenOf(scan, keyStart, keyEnd),
      value: valueToken,
      quoted,
      text: scan.text.slice(keyStart, valueEnd),
      span: spanOf(scan, keyStart, valueEnd),
    },
    end,
  );
}

// `@{ key: value, ... }` on one line, starting at `position` (the `@`). Single quotes,
// escapes, multi-line blocks and values other than a plain word or a double-quoted string
// are refused: YAML has more ways to say things than the reader can check.
export function readAtBlock(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartAtBlock> {
  const open = position + FLOWCHART_AT_BLOCK_OPEN.length - 1;
  const close = findAtBlockEnd(scan.text, open);
  if (close === -1) return failed("unterminatedAtBlock");
  const bodyStart = open + 1;
  const bodyText = scan.text.slice(bodyStart, close);
  if (bodyText.includes("'")) return failed("atBlockUnsupportedValue");
  if (bodyText.includes("{") || bodyText.includes("}")) {
    return failed("atBlockMalformed");
  }
  if (bodyText.trim() === "") return failed("atBlockMalformed");
  const split = splitAtBlockBody(bodyText);
  if (split === null) return failed("atBlockMalformed");
  const entries: FlowchartAtEntry[] = [];
  for (const part of split) {
    const entry = readAtEntry(
      scan,
      bodyStart + part.start,
      bodyStart + part.end,
    );
    if (!entry.ok) return entry;
    entries.push(entry.value);
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key.text)) return failed("atBlockDuplicateKey");
    seen.add(entry.key.text);
  }
  const end = close + 1;
  return parsed(
    {
      entries,
      body: tokenOf(scan, bodyStart, close),
      text: scan.text.slice(position, end),
      span: spanOf(scan, position, end),
    },
    end,
  );
}

// A class name is written like an id (so `--x` is not one), with the same reserved words.
export function readClassName(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartToken> {
  const id = readId(scan, position, ",");
  return id.ok
    ? id
    : failed(id.reason === "unsupportedId" ? "unsupportedId" : id.reason);
}

function readClassOperator(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartClassOperator> {
  const nameStart = position + FLOWCHART_CLASS_OPERATOR.length;
  const name = readClassName(scan, nameStart);
  if (!name.ok) return name;
  const end = name.end;
  return parsed(
    {
      name: tokenOf(scan, nameStart, end),
      text: scan.text.slice(position, end),
      span: spanOf(scan, position, end),
    },
    end,
  );
}

// One node as written inside a statement: id, then optionally a bracket shape or an `@{}`
// block (not both), then optionally `:::class`. Nothing may separate these pieces.
export function readNodeTerm(
  scan: Scan,
  position: number,
): ParseOutcome<FlowchartNodeTerm> {
  const id = readId(scan, position);
  if (!id.ok) return id;
  let cursor = id.end;
  if (isAmbiguousLinkBoundary(scan, id.value, cursor)) {
    return failed("ambiguousLinkBoundary");
  }
  let shape: FlowchartBracketShape | null = null;
  let atBlock: FlowchartAtBlock | null = null;
  if (scan.text.startsWith(FLOWCHART_AT_BLOCK_OPEN, cursor)) {
    const block = readAtBlock(scan, cursor);
    if (!block.ok) return block;
    atBlock = block.value;
    cursor = block.end;
  } else if (scan.text.startsWith(FLOWCHART_PROPS_SHAPE_OPENER, cursor)) {
    return failed("propsShape");
  } else {
    const form = FLOWCHART_BRACKET_FORMS.find((candidate) =>
      scan.text.startsWith(candidate.opener, cursor),
    );
    if (form !== undefined) {
      const bracket = readBracketShape(scan, cursor, form);
      if (!bracket.ok) return bracket;
      shape = bracket.value;
      cursor = bracket.end;
    }
  }
  let classOperator: FlowchartClassOperator | null = null;
  if (
    atBlock === null &&
    scan.text.startsWith(FLOWCHART_CLASS_OPERATOR, cursor)
  ) {
    const operator = readClassOperator(scan, cursor);
    if (!operator.ok) return operator;
    classOperator = operator.value;
    cursor = operator.end;
  }
  return parsed(
    {
      id: id.value,
      shape,
      atBlock,
      classOperator,
      text: scan.text.slice(position, cursor),
      span: spanOf(scan, position, cursor),
    },
    cursor,
  );
}
