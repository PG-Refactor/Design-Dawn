import {
  FLOWCHART_ENTITY_LIKE_PATTERN,
  FLOWCHART_PIPE,
  FLOWCHART_STATEMENT_SEPARATOR,
  FLOWCHART_STRING_QUOTE,
} from "./flowchart-config";
import { isBlankCharacter, skipBlanks } from "./flowchart-scan";

// Cuts one source line into statement segments at the `;` that Mermaid treats as a
// separator. A `;` inside quotes, brackets, braces or a pipe label is label text, and an
// accessibility statement (`accTitle: ...`) owns the rest of its line. Segments are not
// understood here, only delimited; the parsers decide what each one is.

export type SegmentFlag =
  | "none"
  // The line ends inside a double quote: Mermaid would read on into the next line.
  | "unterminatedQuote"
  // `#word;` outside any label: Mermaid replaces it before parsing, and its `;` is not a
  // separator any more.
  | "entityLike"
  | "accessibility"
  // A `;` that ends no statement (leading, doubled, or alone on its line). Mermaid ignores
  // it, except inside a subgraph block where it becomes a member named ";".
  | "stray";

export interface RawSegment {
  // Blank-trimmed text.
  readonly text: string;
  // Offset of text[0] in the source.
  readonly start: number;
  readonly flag: SegmentFlag;
  // Blanks that were trimmed from the end.
  readonly trailingBlanks: number;
}

const ACCESSIBILITY_START_PATTERN = /(?:accTitle|accDescr)[ \t]*[:{]/y;
const OPENING_BRACKETS = "[({";
const CLOSING_BRACKETS = "])}";

function trimmedSegment(
  lineText: string,
  lineStart: number,
  start: number,
  end: number,
  flag: SegmentFlag,
): RawSegment | null {
  let trimmedEnd = end;
  while (trimmedEnd > start && isBlankCharacter(lineText[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }
  if (trimmedEnd <= start) return null;
  return {
    text: lineText.slice(start, trimmedEnd),
    start: lineStart + start,
    flag,
    trailingBlanks: end - trimmedEnd,
  };
}

// `from` is where statements may begin on the line (0, or just after the header's `;`).
// `harmlessTerminators` are line-relative offsets of `;` that Mermaid deletes although they
// only end their statement (see flowchart-source-issues.ts), so they must still separate.
export function splitSegments(
  lineText: string,
  lineStart: number,
  from: number,
  harmlessTerminators: ReadonlySet<number>,
): readonly RawSegment[] {
  const segments: RawSegment[] = [];
  let segmentStart = from;
  while (segmentStart < lineText.length) {
    const first = skipBlanks(lineText, segmentStart);
    if (first >= lineText.length) break;
    if (lineText[first] === FLOWCHART_STATEMENT_SEPARATOR) {
      segments.push({
        text: FLOWCHART_STATEMENT_SEPARATOR,
        start: lineStart + first,
        flag: "stray",
        trailingBlanks: 0,
      });
      segmentStart = first + 1;
      continue;
    }
    ACCESSIBILITY_START_PATTERN.lastIndex = first;
    if (ACCESSIBILITY_START_PATTERN.test(lineText)) {
      const segment = trimmedSegment(
        lineText,
        lineStart,
        first,
        lineText.length,
        "accessibility",
      );
      if (segment !== null) segments.push(segment);
      break;
    }

    let cursor = first;
    let inQuote = false;
    let depth = 0;
    let inPipe = false;
    let flag: SegmentFlag = "none";
    while (cursor < lineText.length) {
      const character = lineText.charAt(cursor);
      if (inQuote) {
        if (character === FLOWCHART_STRING_QUOTE) inQuote = false;
        cursor += 1;
        continue;
      }
      if (character === FLOWCHART_STRING_QUOTE) {
        inQuote = true;
      } else if (OPENING_BRACKETS.includes(character)) {
        depth += 1;
      } else if (CLOSING_BRACKETS.includes(character)) {
        depth = Math.max(0, depth - 1);
      } else if (character === FLOWCHART_PIPE && depth === 0) {
        inPipe = !inPipe;
      } else if (character === "#" && depth === 0 && !inPipe) {
        FLOWCHART_ENTITY_LIKE_PATTERN.lastIndex = cursor;
        const entity = FLOWCHART_ENTITY_LIKE_PATTERN.exec(lineText);
        if (entity !== null) {
          const semicolonAt = cursor + entity[0].length - 1;
          if (!harmlessTerminators.has(semicolonAt)) {
            flag = "entityLike";
            cursor += entity[0].length;
            continue;
          }
        }
      } else if (
        character === FLOWCHART_STATEMENT_SEPARATOR &&
        depth === 0 &&
        !inPipe
      ) {
        break;
      }
      cursor += 1;
    }
    if (inQuote) flag = "unterminatedQuote";
    const segment = trimmedSegment(lineText, lineStart, first, cursor, flag);
    if (segment !== null) segments.push(segment);
    segmentStart = cursor + 1;
  }
  return segments;
}
