import { describe, expect, it } from "vitest";
import type { SpreadsheetSheet } from "../../application/ports/asset-types";
import {
  columnName,
  DEFAULT_SPREADSHEET_IMPORT_OPTIONS,
  parseCellRange,
  previewLines,
  rangeFromHeaderRow,
  sheetTable,
  tableRowNumbers,
} from "./spreadsheet-table";

// Like the sheet of `features.xlsx`: from B2, B3:B4 merged, column E and row 5 hidden.
const SHEET: SpreadsheetSheet = {
  name: "Spec",
  hidden: false,
  firstRow: 1,
  firstColumn: 1,
  rows: [
    [{ text: "Item" }, { text: "Price" }, { text: "Rate" }, { text: "Secret" }],
    [
      { text: "Group A" },
      { text: "¥1,200", number: true },
      { text: "12.5%", number: true },
      { text: "x" },
    ],
    [
      { text: "" },
      { text: "3,400.50", number: true },
      { text: "1", number: true },
    ],
    [{ text: "skip" }],
    [
      { text: "line1\nline2" },
      { text: "Docs [v2]", link: "https://example.com/a b" },
    ],
  ],
  hiddenRows: [4],
  hiddenColumns: [4],
  merged: [{ firstRow: 2, firstColumn: 1, lastRow: 3, lastColumn: 1 }],
  truncated: false,
};

describe("sheetTable", () => {
  it("leaves hidden rows and columns out and right-aligns columns of numbers only", () => {
    expect(sheetTable(SHEET, DEFAULT_SPREADSHEET_IMPORT_OPTIONS)).toEqual({
      header: ["Item", "Price", "Rate"],
      alignments: ["none", "none", "right"],
      rows: [
        ["Group A", "¥1,200", "12.5%"],
        ["", "3,400.50", "1"],
        ["line1<br>line2", "[Docs \\[v2\\]](<https://example.com/a%20b>)", ""],
      ],
    });
  });

  it("can fill merged cells, keep hidden parts, use column letters and leave alignment", () => {
    const table = sheetTable(SHEET, {
      headerRow: false,
      fillMerged: true,
      alignNumbers: false,
      skipHidden: false,
    });
    expect(table?.header).toEqual(["B", "C", "D", "E"]);
    expect(table?.alignments).toEqual(["none", "none", "none", "none"]);
    expect(table?.rows.map((row) => row[0])).toEqual([
      "Item",
      "Group A",
      "Group A",
      "skip",
      "line1<br>line2",
    ]);
  });

  it("takes only the chosen range, and nothing when the range is empty", () => {
    const range = parseCellRange("c3:d4");
    expect(range).toEqual({
      firstRow: 2,
      firstColumn: 2,
      lastRow: 3,
      lastColumn: 3,
    });
    expect(
      sheetTable(SHEET, DEFAULT_SPREADSHEET_IMPORT_OPTIONS, range ?? null),
    ).toEqual({
      header: ["¥1,200", "12.5%"],
      alignments: ["right", "right"],
      rows: [["3,400.50", "1"]],
    });
    expect(
      sheetTable(
        SHEET,
        DEFAULT_SPREADSHEET_IMPORT_OPTIONS,
        parseCellRange("Z1:Z9") ?? null,
      ),
    ).toBeNull();
  });
});

describe("parseCellRange", () => {
  it("reads ranges and single cells, and refuses anything else", () => {
    expect(parseCellRange("")).toBeNull();
    expect(parseCellRange("AA10")).toEqual({
      firstRow: 9,
      firstColumn: 26,
      lastRow: 9,
      lastColumn: 26,
    });
    expect(parseCellRange("H40:B3")?.firstColumn).toBe(1);
    expect(parseCellRange("B3:")).toBeUndefined();
    expect(parseCellRange("3B")).toBeUndefined();
    expect(parseCellRange("A1:B2:C3")).toBeUndefined();
  });
});

describe("columnName", () => {
  it("counts like a spreadsheet", () => {
    expect([0, 25, 26, 51, 52].map(columnName)).toEqual([
      "A",
      "Z",
      "AA",
      "AZ",
      "BA",
    ]);
  });
});

describe("choosing the header row", () => {
  // A title merged over the columns, an empty row, then the real header.
  const TITLED: SpreadsheetSheet = {
    name: "Sales",
    hidden: false,
    firstRow: 0,
    firstColumn: 0,
    rows: [
      [{ text: "Sales 2026" }],
      [],
      [{ text: "Month" }, { text: "Total" }],
      [{ text: "Jan" }, { text: "10", number: true }],
    ],
    hiddenRows: [],
    hiddenColumns: [],
    merged: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 1 }],
    truncated: false,
  };

  it("tells which worksheet row each row of the table is, hidden rows left out", () => {
    expect(tableRowNumbers(TITLED, DEFAULT_SPREADSHEET_IMPORT_OPTIONS)).toEqual(
      [0, 1, 2, 3],
    );
    expect(tableRowNumbers(SHEET, DEFAULT_SPREADSHEET_IMPORT_OPTIONS)).toEqual([
      1, 2, 3, 5,
    ]);
  });

  it("makes the range start at the chosen row, which becomes the header", () => {
    const range = rangeFromHeaderRow(TITLED, null, 2);
    expect(range).toBe("A3:B4");
    const table = sheetTable(
      TITLED,
      DEFAULT_SPREADSHEET_IMPORT_OPTIONS,
      parseCellRange(range) ?? null,
    );
    expect(table?.header).toEqual(["Month", "Total"]);
    expect(table?.rows).toEqual([["Jan", "10"]]);
    expect(table?.alignments).toEqual(["none", "right"]);
  });

  it("keeps the chosen columns and last row of a range", () => {
    expect(rangeFromHeaderRow(TITLED, parseCellRange("B1:B4") ?? null, 2)).toBe(
      "B3:B4",
    );
  });
});

describe("the preview of a cell", () => {
  it("shows its lines and no Markdown escapes", () => {
    expect(previewLines("在庫<br>要確認")).toEqual(["在庫", "要確認"]);
    expect(previewLines("a \\| b")).toEqual(["a | b"]);
    expect(previewLines("")).toEqual([""]);
  });
});
