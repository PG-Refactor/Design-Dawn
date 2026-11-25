import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import {
  append,
  assessment,
  DEFAULT_INDENT,
  indentOf,
  insertAfter,
  leadingWhitespace,
  readLines,
  removeLine,
  requireIdentifier,
  requireText,
  verifyMeaning,
} from "./listed-common";

function edited(source: string, edit: ReturnType<typeof append>): string {
  const applied = applyTextEdits(source, [edit]);
  if (!applied.ok) throw new Error(applied.error.detail);
  return applied.value.text;
}

describe("reading lines", () => {
  it("has no header for an empty text, and uses the default indentation", () => {
    const read = readLines("");
    expect(read.header).toBeNull();
    expect(indentOf(read)).toBe(DEFAULT_INDENT);
  });

  it("takes the indentation of the first statement, tabs included", () => {
    const read = readLines("erDiagram\n\tA\n");
    expect(indentOf(read)).toBe("\t");
    const first = read.statements[0];
    if (first === undefined) throw new Error("no statement");
    expect(leadingWhitespace(first)).toBe("\t");
  });
});

describe("line edits", () => {
  it("removes a last line without a break, with the break before it", () => {
    const source = "erDiagram\n    A";
    const read = readLines(source);
    const last = read.lines[1];
    if (last === undefined) throw new Error("no line");
    expect(edited(source, removeLine(last, read.lines))).toBe("erDiagram");
  });

  it("removes a line that is the whole text", () => {
    const read = readLines("erDiagram");
    const only = read.lines[0];
    if (only === undefined) throw new Error("no line");
    expect(edited("erDiagram", removeLine(only, read.lines))).toBe("");
  });

  it("inserts after a last line without a break, adding one, and keeps CRLF", () => {
    const plain = readLines("erDiagram");
    const header = plain.lines[0];
    if (header === undefined) throw new Error("no line");
    expect(edited("erDiagram", insertAfter(header, ["    A", "    B"]))).toBe(
      "erDiagram\n    A\n    B",
    );
    const crlf = readLines("erDiagram\r\n    A\r\n");
    const first = crlf.lines[0];
    if (first === undefined) throw new Error("no line");
    expect(
      edited("erDiagram\r\n    A\r\n", insertAfter(first, ["    B"])),
    ).toBe("erDiagram\r\n    B\r\n    A\r\n");
  });

  it("appends to an empty text as its only lines", () => {
    expect(edited("", append(readLines(""), ["erDiagram", "    A"]))).toBe(
      "erDiagram\n    A",
    );
  });
});

describe("checks", () => {
  it("accepts one-word names only", () => {
    expect(requireIdentifier("Order_1", "entity").ok).toBe(true);
    const refused = requireIdentifier("two words", "entity");
    expect(!refused.ok && refused.error.detail).toContain("invalidName");
  });

  it("trims text, refusing a line break or a forbidden character", () => {
    const trimmed = requireText("  label  ", "label", /"/);
    expect(trimmed.ok && trimmed.value).toBe("label");
    expect(requireText("a\nb", "label", /"/).ok).toBe(false);
    expect(requireText('a"b', "label", /"/).ok).toBe(false);
  });

  it("assesses readable and unreadable diagrams", () => {
    expect(assessment(null)).toEqual({ editable: true });
    const lines = [{ index: 1, start: 4, end: 9 }];
    expect(assessment({ reason: "unsupportedLines", lines })).toEqual({
      editable: false,
      reason: "unsupportedLines",
      detail: "unsupportedLines",
      unsupported: lines,
    });
  });

  it("verifies a candidate by its meaning", () => {
    expect(verifyMeaning({ editable: true, meaning: [1] }, [1]).ok).toBe(true);
    const mismatch = verifyMeaning({ editable: true, meaning: [1] }, [2]);
    expect(!mismatch.ok && mismatch.error.kind).toBe("diagramMeaningMismatch");
    const unreadable = verifyMeaning({ editable: false, meaning: [1] }, [1]);
    expect(!unreadable.ok && unreadable.error.kind).toBe("diagramNotEditable");
  });
});
