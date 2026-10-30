import { describe, expect, it } from "vitest";
import {
  encodePieLabel,
  hasLoneCarriageReturn,
  hasMarkupRewrite,
  hasStyleLikeText,
  normalizePieTitle,
  validatePieTitle,
  validatePieValueText,
} from "./pie-text";

describe("pie text rules", () => {
  it("encodes a double quote as #quot; and leaves other text as it is", () => {
    expect(encodePieLabel('a"b"c')).toEqual({
      ok: true,
      value: "a#quot;b#quot;c",
    });
    expect(encodePieLabel("  犬🐶 ' < > & ; : ] [ # a%%b  ")).toEqual({
      ok: true,
      value: "  犬🐶 ' < > & ; : ] [ # a%%b  ",
    });
    expect(encodePieLabel("")).toEqual({ ok: true, value: "" });
  });

  it.each(["\n", "\r", "\t", "\u0000", "\u007f", "\u0085", " ", " "])(
    "refuses the control character %j",
    (character) => {
      const result = encodePieLabel(`a${character}b`);
      expect(
        !result.ok && result.error.detail.startsWith("controlCharacter:"),
      ).toBe(true);
    },
  );

  it("does not refuse what Mermaid reads back unchanged, and does refuse what it alters", () => {
    expect(encodePieLabel("%% not a directive").ok).toBe(true);
    expect(encodePieLabel("%% {x}").ok).toBe(true);
    expect(encodePieLabel("a %%{x}%% b").ok).toBe(false);
    expect(encodePieLabel("a\\b").ok).toBe(false);
    expect(encodePieLabel("#amp;").ok).toBe(false);
    expect(encodePieLabel("#1;").ok).toBe(false);
    expect(encodePieLabel("# 1;").ok).toBe(true);
  });

  it("detects Mermaid's rewrites of the text", () => {
    expect(hasMarkupRewrite('<a href="q">')).toBe(true);
    expect(hasMarkupRewrite("<a href='q'>")).toBe(false);
    expect(hasMarkupRewrite("<b>x</b> <br/>")).toBe(false);
    expect(hasStyleLikeText("style x:#a;")).toBe(true);
    expect(hasStyleLikeText("classDef a:#b;")).toBe(true);
    expect(hasStyleLikeText("style x: #a;")).toBe(false);
    expect(hasLoneCarriageReturn("a\rb")).toBe(true);
    expect(hasLoneCarriageReturn("a\r\nb")).toBe(false);
  });

  it("normalises a title the way Mermaid does", () => {
    expect(normalizePieTitle("  a \t b   c ")).toBe("a b c");
    expect(validatePieTitle("a b")).toEqual({ ok: true, value: "a b" });
    expect(validatePieTitle("a  b").ok).toBe(false);
    expect(validatePieTitle(" a").ok).toBe(false);
  });

  it("validates value text without reformatting it", () => {
    for (const [text, value] of [
      ["0", 0],
      ["10", 10],
      ["1.50", 1.5],
      ["00.5", 0.5],
      ["007.5", 7.5],
    ] as const) {
      expect(validatePieValueText(text)).toEqual({ ok: true, value });
    }
    for (const text of [
      "",
      "-0",
      "-1",
      "+1",
      ".5",
      "1.",
      "1e3",
      "01",
      "0x1",
      "NaN",
      "Infinity",
      " 1",
      "1 ",
      "1,5",
    ]) {
      expect(validatePieValueText(text).ok, text).toBe(false);
    }
  });
});
