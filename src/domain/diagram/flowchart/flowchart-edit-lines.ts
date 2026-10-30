import type { TextEdit } from "../text-edit";
import { FLOWCHART_STATEMENT_SEPARATOR } from "./flowchart-config";
import {
  FLOWCHART_DEFAULT_INDENT,
  FLOWCHART_DEFAULT_LINE_ENDING,
} from "./flowchart-operation-config";
import type { FlowchartReading } from "./flowchart-reader";
import type { FlowchartStatement } from "./flowchart-types";

// Whole-line edits: appending a line, deleting lines, and the facts about the file's layout
// that make a new line look like its neighbours. Nothing here reformats existing text.

// The line break most lines end with, so a line added to a CRLF file is CRLF. A tie, or a
// file without any line break, uses the default.
export function dominantLineEnding(reading: FlowchartReading): string {
  let crlf = 0;
  let lineFeed = 0;
  for (const line of reading.lines) {
    if (line.terminator === "\r\n") crlf += 1;
    else if (line.terminator === "\n") lineFeed += 1;
  }
  return crlf > lineFeed ? "\r\n" : FLOWCHART_DEFAULT_LINE_ENDING;
}

// The indentation of the first statement line after the header: a statement there is never
// inside a subgraph (a subgraph would have to start on an earlier line), so it is the
// indentation of the top level.
export function topLevelIndent(reading: FlowchartReading): string {
  const headerIndex = reading.header?.lineIndex ?? -1;
  const line = reading.lines.find(
    (candidate) =>
      candidate.kind === "statement" && candidate.index > headerIndex,
  );
  if (line === undefined) return FLOWCHART_DEFAULT_INDENT;
  return line.text.slice(0, line.text.length - line.text.trimStart().length);
}

// A new line at the very end of the file: the one place that can never be inside a
// subgraph block or in the middle of an edge statement. A file that ends without a line
// break keeps ending without one.
export function appendLineEdit(
  reading: FlowchartReading,
  content: string,
): TextEdit {
  const ending = dominantLineEnding(reading);
  const last = reading.lines[reading.lines.length - 1];
  if (last === undefined) {
    return { start: 0, end: 0, text: content + ending };
  }
  if (last.terminator === "") {
    return { start: last.end, end: last.end, text: ending + content };
  }
  const at = last.end + last.terminator.length;
  return { start: at, end: at, text: content + ending };
}

// True when the line holds this statement and nothing else (a trailing `;` aside), so the
// whole line can go with it. A statement on the header line never qualifies.
export function occupiesWholeLine(
  reading: FlowchartReading,
  statement: FlowchartStatement,
): boolean {
  const line = reading.lines[statement.lineIndex];
  if (line === undefined || line.kind !== "statement") return false;
  const sharing = reading.statements.filter(
    (other) => other.lineIndex === statement.lineIndex,
  );
  if (sharing.length !== 1) return false;
  const text = line.text.trim();
  return (
    text === statement.text ||
    text === `${statement.text}${FLOWCHART_STATEMENT_SEPARATOR}`
  );
}

// Deletes whole lines. Neighbouring lines are removed as one range, and when the range
// reaches the last line (which has no terminator to take along) the terminator of the line
// before goes instead, so no dangling line break is left.
export function deleteLinesEdits(
  reading: FlowchartReading,
  lineIndexes: ReadonlySet<number>,
): readonly TextEdit[] {
  const sorted = [...lineIndexes].sort((left, right) => left - right);
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
    const firstLine = reading.lines[first];
    const lastLine = reading.lines[last];
    if (firstLine === undefined || lastLine === undefined) continue;
    if (lastLine.terminator !== "" || first === 0) {
      edits.push({
        start: firstLine.start,
        end: lastLine.end + lastLine.terminator.length,
        text: "",
      });
    } else {
      const previous = reading.lines[first - 1];
      edits.push({
        start: previous === undefined ? firstLine.start : previous.end,
        end: lastLine.end,
        text: "",
      });
    }
  }
  return edits;
}

// A new line directly before the given line (its first character). Used to put a statement
// in front of a subgraph's `end`, which keeps it inside the block.
export function insertLineBeforeEdit(
  reading: FlowchartReading,
  lineIndex: number,
  content: string,
): TextEdit {
  const line = reading.lines[lineIndex];
  const at = line === undefined ? 0 : line.start;
  return { start: at, end: at, text: content + dominantLineEnding(reading) };
}

// A new line directly after the given line. When that line is the last one and has no line
// break, the break goes before the new line instead, so the file keeps ending the way it did.
export function insertLineAfterEdit(
  reading: FlowchartReading,
  lineIndex: number,
  content: string,
): TextEdit {
  const line = reading.lines[lineIndex];
  if (line === undefined) return appendLineEdit(reading, content);
  const ending = dominantLineEnding(reading);
  if (line.terminator === "") {
    return { start: line.end, end: line.end, text: ending + content };
  }
  const at = line.end + line.terminator.length;
  return { start: at, end: at, text: content + ending };
}

// The leading blanks of a line.
export function indentOfLine(reading: FlowchartReading, lineIndex: number) {
  const line = reading.lines[lineIndex];
  if (line === undefined) return "";
  return line.text.slice(0, line.text.length - line.text.trimStart().length);
}
