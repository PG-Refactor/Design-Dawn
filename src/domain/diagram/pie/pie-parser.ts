import { type DiagramTypeDetection, detectDiagramType } from "../diagram-type";
import {
  type ClassifiedLine,
  classifyLines,
  type LineIssue,
  scanLines,
} from "../source-lines";
import {
  PIE_COMMENT_MARK,
  PIE_DIRECTIVE_MARK,
  PIE_HEADER_KEYWORD,
  PIE_SHOW_DATA_KEYWORD,
  PIE_TITLE_KEYWORD,
} from "./pie-config";
import {
  hasLoneCarriageReturn,
  hasMarkupRewrite,
  hasStyleLikeText,
  normalizePieTitle,
} from "./pie-text";

// Lossless line-level parse of a Mermaid pie chart. Nothing is trimmed or rewritten: every
// piece that an operation may change carries its absolute range (UTF-16 offsets into
// `source`), and the raw text is always `source.slice(range)`. The grammar was read from
// mermaid 12.1.0 (@mermaid-js/parser pie grammar); pie-grammar.real.dom.test.ts holds the
// evidence.

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export type PieLineKind =
  | "blank"
  | "comment"
  | "directive"
  | "frontMatter"
  | "header"
  | "title"
  | "slice"
  | "accTitle"
  | "accDescr"
  | "unsupported";

export interface PieLine {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly terminator: "" | "\n" | "\r\n";
  readonly text: string;
  readonly kind: PieLineKind;
}

export interface PieHeader {
  readonly lineIndex: number;
  readonly keywordSpan: TextSpan;
  readonly showData: boolean;
  readonly showDataSpan: TextSpan | null;
}

export type PieQuote = '"' | "'";

export interface PieSlice {
  readonly lineIndex: number;
  // The text between the quotes, exactly as written (entities such as #quot; undecoded).
  readonly labelText: string;
  readonly labelSpan: TextSpan;
  readonly quote: PieQuote;
  // The key Mermaid stores the slice under: the text between the quotes as written. Mermaid
  // decodes entities only when it draws, so two labels are the same slice exactly when this
  // text is equal (it does not trim).
  readonly label: string;
  readonly valueText: string;
  readonly valueSpan: TextSpan;
  readonly value: number;
}

export interface PieTitle {
  readonly lineIndex: number;
  readonly onHeaderLine: boolean;
  readonly keywordSpan: TextSpan;
  // The trimmed text; empty (and zero-width, at the keyword's end) for a bare `title`.
  readonly textSpan: TextSpan;
  // What Mermaid stores: trimmed, with runs of blanks folded into one space.
  readonly text: string;
}

export type PieUnsupportedReason =
  | "unknownStatement"
  | "invalidSliceSyntax"
  | "invalidValue"
  | "negativeValue"
  | "valueOutOfRange"
  | "backslashInLabel"
  | "sliceOnHeaderLine"
  | "invalidAccessibilitySyntax"
  | "unterminatedAccessibilityBlock"
  | "nonAsciiWhitespace";

export interface PieUnsupportedLine {
  readonly lineIndex: number;
  readonly reason: PieUnsupportedReason;
}

// Properties of the whole text that make a line-based reading unreliable because Mermaid
// rewrites the text before it parses.
export type PieSourceIssueCode =
  | "loneCarriageReturn"
  | "markupRewrite"
  | "styleLikeText"
  | "inlineDirective";

export interface PieSourceIssue {
  readonly code: PieSourceIssueCode;
  // 0-based line indexes the issue was found on (empty for a whole-text property).
  readonly lineIndexes: readonly number[];
}

export interface ParsedPie {
  readonly source: string;
  readonly detection: DiagramTypeDetection;
  // Structure Mermaid cannot be trusted to read the same way (unterminated front matter ...).
  readonly structureIssues: readonly LineIssue[];
  readonly isPie: boolean;
  readonly lines: readonly PieLine[];
  readonly header: PieHeader | null;
  readonly slices: readonly PieSlice[];
  readonly titles: readonly PieTitle[];
  readonly unsupported: readonly PieUnsupportedLine[];
  readonly sourceIssues: readonly PieSourceIssue[];
}

const BLANK_PATTERN = /^[\t ]*$/;
const COMMENT_START_PATTERN = /^[\t ]*%%/;
const DIRECTIVE_START_PATTERN = /^[\t ]*%%\{/;
const HEADER_PATTERN = /^[\t ]*pie/;
const SHOW_DATA_PATTERN = /^[\t ]+showData(?=[\t ]|%%|$)/;
const SLICE_PREFIX_PATTERN =
  /^([\t ]*)("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*')[\t ]*:[\t ]*/;
const FRACTION_VALUE_PATTERN = /^-?[0-9]+\.[0-9]+/;
const INTEGER_VALUE_PATTERN = /^-?(?:0|[1-9][0-9]*)/;
const STATEMENT_TAIL_PATTERN = /^[\t ]*(?:%%.*)?$/;
const TITLE_PATTERN = /^[\t ]*title(?=[\t ]|%%|$)/;
const ACC_TITLE_PATTERN = /^[\t ]*accTitle[\t ]*:/;
const ACC_DESCR_LINE_PATTERN = /^[\t ]*accDescr[\t ]*:/;
const ACC_DESCR_BLOCK_PATTERN = /^[\t ]*accDescr[\t ]*\{/;
const BLOCK_CLOSE = "}";

type ClassifiedKind = ClassifiedLine["kind"];

type MutableLine = {
  -readonly [Key in keyof PieLine]: PieLine[Key];
};

type SegmentResult =
  | { readonly kind: "empty" }
  | {
      readonly kind: "slice";
      readonly slice: Omit<PieSlice, "lineIndex">;
    }
  | {
      readonly kind: "title";
      readonly title: Omit<PieTitle, "lineIndex" | "onHeaderLine">;
    }
  | { readonly kind: "accTitle" }
  | { readonly kind: "accDescr" }
  | { readonly kind: "accDescrBlock"; readonly searchFrom: number }
  | { readonly kind: "unsupported"; readonly reason: PieUnsupportedReason };

function unsupported(reason: PieUnsupportedReason): SegmentResult {
  return { kind: "unsupported", reason };
}

function parseSlice(text: string, base: number): SegmentResult {
  const prefix = SLICE_PREFIX_PATTERN.exec(text);
  if (prefix === null) return unsupported("invalidSliceSyntax");
  const quoted = prefix[2] as string;
  const quote = quoted.charAt(0) as PieQuote;
  const labelText = quoted.slice(1, -1);
  const afterPrefix = text.slice(prefix[0].length);
  const valueMatch =
    FRACTION_VALUE_PATTERN.exec(afterPrefix) ??
    INTEGER_VALUE_PATTERN.exec(afterPrefix);
  if (valueMatch === null) return unsupported("invalidValue");
  const valueText = valueMatch[0];
  if (!STATEMENT_TAIL_PATTERN.test(afterPrefix.slice(valueText.length))) {
    return unsupported("invalidSliceSyntax");
  }
  // Mermaid keeps a backslash sequence as an escape (`\n` is a line break), so the stored
  // key would differ from the written text.
  if (labelText.includes("\\")) return unsupported("backslashInLabel");
  const parsedValue = Number(valueText);
  // `-0` is not below zero, so Mermaid accepts it as 0.
  if (parsedValue < 0) return unsupported("negativeValue");
  if (!Number.isFinite(parsedValue)) return unsupported("valueOutOfRange");
  const labelStart = base + (prefix[1] as string).length + 1;
  const valueStart = base + prefix[0].length;
  return {
    kind: "slice",
    slice: {
      labelText,
      labelSpan: { start: labelStart, end: labelStart + labelText.length },
      quote,
      label: labelText,
      valueText,
      valueSpan: { start: valueStart, end: valueStart + valueText.length },
      value: parsedValue + 0,
    },
  };
}

function parseTitle(text: string, base: number): SegmentResult {
  // The caller has tested TITLE_PATTERN.
  const match = TITLE_PATTERN.exec(text) as RegExpExecArray;
  const keywordEnd = base + match[0].length;
  const afterKeyword = text.slice(match[0].length);
  const commentAt = afterKeyword.indexOf(PIE_COMMENT_MARK);
  const region =
    commentAt === -1 ? afterKeyword : afterKeyword.slice(0, commentAt);
  const trimmed = region.trim();
  const textStart =
    trimmed === ""
      ? keywordEnd
      : keywordEnd + (region.length - region.trimStart().length);
  return {
    kind: "title",
    title: {
      keywordSpan: {
        start: keywordEnd - PIE_TITLE_KEYWORD.length,
        end: keywordEnd,
      },
      textSpan: { start: textStart, end: textStart + trimmed.length },
      text: normalizePieTitle(trimmed),
    },
  };
}

// One statement that starts at `from` (an offset inside the line) and runs to the end of
// the line. `from` is 0 for an ordinary line and the end of `pie [showData]` for the header.
function parseSegment(line: ClassifiedLine, from: number): SegmentResult {
  const text = line.text.slice(from);
  const base = line.start + from;
  if (BLANK_PATTERN.test(text) || COMMENT_START_PATTERN.test(text)) {
    return { kind: "empty" };
  }
  const trimmedStart = text.length - text.replace(/^[\t ]+/, "").length;
  const first = text.charAt(trimmedStart);
  if (first === '"' || first === "'") return parseSlice(text, base);
  if (TITLE_PATTERN.test(text)) return parseTitle(text, base);
  if (ACC_TITLE_PATTERN.test(text)) return { kind: "accTitle" };
  if (ACC_DESCR_LINE_PATTERN.test(text)) return { kind: "accDescr" };
  const block = ACC_DESCR_BLOCK_PATTERN.exec(text);
  if (block !== null)
    return { kind: "accDescrBlock", searchFrom: from + block[0].length };
  return unsupported("unknownStatement");
}

export function parsePie(source: string): ParsedPie {
  const detection = detectDiagramType(source);
  const classification = classifyLines(scanLines(source));
  const classified = classification.lines;
  const lines: MutableLine[] = classified.map((line) => ({
    index: line.index,
    start: line.start,
    end: line.end,
    terminator: line.terminator,
    text: line.text,
    kind: "unsupported",
  }));
  const isPie = detection.kind === "known" && detection.type === "pie";
  const slices: PieSlice[] = [];
  const titles: PieTitle[] = [];
  const unsupportedLines: PieUnsupportedLine[] = [];
  let header: PieHeader | null = null;

  const markUnsupported = (lineIndex: number, reason: PieUnsupportedReason) => {
    (lines[lineIndex] as MutableLine).kind = "unsupported";
    unsupportedLines.push({ lineIndex, reason });
  };

  // Handles the statement of `lineIndex` that starts at `from`; returns the index of the
  // next line to look at (an accDescr block consumes several lines).
  const handleStatement = (
    lineIndex: number,
    from: number,
    onHeaderLine: boolean,
  ): number => {
    const line = classified[lineIndex] as ClassifiedLine;
    const result = parseSegment(line, from);
    const target = lines[lineIndex] as MutableLine;
    const kindOnLine = (kind: PieLineKind) => {
      if (!onHeaderLine) target.kind = kind;
    };
    switch (result.kind) {
      case "empty":
        if (!onHeaderLine) {
          target.kind = BLANK_PATTERN.test(line.text) ? "blank" : "comment";
        }
        return lineIndex + 1;
      case "slice":
        if (onHeaderLine) {
          markUnsupported(lineIndex, "sliceOnHeaderLine");
        } else {
          target.kind = "slice";
          slices.push({ lineIndex, ...result.slice });
        }
        return lineIndex + 1;
      case "title":
        kindOnLine("title");
        titles.push({ lineIndex, onHeaderLine, ...result.title });
        return lineIndex + 1;
      case "accTitle":
        kindOnLine("accTitle");
        return lineIndex + 1;
      case "accDescr":
        kindOnLine("accDescr");
        return lineIndex + 1;
      case "accDescrBlock":
        return handleAccessibilityBlock(
          lineIndex,
          result.searchFrom,
          onHeaderLine,
        );
      case "unsupported":
        markUnsupported(lineIndex, result.reason);
        return lineIndex + 1;
    }
  };

  // `accDescr {` runs to the first `}`, which may be on a later line. What follows the `}`
  // on its line must be nothing or a comment, as for any other statement.
  const handleAccessibilityBlock = (
    openLineIndex: number,
    searchFrom: number,
    onHeaderLine: boolean,
  ): number => {
    let lineIndex = openLineIndex;
    let offset = searchFrom;
    while (lineIndex < classified.length) {
      const text = (classified[lineIndex] as ClassifiedLine).text;
      const closeAt = text.indexOf(BLOCK_CLOSE, offset);
      if (closeAt !== -1) {
        if (!STATEMENT_TAIL_PATTERN.test(text.slice(closeAt + 1))) {
          markUnsupported(openLineIndex, "invalidAccessibilitySyntax");
          return openLineIndex + 1;
        }
        for (let index = openLineIndex; index <= lineIndex; index += 1) {
          if (!(onHeaderLine && index === openLineIndex)) {
            (lines[index] as MutableLine).kind = "accDescr";
          }
        }
        return lineIndex + 1;
      }
      lineIndex += 1;
      offset = 0;
    }
    markUnsupported(openLineIndex, "unterminatedAccessibilityBlock");
    return openLineIndex + 1;
  };

  const parseHeader = (lineIndex: number): number => {
    const line = classified[lineIndex] as ClassifiedLine;
    const keyword = HEADER_PATTERN.exec(line.text);
    if (keyword === null) {
      markUnsupported(lineIndex, "nonAsciiWhitespace");
      return lineIndex + 1;
    }
    const keywordEnd = keyword[0].length;
    const showData = SHOW_DATA_PATTERN.exec(line.text.slice(keywordEnd));
    const showDataEnd =
      showData === null ? keywordEnd : keywordEnd + showData[0].length;
    (lines[lineIndex] as MutableLine).kind = "header";
    header = {
      lineIndex,
      keywordSpan: {
        start: line.start + keywordEnd - PIE_HEADER_KEYWORD.length,
        end: line.start + keywordEnd,
      },
      showData: showData !== null,
      showDataSpan:
        showData === null
          ? null
          : {
              start: line.start + showDataEnd - PIE_SHOW_DATA_KEYWORD.length,
              end: line.start + showDataEnd,
            },
    };
    return handleStatement(lineIndex, showDataEnd, true);
  };

  if (isPie) {
    let index = 0;
    while (index < classified.length) {
      const line = classified[index] as ClassifiedLine;
      const target = lines[index] as MutableLine;
      const kind: ClassifiedKind = line.kind;
      if (kind === "frontMatter") {
        target.kind = "frontMatter";
        index += 1;
      } else if (kind === "directive") {
        if (DIRECTIVE_START_PATTERN.test(line.text)) {
          target.kind = "directive";
        } else {
          markUnsupported(index, "nonAsciiWhitespace");
        }
        index += 1;
      } else if (kind === "blank" || kind === "comment") {
        const wellFormed =
          kind === "blank"
            ? BLANK_PATTERN.test(line.text)
            : COMMENT_START_PATTERN.test(line.text);
        if (wellFormed) {
          target.kind = kind;
        } else {
          markUnsupported(index, "nonAsciiWhitespace");
        }
        index += 1;
      } else if (kind === "header") {
        index = parseHeader(index);
      } else {
        index = handleStatement(index, 0, false);
      }
    }
  }

  return {
    source,
    detection,
    structureIssues: classification.issues,
    isPie,
    lines,
    header,
    slices,
    titles,
    unsupported: unsupportedLines,
    sourceIssues: isPie ? findSourceIssues(source, lines) : [],
  };
}

function findSourceIssues(
  source: string,
  lines: readonly PieLine[],
): readonly PieSourceIssue[] {
  const issues: PieSourceIssue[] = [];
  if (hasLoneCarriageReturn(source)) {
    issues.push({ code: "loneCarriageReturn", lineIndexes: [] });
  }
  if (hasMarkupRewrite(source)) {
    issues.push({ code: "markupRewrite", lineIndexes: [] });
  }
  if (hasStyleLikeText(source)) {
    issues.push({ code: "styleLikeText", lineIndexes: [] });
  }
  const directiveLines = lines
    .filter(
      (line) =>
        line.kind !== "directive" &&
        line.kind !== "frontMatter" &&
        line.text.includes(PIE_DIRECTIVE_MARK),
    )
    .map((line) => line.index);
  if (directiveLines.length > 0) {
    issues.push({ code: "inlineDirective", lineIndexes: directiveLines });
  }
  return issues;
}
