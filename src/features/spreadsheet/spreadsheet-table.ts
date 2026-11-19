// What a worksheet becomes as a Markdown table, by the choices of the import dialog: which
// cells (a range, hidden rows and columns left out or not), what a merged area holds,
// whether the first row is the header, and whether columns of numbers are right-aligned.
// A line break in a cell becomes `<br>`, a link a Markdown link. Pure.

import type {
  SpreadsheetCell,
  SpreadsheetSheet,
} from "../../application/ports/asset-types";
import type {
  ColumnAlignment,
  MarkdownTable,
} from "../../domain/markdown-table/markdown-table";

export interface SpreadsheetImportOptions {
  // The first row is the header (otherwise the column letters are).
  readonly headerRow: boolean;
  // Every cell of a merged area shows its value (otherwise only the first one).
  readonly fillMerged: boolean;
  // A column whose cells are all numbers is right-aligned.
  readonly alignNumbers: boolean;
  // Hidden rows, columns (and sheets, decided by the dialog) are left out.
  readonly skipHidden: boolean;
}

export const DEFAULT_SPREADSHEET_IMPORT_OPTIONS: SpreadsheetImportOptions = {
  headerRow: true,
  fillMerged: false,
  alignNumbers: true,
  skipHidden: true,
};

// Zero-based worksheet positions, both ends included.
export interface CellRange {
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

const LETTERS = 26;
const LETTER_A = "A".charCodeAt(0);
const CELL_REFERENCE = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
const RANGE_SEPARATOR = ":";
const CELL_SEPARATOR = "|";
const ESCAPE = "\\";
const LINE_BREAK = /\r\n|\r|\n/g;
const LINE_BREAK_TAG = "<br>";
const LINK_TEXT_SPECIAL = /[[\]]/g;
// A cell that is one link, as `markdownCell` writes it, and the brackets it escapes.
const WHOLE_LINK = /^\[((?:\\.|[^\]\\])*)\]\(<[^>]*>\)$/;
const ESCAPED_BRACKET = /\\([[\]])/g;
const DESTINATION_UNSAFE = /[<>\s]/g;

// 0 → "A", 25 → "Z", 26 → "AA".
export function columnName(index: number): string {
  let name = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % LETTERS;
    name = String.fromCharCode(LETTER_A + digit) + name;
    rest = Math.floor((rest - 1) / LETTERS);
  }
  return name;
}

function columnIndex(name: string): number {
  let index = 0;
  for (const letter of name) {
    index = index * LETTERS + (letter.charCodeAt(0) - LETTER_A + 1);
  }
  return index - 1;
}

function cellPosition(
  reference: string,
): { readonly row: number; readonly column: number } | null {
  const match = CELL_REFERENCE.exec(reference.trim().toUpperCase());
  if (match === null) return null;
  return {
    row: Number(match[2]) - 1,
    column: columnIndex(match[1] ?? ""),
  };
}

// `B3:H40` (or one cell `B3`); empty text is the whole sheet (`null`). `undefined` when the
// text is not a range.
export function parseCellRange(text: string): CellRange | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const [first, last, extra] = trimmed.split(RANGE_SEPARATOR);
  if (extra !== undefined || first === undefined) return undefined;
  const start = cellPosition(first);
  const end = cellPosition(last ?? first);
  if (start === null || end === null) return undefined;
  return {
    firstRow: Math.min(start.row, end.row),
    firstColumn: Math.min(start.column, end.column),
    lastRow: Math.max(start.row, end.row),
    lastColumn: Math.max(start.column, end.column),
  };
}

// The lines a preview shows for a cell's Markdown: as the table will show it, with its
// line breaks and without the escapes (`\|`), not the Markdown text itself.
export function previewLines(markdown: string): readonly string[] {
  // A link cell (`[text](<address>)`) shows its text, as the table will.
  const link = WHOLE_LINK.exec(markdown);
  const shown =
    link === null ? markdown : (link[1] ?? "").replace(ESCAPED_BRACKET, "$1");
  return shown
    .split(LINE_BREAK_TAG)
    .map((line) =>
      line.replaceAll(`${ESCAPE}${CELL_SEPARATOR}`, CELL_SEPARATOR),
    );
}

// The cell's Markdown: `|` escaped, line breaks as `<br>`, a link as `[text](<address>)`.
function markdownCell(cell: SpreadsheetCell | undefined): string {
  if (cell === undefined) return "";
  const text = cell.text
    .replace(LINE_BREAK, LINE_BREAK_TAG)
    .replaceAll(CELL_SEPARATOR, `${ESCAPE}${CELL_SEPARATOR}`)
    .trim();
  if (cell.link === undefined || text === "") return text;
  const destination = cell.link.replace(DESTINATION_UNSAFE, (character) =>
    encodeURIComponent(character),
  );
  const linkText = text.replace(
    LINK_TEXT_SPECIAL,
    (bracket) => `${ESCAPE}${bracket}`,
  );
  return `[${linkText}](<${destination}>)`;
}

function cellAt(
  sheet: SpreadsheetSheet,
  row: number,
  column: number,
): SpreadsheetCell | undefined {
  return sheet.rows[row - sheet.firstRow]?.[column - sheet.firstColumn];
}

function lastColumnOf(sheet: SpreadsheetSheet): number {
  return (
    sheet.firstColumn + Math.max(0, ...sheet.rows.map((row) => row.length)) - 1
  );
}

interface SheetLayout {
  // The worksheet rows and columns the table is made of, in order.
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  readonly grid: readonly (readonly (SpreadsheetCell | undefined)[])[];
}

// Which cells the table takes: the chosen ones, without hidden rows and columns (when they
// are left out) and without empty rows and columns at the end.
function sheetLayout(
  sheet: SpreadsheetSheet,
  options: SpreadsheetImportOptions,
  range: CellRange | null,
): SheetLayout | null {
  const bounds: CellRange = {
    firstRow: Math.max(sheet.firstRow, range?.firstRow ?? sheet.firstRow),
    firstColumn: Math.max(
      sheet.firstColumn,
      range?.firstColumn ?? sheet.firstColumn,
    ),
    lastRow: Math.min(
      sheet.firstRow + sheet.rows.length - 1,
      range?.lastRow ?? Number.POSITIVE_INFINITY,
    ),
    lastColumn: Math.min(
      lastColumnOf(sheet),
      range?.lastColumn ?? Number.POSITIVE_INFINITY,
    ),
  };
  const hiddenRows = new Set(options.skipHidden ? sheet.hiddenRows : []);
  const hiddenColumns = new Set(options.skipHidden ? sheet.hiddenColumns : []);
  const rows: number[] = [];
  for (let row = bounds.firstRow; row <= bounds.lastRow; row += 1) {
    if (!hiddenRows.has(row)) rows.push(row);
  }
  const columns: number[] = [];
  for (
    let column = bounds.firstColumn;
    column <= bounds.lastColumn;
    column += 1
  ) {
    if (!hiddenColumns.has(column)) columns.push(column);
  }
  const valueAt = (
    row: number,
    column: number,
  ): SpreadsheetCell | undefined => {
    if (options.fillMerged) {
      const area = sheet.merged.find(
        (merged) =>
          row >= merged.firstRow &&
          row <= merged.lastRow &&
          column >= merged.firstColumn &&
          column <= merged.lastColumn,
      );
      if (area !== undefined) {
        return cellAt(sheet, area.firstRow, area.firstColumn);
      }
    }
    return cellAt(sheet, row, column);
  };
  let grid = rows.map((row) => columns.map((column) => valueAt(row, column)));
  // Rows and columns with nothing at the end are dropped.
  while (
    grid.length > 0 &&
    (grid[grid.length - 1] ?? []).every((cell) => (cell?.text ?? "") === "")
  ) {
    grid = grid.slice(0, -1);
  }
  let width = 0;
  for (const row of grid) {
    row.forEach((cell, index) => {
      if ((cell?.text ?? "") !== "") width = Math.max(width, index + 1);
    });
  }
  if (grid.length === 0 || width === 0) return null;
  return {
    rows: rows.slice(0, grid.length),
    columns: columns.slice(0, width),
    grid: grid.map((row) => row.slice(0, width)),
  };
}

// The worksheet row of each row of the table (the header first), for telling the user
// which row is which.
export function tableRowNumbers(
  sheet: SpreadsheetSheet,
  options: SpreadsheetImportOptions,
  range: CellRange | null = null,
): readonly number[] {
  return sheetLayout(sheet, options, range)?.rows ?? [];
}

// The range that makes worksheet row `row` the header: the chosen range (or the whole
// sheet) starting at that row.
export function rangeFromHeaderRow(
  sheet: SpreadsheetSheet,
  range: CellRange | null,
  row: number,
): string {
  const lastRow = range?.lastRow ?? sheet.firstRow + sheet.rows.length - 1;
  const firstColumn = range?.firstColumn ?? sheet.firstColumn;
  const lastColumn = range?.lastColumn ?? lastColumnOf(sheet);
  return `${columnName(firstColumn)}${row + 1}${RANGE_SEPARATOR}${columnName(lastColumn)}${lastRow + 1}`;
}

// The table for one worksheet, or null when nothing is left in the chosen cells.
export function sheetTable(
  sheet: SpreadsheetSheet,
  options: SpreadsheetImportOptions,
  range: CellRange | null = null,
): MarkdownTable | null {
  const layout = sheetLayout(sheet, options, range);
  if (layout === null) return null;
  const { grid } = layout;
  const keptColumns = layout.columns;
  const [first, ...rest] = grid;
  const header = options.headerRow
    ? (first ?? []).map(markdownCell)
    : keptColumns.map(columnName);
  const body = options.headerRow ? rest : grid;
  const alignments: ColumnAlignment[] = keptColumns.map((_, index) => {
    if (!options.alignNumbers) return "none";
    const values = body
      .map((row) => row[index])
      .filter((cell) => (cell?.text ?? "") !== "");
    return values.length > 0 && values.every((cell) => cell?.number === true)
      ? "right"
      : "none";
  });
  return {
    header,
    alignments,
    rows: body.map((row) => row.map(markdownCell)),
  };
}
