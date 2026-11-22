import { describe, expect, it } from "vitest";
import { CAPTION_MAX_CODE_POINTS } from "../domain-constants";
import { unwrap } from "../shared/test-support";
import {
  type Caption,
  captionFieldsOf,
  figureCaptionOf,
  parseCaption,
  parseCaptionPosition,
  sameFigureCaption,
} from "./caption";

const TEXT = unwrap(parseCaption("Figure 1"));

describe("captions", () => {
  it("accepts one line of text up to the limit", () => {
    expect(parseCaption("Figure 1").ok).toBe(true);
    expect(parseCaption("x".repeat(CAPTION_MAX_CODE_POINTS)).ok).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["only whitespace", "   "],
    ["too long", "x".repeat(CAPTION_MAX_CODE_POINTS + 1)],
    ["a line break", "a\nb"],
  ])("refuses a caption that is %s", (_what, value) => {
    const parsed = parseCaption(value);
    expect(!parsed.ok && parsed.error.kind).toBe("invalidCaption");
  });

  it("knows the two positions only", () => {
    expect(unwrap(parseCaptionPosition("above"))).toBe("above");
    expect(parseCaptionPosition("left").ok).toBe(false);
  });
});

describe("caption fields", () => {
  it("carries only the keys that are there", () => {
    expect(captionFieldsOf({})).toEqual({});
    expect(
      captionFieldsOf({ caption: TEXT, captionPosition: "above" }),
    ).toEqual({ caption: TEXT, captionPosition: "above" });
  });

  it("is a figure caption with the default position when none is written", () => {
    expect(figureCaptionOf({})).toBeNull();
    expect(figureCaptionOf({ caption: TEXT })).toEqual({
      text: TEXT,
      position: "below",
    });
    expect(
      figureCaptionOf({ caption: TEXT, captionPosition: "above" }),
    ).toEqual({ text: TEXT, position: "above" });
  });

  it("compares by text and position", () => {
    const below = { text: TEXT, position: "below" } as const;
    expect(sameFigureCaption(null, null)).toBe(true);
    expect(sameFigureCaption(below, null)).toBe(false);
    expect(sameFigureCaption(null, below)).toBe(false);
    expect(sameFigureCaption(below, { ...below })).toBe(true);
    expect(sameFigureCaption(below, { ...below, position: "above" })).toBe(
      false,
    );
    expect(
      sameFigureCaption(below, { ...below, text: "Other" as Caption }),
    ).toBe(false);
  });
});
