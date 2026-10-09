import { describe, expect, it } from "vitest";
import { classifyDiffLines, formatByteLimit } from "./git-diff-text";

const kindsOf = (diff: string) =>
  classifyDiffLines(diff).map((line) => line.kind);

describe("classifyDiffLines", () => {
  it("tells headers, hunks, additions, removals and context apart", () => {
    const diff = [
      "diff --git a/a.md b/a.md",
      "index 111..222 100644",
      "--- a/a.md",
      "+++ b/a.md",
      "@@ -1,2 +1,2 @@",
      " same",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    expect(kindsOf(diff)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "del",
      "add",
      "meta",
    ]);
  });

  it("keeps the prefix in the text and numbers the lines", () => {
    const lines = classifyDiffLines("@@ -1 +1 @@\n-a\n+b\n");
    expect(lines.map((line) => line.text)).toEqual(["@@ -1 +1 @@", "-a", "+b"]);
    expect(lines.map((line) => line.number)).toEqual([1, 2, 3]);
  });

  it("reads a removed line that looks like a header as a removal inside a hunk", () => {
    expect(kindsOf("@@ -1 +1 @@\n--- x\n+++ y\n")).toEqual([
      "hunk",
      "del",
      "add",
    ]);
  });

  it("starts the headers again at the next file", () => {
    expect(
      kindsOf(
        "diff --git a/a b/a\n@@ -1 +1 @@\n+x\ndiff --git a/b b/b\n--- a/b\n",
      ),
    ).toEqual(["meta", "hunk", "add", "meta", "meta"]);
  });

  it("returns no lines for an empty text and keeps a blank context line", () => {
    expect(classifyDiffLines("")).toEqual([]);
    expect(kindsOf("@@ -1,2 +1,2 @@\n\n+x\n")).toEqual([
      "hunk",
      "context",
      "add",
    ]);
  });
});

describe("formatByteLimit", () => {
  it.each([
    [1048576, "1 MiB"],
    [5242880, "5 MiB"],
    [1572864, "1.5 MiB"],
    [524288, "512 KiB"],
    [1536, "1.5 KiB"],
    [1024, "1 KiB"],
    [500, "500 B"],
  ])("writes %d bytes as %s", (bytes, text) => {
    expect(formatByteLimit(bytes)).toBe(text);
  });
});
