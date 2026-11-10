import { describe, expect, it } from "vitest";
import {
  applyTableOperation,
  findTableAt,
  formatTable,
  type MarkdownTable,
  tableFromTabSeparated,
  tableInsertion,
  writeTable,
} from "./markdown-table";

const SOURCE = [
  "# Tables",
  "",
  "| Name | Type |",
  "| :--- | ---: |",
  "| id | uuid |",
  "| total | int |",
  "",
  "after",
].join("\n");

const offsetOf = (source: string, needle: string) => source.indexOf(needle);

describe("findTableAt", () => {
  it("finds the table, its alignment and the cell under the caret", () => {
    const location = findTableAt(SOURCE, offsetOf(SOURCE, "int"));
    expect(location).toEqual({
      firstLine: 2,
      lineCount: 4,
      table: {
        header: ["Name", "Type"],
        alignments: ["left", "right"],
        rows: [
          ["id", "uuid"],
          ["total", "int"],
        ],
      },
      cell: { row: 1, column: 1 },
    });
    expect(findTableAt(SOURCE, offsetOf(SOURCE, "Name"))?.cell).toEqual({
      row: null,
      column: 0,
    });
  });

  it("reads tables without outer pipes and keeps escaped pipes in a cell", () => {
    const source = "a | b\n--|--\nx \\| y | z";
    expect(findTableAt(source, 0)?.table).toEqual({
      header: ["a", "b"],
      alignments: ["none", "none"],
      rows: [["x \\| y", "z"]],
    });
  });

  it("pads short rows and refuses rows wider than the header", () => {
    expect(findTableAt("|a|b|\n|-|-|\n|x|", 0)?.table.rows).toEqual([
      ["x", ""],
    ]);
    expect(findTableAt("|a|b|\n|-|-|\n|x|y|z|", 0)).toBeNull();
  });

  it.each([
    ["outside a table", "after"],
    ["in a paragraph with a pipe", "a | b"],
  ])("finds nothing %s", (_label, needle) => {
    const source = `${SOURCE}\n\na | b`;
    expect(findTableAt(source, source.lastIndexOf(needle))).toBeNull();
  });

  it("finds nothing inside a fenced code block or an indented one", () => {
    const fenced = "```\n| a | b |\n| - | - |\n```";
    expect(findTableAt(fenced, offsetOf(fenced, "a"))).toBeNull();
    const indented = "    | a | b |\n    | - | - |";
    expect(findTableAt(indented, offsetOf(indented, "a"))).toBeNull();
  });
});

describe("formatTable", () => {
  it("pads columns, counting wide characters twice", () => {
    expect(
      formatTable({
        header: ["項目", "x"],
        alignments: ["center", "none"],
        rows: [["a", "long text"]],
      }),
    ).toEqual([
      "| 項目 | x         |",
      "| :--: | --------- |",
      "| a    | long text |",
    ]);
  });
});

describe("applyTableOperation", () => {
  const table: MarkdownTable = {
    header: ["A", "B"],
    alignments: ["none", "right"],
    rows: [
      ["1", "2"],
      ["3", "4"],
    ],
  };

  it("inserts, deletes and moves rows", () => {
    expect(
      applyTableOperation(table, { kind: "insertRow", at: 1 })?.rows,
    ).toEqual([
      ["1", "2"],
      ["", ""],
      ["3", "4"],
    ]);
    expect(
      applyTableOperation(table, { kind: "deleteRow", row: 0 })?.rows,
    ).toEqual([["3", "4"]]);
    expect(
      applyTableOperation(table, { kind: "moveRow", from: 1, to: 0 })?.rows,
    ).toEqual([
      ["3", "4"],
      ["1", "2"],
    ]);
  });

  it("inserts, deletes and moves columns with their alignment", () => {
    expect(applyTableOperation(table, { kind: "insertColumn", at: 1 })).toEqual(
      {
        header: ["A", "", "B"],
        alignments: ["none", "none", "right"],
        rows: [
          ["1", "", "2"],
          ["3", "", "4"],
        ],
      },
    );
    expect(
      applyTableOperation(table, { kind: "moveColumn", from: 1, to: 0 }),
    ).toEqual({
      header: ["B", "A"],
      alignments: ["right", "none"],
      rows: [
        ["2", "1"],
        ["4", "3"],
      ],
    });
    expect(
      applyTableOperation(table, { kind: "deleteColumn", column: 0 })?.header,
    ).toEqual(["B"]);
  });

  it("refuses what does not apply", () => {
    const single = applyTableOperation(table, {
      kind: "deleteColumn",
      column: 0,
    });
    expect(
      single === null
        ? null
        : applyTableOperation(single, { kind: "deleteColumn", column: 0 }),
    ).toBeNull();
    expect(
      applyTableOperation(table, { kind: "deleteRow", row: 5 }),
    ).toBeNull();
    expect(
      applyTableOperation(table, { kind: "moveRow", from: 0, to: 2 }),
    ).toBeNull();
  });

  it("sets the alignment of one column", () => {
    expect(
      applyTableOperation(table, {
        kind: "setAlignment",
        column: 0,
        alignment: "center",
      })?.alignments,
    ).toEqual(["center", "right"]);
  });
});

describe("writeTable", () => {
  it("rewrites only the table's lines and puts the caret in the cell", () => {
    const location = findTableAt(SOURCE, offsetOf(SOURCE, "uuid"));
    if (location === null) throw new Error("a table is expected");
    const edited = applyTableOperation(location.table, {
      kind: "insertRow",
      at: 1,
    });
    if (edited === null) throw new Error("the row is expected");
    const result = writeTable(SOURCE, location, edited, { row: 1, column: 0 });
    expect(result?.text).toBe(
      [
        "# Tables",
        "",
        "| Name  | Type |",
        "| :---- | ---: |",
        "| id    | uuid |",
        "|       |      |",
        "| total | int  |",
        "",
        "after",
      ].join("\n"),
    );
    const caret = result?.caret ?? -1;
    expect(findTableAt(result?.text ?? "", caret)?.cell).toEqual({
      row: 1,
      column: 0,
    });
  });
});

describe("tableFromTabSeparated", () => {
  it("turns spreadsheet cells into a table, the first row as header", () => {
    expect(tableFromTabSeparated("Name\tType\r\nid\tuuid\r\n")).toEqual({
      header: ["Name", "Type"],
      alignments: ["none", "none"],
      rows: [["id", "uuid"]],
    });
  });

  it("reads quoted cells and makes them safe for a table", () => {
    expect(
      tableFromTabSeparated('a\tb\n"x\ny"\t"say ""hi"" | ok"\n')?.rows,
    ).toEqual([["x y", 'say "hi" \\| ok']]);
  });

  it("pads ragged rows", () => {
    expect(tableFromTabSeparated("a\tb\tc\n1\n")?.rows).toEqual([
      ["1", "", ""],
    ]);
  });

  it.each([
    ["plain text", "hello world"],
    ["one row", "a\tb"],
    ["one column", "a\nb\n"],
  ])("leaves %s alone", (_label, text) => {
    expect(tableFromTabSeparated(text)).toBeNull();
  });
});

describe("tableInsertion", () => {
  const table: MarkdownTable = {
    header: ["a", "b"],
    alignments: ["none", "none"],
    rows: [["1", "2"]],
  };

  it("starts the table after a blank line and ends it with a line break", () => {
    expect(tableInsertion("text", 4, table)).toBe(
      "\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n",
    );
    expect(tableInsertion("", 0, table).startsWith("| a")).toBe(true);
    expect(tableInsertion("x\n\n", 3, table).startsWith("| a")).toBe(true);
    expect(tableInsertion("x\n", 2, table).startsWith("\n| a")).toBe(true);
  });
});
