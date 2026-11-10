import { describe, expect, it } from "vitest";
import { findMatches, replaceAll } from "./text-search";

describe("findMatches", () => {
  it("finds every occurrence with its line, ignoring case unless asked", () => {
    expect(findMatches("Order\norder ORDER", "order", false)).toEqual([
      { line: 1, start: 0, length: 5, lineText: "Order" },
      { line: 2, start: 0, length: 5, lineText: "order ORDER" },
      { line: 2, start: 6, length: 5, lineText: "order ORDER" },
    ]);
    expect(findMatches("Order\norder", "order", true)).toHaveLength(1);
  });

  it("counts offsets in characters", () => {
    expect(findMatches("設計😀注文", "注文", false)[0]?.start).toBe(3);
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches("abc", "", false)).toEqual([]);
  });
});

describe("replaceAll", () => {
  it("replaces every occurrence literally", () => {
    expect(replaceAll("a.b A.B", "a.b", "$&x", false)).toEqual({
      text: "$&x $&x",
      count: 2,
    });
  });

  it("keeps the text when nothing matches", () => {
    expect(replaceAll("abc", "z", "y", false)).toEqual({
      text: "abc",
      count: 0,
    });
  });

  it("honours matchCase", () => {
    expect(replaceAll("Api api", "api", "API", true).text).toBe("Api API");
  });
});
