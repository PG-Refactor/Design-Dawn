import type { TextEdit } from "../text-edit";
import { SEQUENCE_STATEMENT_SEPARATOR } from "./sequence-config";
import {
  SEQUENCE_DEFAULT_INDENT,
  SEQUENCE_DEFAULT_LINE_ENDING,
  SEQUENCE_INLINE_SEPARATOR,
} from "./sequence-operation-config";
import type { SequenceReading } from "./sequence-reader";
import type { SequenceStatement } from "./sequence-types";

// Whole-line edits and the facts about the file's layout that make a new line look like its
// neighbours. Nothing here reformats existing text.

// The line break most lines end with, so a line added to a CRLF file is CRLF. A tie, or a
// file without any line break, uses the default.
export function dominantLineEnding(reading: SequenceReading): string {
  let crlf = 0;
  let lineFeed = 0;
  for (const line of reading.lines) {
    if (line.terminator === "\r\n") crlf += 1;
    else if (line.terminator === "\n") lineFeed += 1;
  }
  return crlf > lineFeed ? "\r\n" : SEQUENCE_DEFAULT_LINE_ENDING;
}

export function indentOfLine(
  reading: SequenceReading,
  lineIndex: number,
): string {
  const line = reading.lines[lineIndex];
  if (line === undefined) return SEQUENCE_DEFAULT_INDENT;
  return line.text.slice(0, line.text.length - line.text.trimStart().length);
}

// The indentation of the first statement of the diagram: a statement there is never inside a
// block (a block would have to start on an earlier line), so it is the indentation of the
// top level.
export function topLevelIndent(reading: SequenceReading): string {
  const first = reading.statements[0];
  return first === undefined
    ? SEQUENCE_DEFAULT_INDENT
    : indentOfLine(reading, first.lineIndex);
}

// A new line at the very end of the file: the one place that can never be inside a block.
// A file that ends without a line break keeps ending without one.
export function appendLineEdit(
  reading: SequenceReading,
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

// A new line directly behind a line. When that line is the last one and has no line break,
// the break goes in front of the new line instead, so the file still ends the way it did.
export function insertLineAfterEdit(
  reading: SequenceReading,
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

export function insertLineBeforeEdit(
  reading: SequenceReading,
  lineIndex: number,
  content: string,
): TextEdit {
  const line = reading.lines[lineIndex];
  if (line === undefined) return appendLineEdit(reading, content);
  return {
    start: line.start,
    end: line.start,
    text: content + dominantLineEnding(reading),
  };
}

export function statementsOnLine(
  reading: SequenceReading,
  lineIndex: number,
): readonly SequenceStatement[] {
  return reading.statements.filter(
    (statement) => statement.lineIndex === lineIndex,
  );
}

export function isLastOnLine(
  reading: SequenceReading,
  statement: SequenceStatement,
): boolean {
  const sharing = statementsOnLine(reading, statement.lineIndex);
  return sharing[sharing.length - 1]?.index === statement.index;
}

// True when the line holds this statement and nothing else (a trailing `;` aside), so the
// whole line can go with it. A comment on the line makes it not whole.
export function occupiesWholeLine(
  reading: SequenceReading,
  statement: SequenceStatement,
): boolean {
  const line = reading.lines[statement.lineIndex];
  if (line === undefined || line.kind !== "statement") return false;
  if (statementsOnLine(reading, statement.lineIndex).length !== 1) return false;
  const text = line.text.trim();
  return (
    text === statement.text ||
    text === `${statement.text}${SEQUENCE_STATEMENT_SEPARATOR}`
  );
}

// Deletes whole lines. Neighbouring lines are removed as one range, and when the range
// reaches the last line (which has no terminator to take along) the terminator of the line
// before goes instead, so no dangling line break is left.
export function deleteLinesEdits(
  reading: SequenceReading,
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

// Removes one statement and what only belonged to it: its whole line, or its separator when
// other statements share the line, or just the statement when a comment shares the line.
export function removeStatementEdits(
  reading: SequenceReading,
  statement: SequenceStatement,
): readonly TextEdit[] {
  if (occupiesWholeLine(reading, statement)) {
    return deleteLinesEdits(reading, new Set([statement.lineIndex]));
  }
  const sharing = statementsOnLine(reading, statement.lineIndex);
  const position = sharing.findIndex(
    (other) => other.index === statement.index,
  );
  const next = sharing[position + 1];
  const previous = sharing[position - 1];
  if (next !== undefined) {
    return [{ start: statement.span.start, end: next.span.start, text: "" }];
  }
  if (previous !== undefined) {
    return [{ start: previous.span.end, end: statement.span.end, text: "" }];
  }
  // Alone, with a comment behind it: only the statement (and its `;`) goes.
  const after = reading.source[statement.span.end];
  return [
    {
      start: statement.span.start,
      end:
        statement.span.end + (after === SEQUENCE_STATEMENT_SEPARATOR ? 1 : 0),
      text: "",
    },
  ];
}

// `participant X` statements written where `statement` stands, in front of it: one line each
// when the statement has its line to itself, otherwise inline (`participant X; participant Y;
// ` in front of the statement) so nothing else on the line moves.
export function insertStatementsBeforeEdit(
  reading: SequenceReading,
  statement: SequenceStatement,
  texts: readonly string[],
): TextEdit {
  if (occupiesWholeLine(reading, statement)) {
    const indent = indentOfLine(reading, statement.lineIndex);
    const ending = dominantLineEnding(reading);
    const line = reading.lines[statement.lineIndex];
    const start = line?.start ?? statement.span.start;
    return {
      start,
      end: start,
      text: texts.map((text) => `${indent}${text}${ending}`).join(""),
    };
  }
  return {
    start: statement.span.start,
    end: statement.span.start,
    text: `${texts.join(SEQUENCE_INLINE_SEPARATOR)}${SEQUENCE_INLINE_SEPARATOR}`,
  };
}

// The statement is replaced by the given statements (whole line, or inline when the line is
// shared).
export function replaceStatementEdit(
  reading: SequenceReading,
  statement: SequenceStatement,
  texts: readonly string[],
): TextEdit {
  const line = reading.lines[statement.lineIndex];
  if (line !== undefined && occupiesWholeLine(reading, statement)) {
    const indent = indentOfLine(reading, statement.lineIndex);
    const ending = dominantLineEnding(reading);
    return {
      start: line.start,
      end: line.end,
      text: texts.map((text) => `${indent}${text}`).join(ending),
    };
  }
  return {
    start: statement.span.start,
    end: statement.span.end,
    text: texts.join(SEQUENCE_INLINE_SEPARATOR),
  };
}

// The whitespace one level of nesting adds in this file: the first statement that stands
// inside a block shows it. A file with no block yet uses its own top-level indentation.
export function indentUnitOf(reading: SequenceReading): string {
  const headerIndents: string[] = [];
  for (const statement of reading.statements) {
    if (statement.kind === "blockEnd") {
      headerIndents.pop();
      continue;
    }
    const indent = indentOfLine(reading, statement.lineIndex);
    const parent = headerIndents[headerIndents.length - 1];
    if (
      statement.kind !== "branch" &&
      parent !== undefined &&
      indent.length > parent.length &&
      indent.startsWith(parent)
    ) {
      return indent.slice(parent.length);
    }
    if (statement.kind === "blockStart") headerIndents.push(indent);
  }
  const top = topLevelIndent(reading);
  return top === "" ? SEQUENCE_DEFAULT_INDENT : top;
}

export function leadingWhitespaceLength(text: string): number {
  return text.length - text.trimStart().length;
}

// True when no other statement stands in front of this one on its line.
export function isFirstOnLine(
  reading: SequenceReading,
  statement: SequenceStatement,
): boolean {
  return (
    statementsOnLine(reading, statement.lineIndex)[0]?.index === statement.index
  );
}

// Insertions gathered by offset: two insertions at one offset are one edit (the order is the
// order they were added in).
export class InsertionSet {
  private readonly byOffset = new Map<number, string>();

  add(offset: number, text: string): void {
    this.byOffset.set(offset, (this.byOffset.get(offset) ?? "") + text);
  }

  edits(): readonly TextEdit[] {
    return [...this.byOffset].map(([offset, text]) => ({
      start: offset,
      end: offset,
      text,
    }));
  }
}
