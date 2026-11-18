import { describe, expect, it } from "vitest";
import { freePlacement } from "./free-placement";

const SEARCH = { step: 10, rings: 5 };
const SIZE = { width: 20, height: 20 };

describe("freePlacement", () => {
  it("keeps the start when nothing is there", () => {
    expect(freePlacement({ x: 50, y: 50 }, SIZE, [], SEARCH)).toEqual({
      x: 50,
      y: 50,
    });
  });

  it("moves to the nearest place that covers nothing", () => {
    const taken = [{ x: 40, y: 40, width: 30, height: 30 }];
    const placed = freePlacement({ x: 50, y: 50 }, SIZE, taken, SEARCH);
    expect(placed).not.toBeNull();
    const { x, y } = placed ?? { x: 0, y: 0 };
    const covers = x < 70 && 40 < x + 20 && y < 70 && 40 < y + 20;
    expect(covers).toBe(false);
    // A neighbour ring, not far away.
    expect(Math.max(Math.abs(x - 50), Math.abs(y - 50))).toBeLessThanOrEqual(
      30,
    );
  });

  it("never goes left of or above the origin, and gives up when everything is taken", () => {
    const everything = [{ x: 0, y: 0, width: 1000, height: 1000 }];
    expect(freePlacement({ x: 0, y: 0 }, SIZE, everything, SEARCH)).toBeNull();
    const placed = freePlacement(
      { x: 0, y: 0 },
      SIZE,
      [{ x: 0, y: 0, width: 20, height: 20 }],
      SEARCH,
    );
    expect(placed?.x).toBeGreaterThanOrEqual(0);
    expect(placed?.y).toBeGreaterThanOrEqual(0);
  });

  it("prefers a free place wholly in view, else one partly outside", () => {
    const view = { x: 0, y: 0, width: 300, height: 200 };
    const size = { width: 100, height: 100 };
    // The centre and the place below it are free, but below is outside the view; the
    // centre is taken, so the place to the right (in view) wins over the one below.
    const taken = [{ x: 100, y: 50, width: 100, height: 100 }];
    const search = { step: 100, rings: 2 };
    const placed = freePlacement({ x: 100, y: 50 }, size, taken, search, view);
    expect(placed).not.toBeNull();
    if (placed === null) return;
    expect(placed.x + size.width <= view.width).toBe(true);
    expect(placed.y + size.height <= view.height).toBe(true);
    // Nothing free in view: the nearest free place anywhere.
    const full = [{ x: 0, y: 0, width: 300, height: 200 }];
    expect(
      freePlacement({ x: 100, y: 50 }, size, full, search, view),
    ).not.toBeNull();
  });
});
