import type { TextEdit } from "../text-edit";
import {
  GANTT_DEFAULT_INDENT,
  GANTT_DEFAULT_LINE_ENDING,
} from "./gantt-config";
import type { GanttLine, ParsedGantt } from "./gantt-types";

// Whole-line edits: inserting a line and deleting lines, and the facts about the file's layout
// that make a new line look like its neighbours. Nothing here reformats existing text.

// The line break most lines end with, so a line added to a CRLF file is CRLF.
export function dominantLineEnding(parsed: ParsedGantt): string {
  let crlf = 0;
  let lineFeed = 0;
  for (const line of parsed.lines) {
    if (line.terminator === "\r\n") crlf += 1;
    else if (line.terminator === "\n") lineFeed += 1;
  }
  return crlf > lineFeed ? "\r\n" : GANTT_DEFAULT_LINE_ENDING;
}

export function indentOf(line: GanttLine | undefined): string {
  if (line === undefined) return GANTT_DEFAULT_INDENT;
  return line.text.slice(0, line.text.length - line.text.trimStart().length);
}

// A new line after `lineIndex`. After a last line that has no line break, the break goes in
// front of the new line and the new line has none, so "no newline at the end of the file" is
// preserved.
export function insertLineAfter(
  parsed: ParsedGantt,
  lineIndex: number,
  content: string,
): TextEdit {
  const ending = dominantLineEnding(parsed);
  const line = parsed.lines[lineIndex] as GanttLine;
  if (line.terminator === "") {
    return { start: line.end, end: line.end, text: ending + content };
  }
  const at = line.end + line.terminator.length;
  return { start: at, end: at, text: content + line.terminator };
}

// Deletes whole lines. Neighbouring lines are removed as one range, and when the range
// reaches the last line (which has no terminator to take along) the terminator of the line
// before goes instead, so no dangling line break is left.
export function deleteLinesEdits(
  parsed: ParsedGantt,
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
    const firstLine = parsed.lines[first];
    const lastLine = parsed.lines[last];
    if (firstLine === undefined || lastLine === undefined) continue;
    if (lastLine.terminator !== "" || first === 0) {
      edits.push({
        start: firstLine.start,
        end: lastLine.end + lastLine.terminator.length,
        text: "",
      });
    } else {
      const previous = parsed.lines[first - 1];
      edits.push({
        start: previous === undefined ? firstLine.start : previous.end,
        end: lastLine.end,
        text: "",
      });
    }
  }
  return edits;
}
