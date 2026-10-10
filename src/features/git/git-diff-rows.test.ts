import { describe, expect, it } from "vitest";
import { buildInlineRows, buildSplitRows } from "./git-diff-rows";

const FILE_HEADER = [
  "diff --git a/a.md b/a.md",
  "index 111..222 100644",
  "--- a/a.md",
  "+++ b/a.md",
];

const diffOf = (...lines: string[]): string =>
  `${[...FILE_HEADER, ...lines].join("\n")}\n`;

const inline = (...lines: string[]) =>
  buildInlineRows(diffOf(...lines)).map(
    ({ kind, oldNumber, newNumber, text }) => [
      kind,
      oldNumber,
      newNumber,
      text,
    ],
  );

const split = (...lines: string[]) =>
  buildSplitRows(diffOf(...lines)).map((row) =>
    row.kind === "line"
      ? [
          row.left && [row.left.number, row.left.text],
          row.right && [row.right.number, row.right.text],
        ]
      : [row.kind, row.text],
  );

describe("buildInlineRows", () => {
  it("numbers a modification from the header and drops the file headers", () => {
    expect(
      inline("@@ -3,3 +3,3 @@ title", " keep", "-old", "+new", " end"),
    ).toEqual([
      ["hunk", null, null, "title"],
      ["context", 3, 3, "keep"],
      ["removed", 4, null, "old"],
      ["added", null, 4, "new"],
      ["context", 5, 5, "end"],
    ]);
  });

  it("numbers a new file from -0,0 and a deleted file from +0,0", () => {
    expect(inline("@@ -0,0 +1,2 @@", "+a", "+b")).toEqual([
      ["hunk", null, null, ""],
      ["added", null, 1, "a"],
      ["added", null, 2, "b"],
    ]);
    expect(inline("@@ -1,2 +0,0 @@", "-a", "-b")).toEqual([
      ["hunk", null, null, ""],
      ["removed", 1, null, "a"],
      ["removed", 2, null, "b"],
    ]);
  });

  it("reads a header without counts as a single line", () => {
    expect(inline("@@ -7 +9 @@", "-a", "+b")).toEqual([
      ["hunk", null, null, ""],
      ["removed", 7, null, "a"],
      ["added", null, 9, "b"],
    ]);
  });

  it("restarts the numbers at each hunk", () => {
    const rows = inline("@@ -1 +1 @@", "-a", "+b", "@@ -20 +30 @@", "-c", "+d");
    expect(rows.filter((row) => row[0] === "hunk")).toHaveLength(2);
    expect(rows.at(-2)).toEqual(["removed", 20, null, "c"]);
    expect(rows.at(-1)).toEqual(["added", null, 30, "d"]);
  });

  it("puts a no-newline line after the line it refers to as a note", () => {
    expect(
      inline("@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b"),
    ).toEqual([
      ["hunk", null, null, ""],
      ["removed", 1, null, "a"],
      ["note", null, null, "\\ No newline at end of file"],
      ["added", null, 1, "b"],
    ]);
  });

  it("keeps CRLF, tabs, empty lines and marker-looking text as the line's text", () => {
    expect(inline("@@ -1,4 +1,4 @@", " a\r", "-\tb", "+--- c", "")).toEqual([
      ["hunk", null, null, ""],
      ["context", 1, 1, "a\r"],
      ["removed", 2, null, "\tb"],
      ["added", null, 2, "--- c"],
      ["context", 3, 3, ""],
    ]);
  });

  it("does not throw on a malformed header: lines stay, numbers go", () => {
    expect(inline("@@ nonsense @@", "-a", "+b", " c")).toEqual([
      ["hunk", null, null, ""],
      ["removed", null, null, "a"],
      ["added", null, null, "b"],
      ["context", null, null, "c"],
    ]);
    expect(() => buildInlineRows("@@")).not.toThrow();
  });

  it("shows the header lines as notes when the diff has no hunk", () => {
    const rows = buildInlineRows(
      "diff --git a/x b/x\nold mode 100644\nnew mode 100755\n",
    );
    expect(rows.map((row) => [row.kind, row.text])).toEqual([
      ["note", "diff --git a/x b/x"],
      ["note", "old mode 100644"],
      ["note", "new mode 100755"],
    ]);
  });

  it("returns no rows for an empty text", () => {
    expect(buildInlineRows("")).toEqual([]);
    expect(buildSplitRows("")).toEqual([]);
  });
});

describe("buildSplitRows", () => {
  it("shows context on both sides and pairs a modification", () => {
    expect(
      split("@@ -3,3 +3,3 @@ title", " keep", "-old", "+new", " end"),
    ).toEqual([
      ["hunk", "title"],
      [
        [3, "keep"],
        [3, "keep"],
      ],
      [
        [4, "old"],
        [4, "new"],
      ],
      [
        [5, "end"],
        [5, "end"],
      ],
    ]);
  });

  it("leaves the other side empty for pure additions and pure deletions", () => {
    expect(split("@@ -0,0 +1,2 @@", "+a", "+b")).toEqual([
      ["hunk", ""],
      [null, [1, "a"]],
      [null, [2, "b"]],
    ]);
    expect(split("@@ -1,2 +0,0 @@", "-a", "-b")).toEqual([
      ["hunk", ""],
      [[1, "a"], null],
      [[2, "b"], null],
    ]);
  });

  it("pairs runs of unequal length and fills the shorter side with empty cells", () => {
    expect(split("@@ -1,3 +1,1 @@", "-a", "-b", "-c", "+x")).toEqual([
      ["hunk", ""],
      [
        [1, "a"],
        [1, "x"],
      ],
      [[2, "b"], null],
      [[3, "c"], null],
    ]);
    expect(split("@@ -1,1 +1,3 @@", "-a", "+x", "+y", "+z")).toEqual([
      ["hunk", ""],
      [
        [1, "a"],
        [1, "x"],
      ],
      [null, [2, "y"]],
      [null, [3, "z"]],
    ]);
  });

  it("starts a new change when a removal follows additions", () => {
    expect(split("@@ -1,2 +1,2 @@", "-a", "+b", "-c", "+d")).toEqual([
      ["hunk", ""],
      [
        [1, "a"],
        [1, "b"],
      ],
      [
        [2, "c"],
        [2, "d"],
      ],
    ]);
  });

  it("separates hunks with a full-width row and renumbers", () => {
    const rows = split(
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "@@ -20 +30 @@ fn",
      "-c",
      "+d",
    );
    expect(rows).toEqual([
      ["hunk", ""],
      [
        [1, "a"],
        [1, "b"],
      ],
      ["hunk", "fn"],
      [
        [20, "c"],
        [30, "d"],
      ],
    ]);
  });

  it("attaches a no-newline note to the side it refers to", () => {
    const rows = buildSplitRows(
      diffOf(
        "@@ -1 +1 @@",
        "-a",
        "\\ No newline at end of file",
        "+b",
        "\\ No newline at end of file",
      ),
    );
    const line = rows[1];
    if (line?.kind !== "line") throw new Error("expected a line row");
    expect(line.left?.note).toBe("\\ No newline at end of file");
    expect(line.right?.note).toBe("\\ No newline at end of file");
    const onlyNew = buildSplitRows(
      diffOf("@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file"),
    )[1];
    if (onlyNew?.kind !== "line") throw new Error("expected a line row");
    expect(onlyNew.left?.note).toBeNull();
    expect(onlyNew.right?.note).toBe("\\ No newline at end of file");
  });

  it("makes a note that follows no line a full-width row", () => {
    expect(split("@@ -1 +1 @@", "\\ No newline at end of file")).toEqual([
      ["hunk", ""],
      ["note", "\\ No newline at end of file"],
    ]);
  });

  it("keeps CRLF and tabs and drops the numbers of a malformed header", () => {
    expect(split("@@ broken", "-a\r", "+\tb")).toEqual([
      ["hunk", ""],
      [
        [null, "a\r"],
        [null, "\tb"],
      ],
    ]);
  });
});
