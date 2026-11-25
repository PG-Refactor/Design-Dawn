import { describe, expect, it } from "vitest";
import { scanLines } from "./source-lines";
import { applyTextEdits, type TextEdit } from "./text-edit";
import {
  appendLineEdit,
  deleteLinesEdits,
  dominantLineEnding,
  type TextLine,
} from "./text-lines";

// The lines of a text, as the readers keep them.
const linesOf = (text: string): readonly TextLine[] => scanLines(text);

function edited(text: string, edits: readonly TextEdit[]): string {
  const applied = applyTextEdits(text, edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  return applied.value.text;
}

describe("line endings", () => {
  it("follows the break most lines have, and the fallback on a tie", () => {
    expect(dominantLineEnding(linesOf("a\r\nb\r\nc\n"), "\n")).toBe("\r\n");
    expect(dominantLineEnding(linesOf("a\r\nb\n"), "\n")).toBe("\n");
    expect(dominantLineEnding(linesOf("a"), "\n")).toBe("\n");
  });
});

describe("appending a line", () => {
  it("adds it at the end, keeping a missing final break missing", () => {
    expect(edited("a\n", [appendLineEdit(linesOf("a\n"), "b", "\n")])).toBe(
      "a\nb\n",
    );
    expect(edited("a", [appendLineEdit(linesOf("a"), "b", "\n")])).toBe("a\nb");
    expect(edited("", [appendLineEdit([], "b", "\n")])).toBe("b\n");
  });
});

describe("deleting lines", () => {
  it("deletes neighbouring lines as one range and the last line with the break before it", () => {
    const text = "a\nb\nc\nd";
    expect(edited(text, deleteLinesEdits(linesOf(text), new Set([1, 2])))).toBe(
      "a\nd",
    );
    expect(edited(text, deleteLinesEdits(linesOf(text), new Set([3])))).toBe(
      "a\nb\nc",
    );
    expect(edited("a", deleteLinesEdits(linesOf("a"), new Set([0])))).toBe("");
  });

  it("skips lines that are not there", () => {
    expect(deleteLinesEdits(linesOf("a\n"), new Set([-1, 9]))).toEqual([]);
  });
});
