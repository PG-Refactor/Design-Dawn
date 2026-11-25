// Line edits every diagram editor makes the same way, on the lines of a text as its reader
// keeps them (where each starts and ends, and its line break).

import { itemAt } from "../shared/item-at";
import type { TextEdit } from "./text-edit";

export interface TextLine {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  // "\n", "\r\n", or "" for a last line without a break.
  readonly terminator: string;
}

const CRLF = "\r\n";
const LINE_FEED = "\n";

// The line break most lines end with, so a line added to a CRLF file is CRLF. A tie, or a
// text without any line break, uses `fallback`.
export function dominantLineEnding(
  lines: readonly TextLine[],
  fallback: string,
): string {
  let crlf = 0;
  let lineFeed = 0;
  for (const line of lines) {
    if (line.terminator === CRLF) crlf += 1;
    else if (line.terminator === LINE_FEED) lineFeed += 1;
  }
  return crlf > lineFeed ? CRLF : fallback;
}

// A new line at the very end. A text that ends without a line break keeps ending without
// one; an empty text gets the line with `ending` after it.
export function appendLineEdit(
  lines: readonly TextLine[],
  content: string,
  ending: string,
): TextEdit {
  const last = lines[lines.length - 1];
  if (last === undefined) return { start: 0, end: 0, text: content + ending };
  if (last.terminator === "") {
    return { start: last.end, end: last.end, text: ending + content };
  }
  const at = last.end + last.terminator.length;
  return { start: at, end: at, text: content + ending };
}

// Deletes whole lines. Neighbouring lines are removed as one range, and when the range
// reaches the last line (which has no break to take along) the break of the line before
// goes instead, so no dangling line break is left. Lines that are not there are skipped.
export function deleteLinesEdits(
  lines: readonly TextLine[],
  lineIndexes: ReadonlySet<number>,
): readonly TextEdit[] {
  const sorted = [...lineIndexes]
    .filter((index) => index >= 0 && index < lines.length)
    .sort((left, right) => left - right);
  const edits: TextEdit[] = [];
  let position = 0;
  while (position < sorted.length) {
    const first = sorted[position] as number;
    let last = first;
    while (sorted[position + 1] === last + 1) {
      position += 1;
      last += 1;
    }
    position += 1;
    const firstLine = lines[first] as TextLine;
    const lastLine = lines[last] as TextLine;
    if (lastLine.terminator !== "" || first === 0) {
      edits.push({
        start: firstLine.start,
        end: lastLine.end + lastLine.terminator.length,
        text: "",
      });
    } else {
      // Not the first line, so there is one before it.
      const previous = itemAt(lines, first - 1, firstLine);
      edits.push({ start: previous.end, end: lastLine.end, text: "" });
    }
  }
  return edits;
}
