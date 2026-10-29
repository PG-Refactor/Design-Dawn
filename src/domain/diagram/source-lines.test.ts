import { describe, expect, it } from "vitest";
import { classifyLines, scanLines } from "./source-lines";
import { loadMermaidGuiFixtures } from "./test-fixtures";

const joinLines = (source: string) =>
  scanLines(source)
    .map((line) => line.text + line.terminator)
    .join("");

describe("scanLines", () => {
  it("has no lines for the empty source", () => {
    expect(scanLines("")).toEqual([]);
  });

  it("keeps LF, CRLF and a missing final terminator", () => {
    expect(scanLines("ab\ncd\r\nef")).toEqual([
      { index: 0, start: 0, end: 2, terminator: "\n", text: "ab" },
      { index: 1, start: 3, end: 5, terminator: "\r\n", text: "cd" },
      { index: 2, start: 7, end: 9, terminator: "", text: "ef" },
    ]);
  });

  it("does not add an empty line after a trailing terminator", () => {
    expect(scanLines("a\n")).toHaveLength(1);
    expect(scanLines("a\n\n")).toHaveLength(2);
  });

  it("keeps a lone CR inside the line text", () => {
    const [line] = scanLines("a\rb\n");
    expect(line?.text).toBe("a\rb");
    expect(line?.terminator).toBe("\n");
  });

  it("treats a CR at the very start of a line before LF as CRLF", () => {
    expect(scanLines("\r\n")).toEqual([
      { index: 0, start: 0, end: 0, terminator: "\r\n", text: "" },
    ]);
  });

  it.each([
    "",
    "\n",
    "\r\n",
    "a",
    "a\r",
    "a\n\r\nb\rc\r\n\n",
    "日本語😀\r\nx\n",
  ])("is lossless for %j", (source) => {
    expect(joinLines(source)).toBe(source);
  });

  it("is lossless for every fixture and offsets point into the source", () => {
    for (const fixture of loadMermaidGuiFixtures()) {
      const lines = scanLines(fixture.source);
      expect(joinLines(fixture.source), fixture.id).toBe(fixture.source);
      for (const line of lines) {
        expect(fixture.source.slice(line.start, line.end), fixture.id).toBe(
          line.text,
        );
      }
    }
  });
});

const kindsOf = (source: string) =>
  classifyLines(scanLines(source)).lines.map((line) => line.kind);

describe("classifyLines", () => {
  it("classifies every kind of line", () => {
    expect(
      kindsOf(
        '---\ntitle: T\n---\n%%{init: {}}%%\n%% note\n\n  pie showData\n  "A" : 1\n',
      ),
    ).toEqual([
      "frontMatter",
      "frontMatter",
      "frontMatter",
      "directive",
      "comment",
      "blank",
      "header",
      "statement",
    ]);
  });

  it("takes the first line that is not trivia as the header", () => {
    expect(kindsOf("\n%% c\nflowchart TD\nA --> B")).toEqual([
      "blank",
      "comment",
      "header",
      "statement",
    ]);
  });

  it("recognises front matter only on the first line", () => {
    const { lines, issues } = classifyLines(scanLines("\n---\nx\n---\npie"));
    expect(lines.map((line) => line.kind)).toEqual([
      "blank",
      "header",
      "statement",
      "statement",
      "statement",
    ]);
    expect(issues).toEqual([]);
  });

  it("reports an unterminated front matter and swallows the rest", () => {
    const result = classifyLines(scanLines("---\ntitle: T\npie\n"));
    expect(result.issues).toEqual(["unterminatedFrontMatter"]);
    expect(result.lines.every((line) => line.kind === "frontMatter")).toBe(
      true,
    );
  });

  it("accepts a closing fence at the end of the text", () => {
    expect(classifyLines(scanLines("---\na: 1\n---")).issues).toEqual([]);
  });

  it("reports multi-line and unterminated directives", () => {
    const multi = classifyLines(scanLines('%%{init: {\n"a": 1}\n}%%\npie'));
    expect(multi.issues).toEqual(["multilineDirective"]);
    expect(multi.lines.map((line) => line.kind)).toEqual([
      "directive",
      "directive",
      "directive",
      "header",
    ]);
    expect(classifyLines(scanLines("%%{init: {\npie")).issues).toEqual([
      "unterminatedDirective",
    ]);
  });

  it("does not mistake a comment for a directive", () => {
    expect(kindsOf("%% {init}\npie")).toEqual(["comment", "header"]);
  });

  it("keeps the same line count and offsets as the scan", () => {
    for (const fixture of loadMermaidGuiFixtures()) {
      const scanned = scanLines(fixture.source);
      const { lines } = classifyLines(scanned);
      expect(
        lines.map(({ kind: _kind, ...line }) => line),
        fixture.id,
      ).toEqual(scanned);
    }
  });
});
