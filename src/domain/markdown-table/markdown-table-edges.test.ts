import { describe, expect, it } from "vitest";
import {
  applyTableOperation,
  findTableAt,
  type MarkdownTable,
  type TableOperation,
  tableFromCells,
  tableInsertion,
  writeTable,
} from "./markdown-table";

const TABLE: MarkdownTable = {
  header: ["A", "B"],
  alignments: ["none", "none"],
  rows: [
    ["1", "2"],
    ["3", "4"],
  ],
};

describe("what is a table", () => {
  it("reads centred columns", () => {
    const location = findTableAt("| a |\n| :-: |\n| 1 |", 0);
    expect(location?.table.alignments).toEqual(["center"]);
  });

  it.each([
    ["no delimiter line", "| a | b |"],
    ["a delimiter that is not one", "| a | b |\n| -- | x |"],
    ["a delimiter with another number of cells", "| a | b |\n| --- |"],
    ["a delimiter line that is not a table line", "| a |\n---"],
    ["a body row wider than the header", "| a |\n| --- |\n| 1 | 2 |"],
  ])("is not a table with %s", (_what, source) => {
    expect(findTableAt(source, 0)).toBeNull();
  });

  it("is not a table inside a fenced code block", () => {
    const source = "```\n| a |\n| --- |\n```";
    expect(findTableAt(source, source.indexOf("| a"))).toBeNull();
  });

  it("finds a table after a fenced block that a longer fence closes", () => {
    const source = "````\n| x |\n```\n````\n| a |\n| --- |";
    expect(findTableAt(source, source.indexOf("| a"))?.table.header).toEqual([
      "a",
    ]);
  });
});

describe("operations out of range", () => {
  it.each<[string, TableOperation]>([
    ["a row after the end", { kind: "insertRow", at: 3 }],
    ["a row that is not there", { kind: "deleteRow", row: 2 }],
    ["a row moved from nowhere", { kind: "moveRow", from: 5, to: 0 }],
    ["a row moved to nowhere", { kind: "moveRow", from: 0, to: 5 }],
    ["a column after the end", { kind: "insertColumn", at: 3 }],
    ["a column that is not there", { kind: "deleteColumn", column: 2 }],
    ["a column moved from nowhere", { kind: "moveColumn", from: 2, to: 0 }],
    ["a column moved to nowhere", { kind: "moveColumn", from: 0, to: -1 }],
    [
      "an alignment for no column",
      {
        kind: "setAlignment",
        column: 2,
        alignment: "left",
      },
    ],
  ])("does not apply to %s", (_what, operation) => {
    expect(applyTableOperation(TABLE, operation)).toBeNull();
  });

  it("does not delete the last column, and formatting keeps the table", () => {
    const single: MarkdownTable = {
      header: ["A"],
      alignments: ["none"],
      rows: [],
    };
    expect(
      applyTableOperation(single, { kind: "deleteColumn", column: 0 }),
    ).toBeNull();
    expect(applyTableOperation(TABLE, { kind: "format" })).toBe(TABLE);
  });

  it("moves and aligns columns, every row with them", () => {
    expect(
      applyTableOperation(TABLE, { kind: "moveColumn", from: 0, to: 1 }),
    ).toEqual({
      header: ["B", "A"],
      alignments: ["none", "none"],
      rows: [
        ["2", "1"],
        ["4", "3"],
      ],
    });
    expect(
      applyTableOperation(TABLE, {
        kind: "setAlignment",
        column: 1,
        alignment: "right",
      })?.alignments,
    ).toEqual(["none", "right"]);
  });
});

describe("writing a table back", () => {
  it("refuses a result that would not read back as the same table", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const location = findTableAt(source, 0);
    if (location === null) throw new Error("no table");
    // A cell holding a line break would end the row.
    const edited: MarkdownTable = { ...TABLE, header: ["A\nX", "B"] };
    expect(
      writeTable(source, location, edited, { row: 0, column: 0 }),
    ).toBeNull();
  });

  it("puts the caret in the header when the table has no body row left", () => {
    const source = "| A |\n| --- |\n| 1 |";
    const location = findTableAt(source, 0);
    if (location === null) throw new Error("no table");
    const empty: MarkdownTable = {
      header: ["A"],
      alignments: ["none"],
      rows: [],
    };
    const written = writeTable(source, location, empty, { row: 0, column: 0 });
    expect(written?.text).toBe("| A   |\n| --- |");
    expect(written?.caret).toBe(2);
  });
});

describe("tables from cells", () => {
  it("is nothing without a row or a column", () => {
    expect(tableFromCells([])).toBeNull();
    expect(tableFromCells([[]])).toBeNull();
  });
});

describe("tableInsertion", () => {
  const table: MarkdownTable = {
    header: ["A"],
    alignments: ["none"],
    rows: [],
  };
  const formatted = "| A   |\n| --- |";

  it("separates the table from the text before it by one blank line", () => {
    expect(tableInsertion("", 0, table)).toBe(`${formatted}\n`);
    expect(tableInsertion("text\n\n", 6, table)).toBe(`${formatted}\n`);
    expect(tableInsertion("text\n", 5, table)).toBe(`\n${formatted}\n`);
    expect(tableInsertion("text", 4, table)).toBe(`\n\n${formatted}\n`);
  });

  it("adds no line break when the text after already starts with one", () => {
    expect(tableInsertion("\nafter", 0, table)).toBe(formatted);
  });
});
