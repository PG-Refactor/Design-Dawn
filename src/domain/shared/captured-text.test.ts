import { describe, expect, it } from "vitest";
import { capturedText } from "./captured-text";

describe("capturedText", () => {
  it("is the text of a group, or empty for an optional group that did not match", () => {
    const match = /^(a)(b)?$/.exec("a");
    if (match === null) throw new Error("no match");
    expect(capturedText(match, 1)).toBe("a");
    expect(capturedText(match, 2)).toBe("");
  });
});
