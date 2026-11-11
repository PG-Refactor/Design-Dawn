import { describe, expect, it } from "vitest";
import {
  findMatches,
  isValidQuery,
  occurrenceRange,
  replaceAll,
  replaceOccurrence,
  type TextQuery,
} from "./text-search";

const plain = (text: string, matchCase = false): TextQuery => ({
  text,
  matchCase,
  regex: false,
});
const pattern = (text: string, matchCase = false): TextQuery => ({
  text,
  matchCase,
  regex: true,
});

describe("findMatches", () => {
  it("finds every occurrence with its line, ignoring case unless asked", () => {
    expect(findMatches("Order\norder ORDER", plain("order"))).toEqual([
      { line: 1, start: 0, length: 5, lineText: "Order" },
      { line: 2, start: 0, length: 5, lineText: "order ORDER" },
      { line: 2, start: 6, length: 5, lineText: "order ORDER" },
    ]);
    expect(findMatches("Order\norder", plain("order", true))).toHaveLength(1);
  });

  it("counts offsets in characters", () => {
    expect(findMatches("設計😀注文", plain("注文"))[0]?.start).toBe(3);
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches("abc", plain(""))).toEqual([]);
  });

  it("finds a regular expression line by line, in characters", () => {
    expect(findMatches("😀注文12\nID 注文3", pattern("注文\\d+"))).toEqual([
      { line: 1, start: 1, length: 4, lineText: "😀注文12" },
      { line: 2, start: 3, length: 3, lineText: "ID 注文3" },
    ]);
    expect(findMatches("Api api", pattern("^API", true))).toEqual([]);
    expect(findMatches("Api api", pattern("^API"))).toHaveLength(1);
  });

  it("skips empty matches and finds nothing for an invalid pattern", () => {
    expect(findMatches("axxb", pattern("x*"))).toEqual([
      { line: 1, start: 1, length: 2, lineText: "axxb" },
    ]);
    expect(findMatches("(a)", pattern("("))).toEqual([]);
    expect(isValidQuery(pattern("("))).toBe(false);
    expect(isValidQuery(plain("("))).toBe(true);
  });
});

describe("replaceAll", () => {
  it("replaces every occurrence literally", () => {
    expect(replaceAll("a.b A.B", plain("a.b"), "$&x")).toEqual({
      text: "$&x $&x",
      count: 2,
    });
  });

  it("keeps the text when nothing matches", () => {
    expect(replaceAll("abc", plain("z"), "y")).toEqual({
      text: "abc",
      count: 0,
    });
  });

  it("honours matchCase", () => {
    expect(replaceAll("Api api", plain("api", true), "API").text).toBe(
      "Api API",
    );
  });

  it("fills in captured groups for a pattern, line by line", () => {
    expect(
      replaceAll(
        "id: 12\r\nid: 7",
        pattern("id: (?<n>\\d+)"),
        "ID-$1 $<n> $& $$",
      ),
    ).toEqual({ text: "ID-12 12 id: 12 $\r\nID-7 7 id: 7 $", count: 2 });
    expect(replaceAll("ab", pattern("b"), "[$2]").text).toBe("a[$2]");
  });
});

describe("replaceOccurrence", () => {
  it("replaces only the chosen occurrence of the chosen line", () => {
    expect(
      replaceOccurrence("ab ab\r\nAB ab", plain("ab"), "x", {
        line: 2,
        ordinal: 1,
      }),
    ).toEqual({ text: "ab ab\r\nAB x", count: 1 });
    expect(
      replaceOccurrence("ab ab\nab", plain("ab"), "x", { line: 1, ordinal: 0 })
        .text,
    ).toBe("x ab\nab");
  });

  it("works in characters", () => {
    expect(
      replaceOccurrence("😀注文 注文", plain("注文"), "受注", {
        line: 1,
        ordinal: 1,
      }).text,
    ).toBe("😀注文 受注");
  });

  it("uses the groups of a pattern", () => {
    expect(
      replaceOccurrence("v1 v2", pattern("v(\\d)"), "ver$1", {
        line: 1,
        ordinal: 1,
      }).text,
    ).toBe("v1 ver2");
  });

  it("changes nothing when the line no longer has that occurrence", () => {
    expect(
      replaceOccurrence("abc\nxyz", plain("ab"), "x", { line: 2, ordinal: 0 }),
    ).toEqual({ text: "abc\nxyz", count: 0 });
    expect(
      replaceOccurrence("Ab", plain("ab", true), "x", { line: 1, ordinal: 0 })
        .count,
    ).toBe(0);
    expect(
      replaceOccurrence("ab", plain("ab"), "x", { line: 3, ordinal: 0 }).count,
    ).toBe(0);
  });
});

describe("occurrenceRange", () => {
  it("gives the place in the whole text in UTF-16 units", () => {
    const text = "ab\r\n😀 api API";
    expect(
      occurrenceRange(text, plain("api"), { line: 2, ordinal: 1 }),
    ).toEqual({ start: 11, end: 14 });
    expect(text.slice(11, 14)).toBe("API");
    expect(
      occurrenceRange(text, pattern("a.i"), { line: 2, ordinal: 0 }),
    ).toEqual({ start: 7, end: 10 });
    expect(
      occurrenceRange(text, plain("api"), { line: 3, ordinal: 0 }),
    ).toBeNull();
  });
});
