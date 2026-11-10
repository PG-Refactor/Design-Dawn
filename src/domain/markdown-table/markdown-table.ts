// GitHub-flavoured Markdown tables inside a Markdown source: finding the table under the
// caret, changing its rows / columns / alignment, and writing it back. The text stays the
// source of truth: an operation rewrites only the table's own lines, and a table this
// module does not fully understand is not offered for editing at all.

export type ColumnAlignment = "none" | "left" | "center" | "right";

export interface MarkdownTable {
  readonly header: readonly string[];
  readonly alignments: readonly ColumnAlignment[];
  // Each body row has exactly as many cells as the header.
  readonly rows: readonly (readonly string[])[];
}

// Where the caret is in the table: `row` null means the header (or the delimiter line).
export interface TableCell {
  readonly row: number | null;
  readonly column: number;
}

export interface TableLocation {
  // Zero-based line index of the header and the number of lines the table spans.
  readonly firstLine: number;
  readonly lineCount: number;
  readonly table: MarkdownTable;
  readonly cell: TableCell;
}

export interface TableEditResult {
  readonly text: string;
  // Offset of the start of the cell the caret should land in.
  readonly caret: number;
}

const LINE_BREAK = "\n";
const CELL_SEPARATOR = "|";
const ESCAPE = "\\";
const DELIMITER_CELL = /^:?-+:?$/;
const ALIGNMENT_MARK = ":";
// A column is at least three characters wide, so the delimiter cell always has room for
// its alignment colons and at least one dash.
const MIN_DELIMITER_DASHES = 3;
const MIN_DASHES = 1;
// Up to three leading spaces still start a block; four make an indented code block.
const MAX_BLOCK_INDENT = 3;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TAB = "\t";
const CARRIAGE_RETURN = "\r";
const QUOTE = '"';
// Spreadsheets copy a rectangle of at least a header and one row, two columns wide.
const MIN_PASTED_ROWS = 2;
const MIN_PASTED_COLUMNS = 2;
// East Asian wide and fullwidth characters take two columns in a monospaced editor.
const WIDE_CHARACTER =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;
const WIDE_CHARACTER_COLUMNS = 2;

function isEscaped(line: string, index: number): boolean {
  let backslashes = 0;
  for (let position = index - 1; position >= 0; position -= 1) {
    if (line[position] !== ESCAPE) break;
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

// Offsets of the separators that split cells (an escaped `\|` is part of a cell).
function separatorOffsets(line: string): number[] {
  const offsets: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === CELL_SEPARATOR && !isEscaped(line, index)) {
      offsets.push(index);
    }
  }
  return offsets;
}

function leadingIndent(line: string): number {
  return line.length - line.trimStart().length;
}

// The cells of one table line, without the optional outer pipes. Null when the line is not
// a table line at all.
function splitRow(line: string): string[] | null {
  if (leadingIndent(line) > MAX_BLOCK_INDENT) return null;
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const offsets = separatorOffsets(trimmed);
  if (offsets.length === 0) return null;
  const cells: string[] = [];
  let start = 0;
  for (const offset of offsets) {
    cells.push(trimmed.slice(start, offset));
    start = offset + 1;
  }
  cells.push(trimmed.slice(start));
  if (trimmed.startsWith(CELL_SEPARATOR)) cells.shift();
  if (
    trimmed.endsWith(CELL_SEPARATOR) &&
    !isEscaped(trimmed, trimmed.length - 1)
  )
    cells.pop();
  return cells.map((cell) => cell.trim());
}

function alignmentOf(cell: string): ColumnAlignment | null {
  if (!DELIMITER_CELL.test(cell)) return null;
  const left = cell.startsWith(ALIGNMENT_MARK);
  const right = cell.endsWith(ALIGNMENT_MARK);
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

// Which lines are inside a fenced code block (where nothing is a table).
function fencedLines(lines: readonly string[]): boolean[] {
  const inside: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line)?.[1] ?? null;
    if (open === null) {
      inside.push(fence !== null);
      if (fence !== null) open = fence;
      continue;
    }
    inside.push(true);
    if (
      fence !== null &&
      fence[0] === open[0] &&
      fence.length >= open.length &&
      line.trim() === fence
    ) {
      open = null;
    }
  }
  return inside;
}

function parseTableLines(lines: readonly string[]): MarkdownTable | null {
  const [headerLine, delimiterLine, ...bodyLines] = lines;
  if (headerLine === undefined || delimiterLine === undefined) return null;
  const header = splitRow(headerLine);
  const delimiter = splitRow(delimiterLine);
  if (header === null || delimiter === null) return null;
  if (header.length !== delimiter.length || header.length === 0) return null;
  const alignments: ColumnAlignment[] = [];
  for (const cell of delimiter) {
    const alignment = alignmentOf(cell);
    if (alignment === null) return null;
    alignments.push(alignment);
  }
  const rows: string[][] = [];
  for (const line of bodyLines) {
    const cells = splitRow(line);
    if (cells === null) return null;
    // Extra cells are dropped by Markdown renderers; editing would lose them for good.
    if (cells.length > header.length) return null;
    rows.push([
      ...cells,
      ...Array.from({ length: header.length - cells.length }, () => ""),
    ]);
  }
  return { header, alignments, rows };
}

function lineStartOffsets(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + LINE_BREAK.length;
  }
  return starts;
}

function lineIndexAt(starts: readonly number[], offset: number): number {
  let index = 0;
  for (let candidate = 0; candidate < starts.length; candidate += 1) {
    if ((starts[candidate] ?? 0) <= offset) index = candidate;
  }
  return index;
}

function columnAt(
  line: string,
  offsetInLine: number,
  columnCount: number,
): number {
  const trimmedStart = leadingIndent(line);
  const separators = separatorOffsets(line).filter(
    (offset) => offset < offsetInLine,
  );
  const startsWithPipe = line.trimStart().startsWith(CELL_SEPARATOR);
  const leadingPipeBeforeCaret =
    startsWithPipe && offsetInLine > trimmedStart ? 1 : 0;
  const column = separators.length - leadingPipeBeforeCaret;
  return Math.min(Math.max(column, 0), columnCount - 1);
}

// The table the caret is in, or null when the caret is not in a table this module can edit
// (inside code, in a blockquote or list, or with rows wider than the header).
export function findTableAt(
  source: string,
  caret: number,
): TableLocation | null {
  const lines = source.split(LINE_BREAK);
  const starts = lineStartOffsets(lines);
  const caretLine = lineIndexAt(starts, caret);
  const fenced = fencedLines(lines);
  const isCandidate = (index: number) =>
    !fenced[index] && splitRow(lines[index] ?? "") !== null;
  if (!isCandidate(caretLine)) return null;
  let first = caretLine;
  while (first > 0 && isCandidate(first - 1)) first -= 1;
  let last = caretLine;
  while (last < lines.length - 1 && isCandidate(last + 1)) last += 1;
  const table = parseTableLines(lines.slice(first, last + 1));
  if (table === null) return null;
  const rowIndex = caretLine - first;
  const caretLineText = lines[caretLine] ?? "";
  return {
    firstLine: first,
    lineCount: last - first + 1,
    table,
    cell: {
      // Line 0 is the header and line 1 the delimiter; body rows follow.
      row: rowIndex <= 1 ? null : rowIndex - 2,
      column: columnAt(
        caretLineText,
        caret - (starts[caretLine] ?? 0),
        table.header.length,
      ),
    },
  };
}

function visualWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width += WIDE_CHARACTER.test(character) ? WIDE_CHARACTER_COLUMNS : 1;
  }
  return width;
}

function padCell(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(width - visualWidth(text), 0))}`;
}

function delimiterCell(alignment: ColumnAlignment, width: number): string {
  const marks =
    (alignment === "left" || alignment === "center" ? 1 : 0) +
    (alignment === "right" || alignment === "center" ? 1 : 0);
  const dashes = "-".repeat(Math.max(width - marks, MIN_DASHES));
  switch (alignment) {
    case "left":
      return `${ALIGNMENT_MARK}${dashes}`;
    case "right":
      return `${dashes}${ALIGNMENT_MARK}`;
    case "center":
      return `${ALIGNMENT_MARK}${dashes}${ALIGNMENT_MARK}`;
    case "none":
      return dashes;
  }
}

function joinCells(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

// The table as lines, columns padded to a common width so the source reads as a grid.
export function formatTable(table: MarkdownTable): string[] {
  const widths = table.header.map((cell, column) =>
    Math.max(
      MIN_DELIMITER_DASHES,
      visualWidth(cell),
      ...table.rows.map((row) => visualWidth(row[column] ?? "")),
    ),
  );
  const line = (cells: readonly string[]) =>
    joinCells(cells.map((cell, column) => padCell(cell, widths[column] ?? 0)));
  return [
    line(table.header),
    joinCells(
      table.alignments.map((alignment, column) =>
        delimiterCell(alignment, widths[column] ?? MIN_DELIMITER_DASHES),
      ),
    ),
    ...table.rows.map(line),
  ];
}

function emptyRow(table: MarkdownTable): string[] {
  return table.header.map(() => "");
}

function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items];
  const [item] = result.splice(from, 1);
  if (item !== undefined) result.splice(to, 0, item);
  return result;
}

function insertedAt<T>(items: readonly T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function removedAt<T>(items: readonly T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

export type TableOperation =
  | { readonly kind: "insertRow"; readonly at: number }
  | { readonly kind: "deleteRow"; readonly row: number }
  | { readonly kind: "moveRow"; readonly from: number; readonly to: number }
  | { readonly kind: "insertColumn"; readonly at: number }
  | { readonly kind: "deleteColumn"; readonly column: number }
  | { readonly kind: "moveColumn"; readonly from: number; readonly to: number }
  | {
      readonly kind: "setAlignment";
      readonly column: number;
      readonly alignment: ColumnAlignment;
    }
  | { readonly kind: "format" };

const inRange = (index: number, length: number) =>
  Number.isInteger(index) && index >= 0 && index < length;

// The table after the operation, or null when it does not apply (an index out of range,
// removing the last column).
export function applyTableOperation(
  table: MarkdownTable,
  operation: TableOperation,
): MarkdownTable | null {
  const rowCount = table.rows.length;
  const columnCount = table.header.length;
  switch (operation.kind) {
    case "insertRow":
      if (!inRange(operation.at, rowCount + 1)) return null;
      return {
        ...table,
        rows: insertedAt(table.rows, operation.at, emptyRow(table)),
      };
    case "deleteRow":
      if (!inRange(operation.row, rowCount)) return null;
      return { ...table, rows: removedAt(table.rows, operation.row) };
    case "moveRow":
      if (
        !inRange(operation.from, rowCount) ||
        !inRange(operation.to, rowCount)
      )
        return null;
      return {
        ...table,
        rows: moved(table.rows, operation.from, operation.to),
      };
    case "insertColumn":
      if (!inRange(operation.at, columnCount + 1)) return null;
      return {
        header: insertedAt(table.header, operation.at, ""),
        alignments: insertedAt(table.alignments, operation.at, "none"),
        rows: table.rows.map((row) => insertedAt(row, operation.at, "")),
      };
    case "deleteColumn":
      if (columnCount <= 1 || !inRange(operation.column, columnCount))
        return null;
      return {
        header: removedAt(table.header, operation.column),
        alignments: removedAt(table.alignments, operation.column),
        rows: table.rows.map((row) => removedAt(row, operation.column)),
      };
    case "moveColumn":
      if (
        !inRange(operation.from, columnCount) ||
        !inRange(operation.to, columnCount)
      )
        return null;
      return {
        header: moved(table.header, operation.from, operation.to),
        alignments: moved(table.alignments, operation.from, operation.to),
        rows: table.rows.map((row) => moved(row, operation.from, operation.to)),
      };
    case "setAlignment":
      if (!inRange(operation.column, columnCount)) return null;
      return {
        ...table,
        alignments: table.alignments.map((alignment, column) =>
          column === operation.column ? operation.alignment : alignment,
        ),
      };
    case "format":
      return table;
  }
}

function sameTable(left: MarkdownTable, right: MarkdownTable): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Offset of the first character of a cell's text in formatted table lines starting at
// `tableStart`.
function cellOffset(
  lines: readonly string[],
  tableStart: number,
  cell: TableCell,
): number {
  const lineIndex = cell.row === null ? 0 : cell.row + 2;
  let offset = tableStart;
  for (let index = 0; index < lineIndex; index += 1) {
    offset += (lines[index] ?? "").length + LINE_BREAK.length;
  }
  const line = lines[lineIndex] ?? "";
  const separators = separatorOffsets(line);
  const separator = separators[cell.column] ?? 0;
  // `| ` before each cell: the text starts two characters after its separator.
  return offset + Math.min(separator + 2, line.length);
}

// Replaces the table's lines with the edited table and checks the result reads back as
// exactly that table; null when it would not (then nothing should change).
export function writeTable(
  source: string,
  location: TableLocation,
  edited: MarkdownTable,
  caretCell: TableCell,
): TableEditResult | null {
  const lines = source.split(LINE_BREAK);
  const formatted = formatTable(edited);
  const next = [
    ...lines.slice(0, location.firstLine),
    ...formatted,
    ...lines.slice(location.firstLine + location.lineCount),
  ];
  const text = next.join(LINE_BREAK);
  const tableStart = lineStartOffsets(next)[location.firstLine] ?? text.length;
  const reread = findTableAt(text, tableStart);
  if (
    reread === null ||
    reread.firstLine !== location.firstLine ||
    reread.lineCount !== formatted.length ||
    !sameTable(reread.table, edited)
  ) {
    return null;
  }
  const row =
    caretCell.row === null || edited.rows.length === 0
      ? null
      : Math.min(caretCell.row, edited.rows.length - 1);
  const column = Math.min(caretCell.column, edited.header.length - 1);
  return { text, caret: cellOffset(formatted, tableStart, { row, column }) };
}

// Cell text as Markdown: a pipe would split the cell and a line break would end the row
// (HTML such as <br> is shown as text in this app, so a break becomes a space).
function markdownCell(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\|/g, `${ESCAPE}${CELL_SEPARATOR}`)
    .trim();
}

// Tab-separated rows as a spreadsheet puts them on the clipboard: a cell holding a tab,
// a line break or a quote is quoted, and a quote inside is doubled.
function parseTabSeparated(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atCellStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quoted) {
      if (character === QUOTE && text[index + 1] === QUOTE) {
        cell += QUOTE;
        index += 1;
      } else if (character === QUOTE) {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === QUOTE && atCellStart) {
      quoted = true;
      atCellStart = false;
      continue;
    }
    if (character === TAB) {
      row.push(cell);
      cell = "";
      atCellStart = true;
      continue;
    }
    if (character === CARRIAGE_RETURN) continue;
    if (character === LINE_BREAK) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
      continue;
    }
    cell += character;
    atCellStart = false;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// A Markdown table for text copied from a spreadsheet (tab-separated, at least two rows
// and two columns; the first row becomes the header), or null for any other text.
export function tableFromTabSeparated(text: string): MarkdownTable | null {
  if (!text.includes(TAB)) return null;
  const rows = parseTabSeparated(text);
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length < MIN_PASTED_ROWS || columnCount < MIN_PASTED_COLUMNS)
    return null;
  const padded = rows.map((row) =>
    [...row, ...Array.from({ length: columnCount - row.length }, () => "")].map(
      markdownCell,
    ),
  );
  const [header, ...body] = padded;
  if (header === undefined) return null;
  return {
    header,
    alignments: header.map(() => "none" as const),
    rows: body,
  };
}

// The text to insert at `caret` so the table starts on a line of its own after a blank
// line and is followed by a line break.
export function tableInsertion(
  source: string,
  caret: number,
  table: MarkdownTable,
): string {
  const before = source.slice(0, caret);
  const after = source.slice(caret);
  const lines = formatTable(table).join(LINE_BREAK);
  const prefix =
    before.length === 0 || before.endsWith(`${LINE_BREAK}${LINE_BREAK}`)
      ? ""
      : before.endsWith(LINE_BREAK)
        ? LINE_BREAK
        : `${LINE_BREAK}${LINE_BREAK}`;
  const suffix = after.startsWith(LINE_BREAK) ? "" : LINE_BREAK;
  return `${prefix}${lines}${suffix}`;
}
