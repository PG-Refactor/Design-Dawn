import { describe, expect, it } from "vitest";
import { applyTextEdits, type TextEdit } from "./text-edit";

const edit = (start: number, end: number, text: string): TextEdit => ({
  start,
  end,
  text,
});

function applied(source: string, edits: readonly TextEdit[]) {
  const result = applyTextEdits(source, edits);
  if (!result.ok) throw new Error(`unexpected error: ${result.error.kind}`);
  return result.value;
}

function failureKind(source: string, edits: readonly TextEdit[]) {
  const result = applyTextEdits(source, edits);
  if (result.ok) throw new Error("expected an error");
  return result.error.kind;
}

describe("applyTextEdits", () => {
  it("replaces, inserts and deletes", () => {
    expect(applied("abcdef", [edit(1, 3, "XY")])).toEqual({
      text: "aXYdef",
      changed: true,
    });
    expect(applied("abc", [edit(1, 1, "-")]).text).toBe("a-bc");
    expect(applied("abc", [edit(1, 2, "")]).text).toBe("ac");
    expect(applied("abc", [edit(3, 3, "!")]).text).toBe("abc!");
    expect(applied("", [edit(0, 0, "x")]).text).toBe("x");
  });

  it("applies several edits given out of order in original coordinates", () => {
    expect(
      applied("0123456789", [
        edit(8, 9, "<8>"),
        edit(0, 1, "<0>"),
        edit(4, 4, "|"),
      ]).text,
    ).toBe("<0>123|4567<8>9");
  });

  it("accepts edits that only touch", () => {
    expect(applied("abcd", [edit(0, 2, "X"), edit(2, 4, "Y")]).text).toBe("XY");
    expect(applied("abcd", [edit(1, 3, "X"), edit(1, 1, "<")]).text).toBe(
      "a<Xd",
    );
    expect(applied("abcd", [edit(1, 3, "X"), edit(3, 3, ">")]).text).toBe(
      "aX>d",
    );
    expect(applied("abcd", [edit(1, 1, "<"), edit(1, 3, "X")]).text).toBe(
      "a<Xd",
    );
  });

  it("rejects overlapping edits", () => {
    expect(failureKind("abcdef", [edit(0, 3, "x"), edit(2, 4, "y")])).toBe(
      "overlappingTextEdits",
    );
    expect(failureKind("abcdef", [edit(1, 5, "x"), edit(3, 3, "y")])).toBe(
      "overlappingTextEdits",
    );
    expect(failureKind("abcdef", [edit(1, 3, "x"), edit(1, 3, "y")])).toBe(
      "overlappingTextEdits",
    );
    expect(failureKind("abcdef", [edit(0, 6, "x"), edit(2, 3, "y")])).toBe(
      "overlappingTextEdits",
    );
  });

  it("rejects two insertions at the same offset instead of ordering them", () => {
    expect(failureKind("abc", [edit(1, 1, "x"), edit(1, 1, "y")])).toBe(
      "ambiguousTextEdits",
    );
    expect(failureKind("abc", [edit(1, 1, "x"), edit(1, 1, "x")])).toBe(
      "ambiguousTextEdits",
    );
  });

  it("rejects offsets that are out of range, negative or not integers", () => {
    expect(failureKind("abc", [edit(0, 4, "")])).toBe("invalidTextEdit");
    expect(failureKind("abc", [edit(4, 4, "")])).toBe("invalidTextEdit");
    expect(failureKind("abc", [edit(-1, 1, "")])).toBe("invalidTextEdit");
    expect(failureKind("abc", [edit(2, 1, "")])).toBe("invalidTextEdit");
    expect(failureKind("abc", [edit(0.5, 1, "")])).toBe("invalidTextEdit");
    expect(failureKind("abc", [edit(0, Number.NaN, "")])).toBe(
      "invalidTextEdit",
    );
    expect(failureKind("abc", [edit(0, Number.POSITIVE_INFINITY, "")])).toBe(
      "invalidTextEdit",
    );
  });

  it("rejects a boundary inside a surrogate pair but not around it", () => {
    const source = "a😀b";
    expect(failureKind(source, [edit(2, 3, "x")])).toBe("invalidTextEdit");
    expect(failureKind(source, [edit(1, 2, "x")])).toBe("invalidTextEdit");
    expect(applied(source, [edit(1, 3, "x")]).text).toBe("axb");
    expect(applied(source, [edit(3, 3, "-")]).text).toBe("a😀-b");
  });

  it("lands exactly after Japanese text and emoji", () => {
    const source = "日本語😀 word end";
    const start = source.indexOf("word");
    expect(start).toBe(6);
    expect(
      applied(source, [edit(start, start + "word".length, "WORD")]).text,
    ).toBe("日本語😀 WORD end");
  });

  it("is not changed by an empty list or by identical replacements", () => {
    expect(applied("abc", [])).toEqual({ text: "abc", changed: false });
    expect(applied("abc", [edit(1, 2, "b"), edit(0, 0, "")])).toEqual({
      text: "abc",
      changed: false,
    });
  });

  it("does not touch the input edit list", () => {
    const edits = [edit(2, 3, "x"), edit(0, 1, "y")];
    applied("abcd", edits);
    expect(edits).toEqual([edit(2, 3, "x"), edit(0, 1, "y")]);
  });

  it("keeps line terminators outside the edits untouched", () => {
    expect(applied("a\r\nb\r\nc", [edit(3, 4, "B")]).text).toBe("a\r\nB\r\nc");
  });
});
