import { describe, expect, it } from "vitest";
import {
  blockIdOf,
  makeBlockAt,
} from "../../../application/test-support/fakes";
import {
  applyRangeHit,
  blocksHitByRect,
  normalizeRect,
  rectsIntersect,
} from "./range-selection";

const RECT = { x: 100, y: 100, width: 50, height: 40 };

describe("normalizeRect", () => {
  const expected = { x: 10, y: 20, width: 30, height: 40 };

  it("gives the same rectangle for all four drag directions", () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected);
    expect(normalizeRect({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected);
    expect(normalizeRect({ x: 10, y: 60 }, { x: 40, y: 20 })).toEqual(expected);
    expect(normalizeRect({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
  });

  it("is empty-sized for a single point", () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("rectsIntersect", () => {
  it("is true for partial overlap and for full containment either way", () => {
    expect(
      rectsIntersect(RECT, { x: 120, y: 120, width: 100, height: 100 }),
    ).toBe(true);
    expect(
      rectsIntersect(RECT, { x: 0, y: 0, width: 1000, height: 1000 }),
    ).toBe(true);
    expect(rectsIntersect(RECT, { x: 110, y: 110, width: 5, height: 5 })).toBe(
      true,
    );
  });

  it("counts touching edges and corners as intersecting", () => {
    expect(
      rectsIntersect(RECT, { x: 150, y: 100, width: 10, height: 10 }),
    ).toBe(true);
    expect(
      rectsIntersect(RECT, { x: 100, y: 140, width: 10, height: 10 }),
    ).toBe(true);
    expect(rectsIntersect(RECT, { x: 50, y: 60, width: 50, height: 40 })).toBe(
      true,
    );
  });

  it("is false for disjoint rectangles", () => {
    expect(
      rectsIntersect(RECT, { x: 151, y: 100, width: 10, height: 10 }),
    ).toBe(false);
    expect(
      rectsIntersect(RECT, { x: 100, y: 141, width: 10, height: 10 }),
    ).toBe(false);
    expect(rectsIntersect(RECT, { x: 0, y: 0, width: 99, height: 99 })).toBe(
      false,
    );
  });
});

// makeBlockAt gives every block the size 100 x 50.
const BLOCKS = [
  makeBlockAt(1, 0, 0),
  makeBlockAt(2, 300, 0),
  makeBlockAt(3, 0, 200),
];

describe("blocksHitByRect", () => {
  it("returns no block when the rectangle hits none", () => {
    expect(
      blocksHitByRect(BLOCKS, { x: 150, y: 100, width: 100, height: 50 }),
    ).toEqual([]);
  });

  it("returns one block, including a touching edge", () => {
    expect(
      blocksHitByRect(BLOCKS, { x: 100, y: 20, width: 50, height: 10 }),
    ).toEqual([blockIdOf(1)]);
  });

  it("returns every hit block back-to-front", () => {
    expect(
      blocksHitByRect(BLOCKS, { x: -10, y: -10, width: 1000, height: 1000 }),
    ).toEqual([blockIdOf(1), blockIdOf(2), blockIdOf(3)]);
  });
});

describe("applyRangeHit", () => {
  const current = new Set([blockIdOf(1), blockIdOf(2)]);

  it("replace: the hit blocks become the selection, none hit empties it", () => {
    expect(applyRangeHit(current, [blockIdOf(3)], "replace")).toEqual([
      blockIdOf(3),
    ]);
    expect(applyRangeHit(current, [], "replace")).toEqual([]);
  });

  it("toggle: flips each hit block and keeps the others", () => {
    expect(
      applyRangeHit(current, [blockIdOf(2), blockIdOf(3)], "toggle"),
    ).toEqual([blockIdOf(1), blockIdOf(3)]);
    expect(applyRangeHit(current, [], "toggle")).toEqual([
      blockIdOf(1),
      blockIdOf(2),
    ]);
  });
});
