import { describe, expect, it } from "vitest";
import { capturedText } from "./captured-text";
import { err, mapOk, ok } from "./domain-result";

describe("capturedText", () => {
  it("is the text of a group, or empty for an optional group that did not match", () => {
    const match = /^(a)(b)?$/.exec("a");
    if (match === null) throw new Error("no match");
    expect(capturedText(match, 1)).toBe("a");
    expect(capturedText(match, 2)).toBe("");
  });
});

describe("mapOk", () => {
  it("changes a success and keeps a failure", () => {
    expect(mapOk(ok(2), (value) => value * 2)).toEqual(ok(4));
    const failure = err("entityNotFound", "x");
    expect(mapOk(failure, (value: number) => value * 2)).toBe(failure);
  });
});
