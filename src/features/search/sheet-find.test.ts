import { describe, expect, it } from "vitest";
import { blockIdOf, makeBlockAt } from "../../application/test-support/fakes";
import { parseCaption } from "../../domain/block/caption";
import { sheetMatches } from "./sheet-find";

function caption(text: string) {
  const parsed = parseCaption(text);
  if (!parsed.ok) throw new Error("bad caption");
  return parsed.value;
}

describe("sheetMatches", () => {
  it("lists matches in reading order with each one's place in its line and Block", () => {
    const lower = makeBlockAt(1, 0, 300);
    const right = { ...makeBlockAt(2, 400, 10), caption: caption("api") };
    const left = {
      ...makeBlockAt(3, 0, 10),
      caption: caption("API spec"),
      captionPosition: "above" as const,
    };
    const contents = new Map([
      [lower.blockId, "api"],
      [right.blockId, "API api\nno"],
      [left.blockId, "nothing"],
    ]);
    expect(sheetMatches([lower, right, left], contents, "api", false)).toEqual([
      {
        blockId: blockIdOf(3),
        place: "caption",
        line: 1,
        ordinal: 0,
        indexInBlock: 0,
      },
      {
        blockId: blockIdOf(2),
        place: "text",
        line: 1,
        ordinal: 0,
        indexInBlock: 0,
      },
      {
        blockId: blockIdOf(2),
        place: "text",
        line: 1,
        ordinal: 1,
        indexInBlock: 1,
      },
      {
        blockId: blockIdOf(2),
        place: "caption",
        line: 1,
        ordinal: 0,
        indexInBlock: 2,
      },
      {
        blockId: blockIdOf(1),
        place: "text",
        line: 1,
        ordinal: 0,
        indexInBlock: 0,
      },
    ]);
  });

  it("finds nothing for an empty text or with match case", () => {
    const block = makeBlockAt(1, 0, 0);
    const contents = new Map([[block.blockId, "API"]]);
    expect(sheetMatches([block], contents, "", false)).toEqual([]);
    expect(sheetMatches([block], contents, "api", true)).toEqual([]);
  });
});
