import { describe, expect, it } from "vitest";
import { boundsOfRects } from "./selection-bounds";
import {
  type ResizeEdges,
  snappedMoveDelta,
  snappedResizeFrame,
  snapToGrid,
} from "./snap";

const INTERVAL = 24;
const MIN_SIZE = { width: 48, height: 32 };

describe("snapToGrid", () => {
  it.each([
    [0, 0],
    [5, 0],
    [11, 0],
    [12, 24],
    [13, 24],
    [23, 24],
    [24, 24],
    [25, 24],
    [35, 24],
    [36, 48],
    [100, 96],
    [-1, 0],
    [-11, 0],
    [-12, 0],
    [-13, -24],
    [-23, -24],
    [-24, -24],
    [-25, -24],
    [-36, -24],
    [-37, -48],
    [48, 48],
    [47, 48],
    [49, 48],
  ])("snaps %d to %d", (value, expected) => {
    expect(snapToGrid(value, INTERVAL)).toBe(expected);
  });

  it("rounds exact half-way values toward +infinity", () => {
    expect(snapToGrid(12, INTERVAL)).toBe(24);
    expect(snapToGrid(-12, INTERVAL)).toBe(0);
    expect(snapToGrid(-36, INTERVAL)).toBe(-24);
  });

  it("never returns -0", () => {
    for (const value of [-0, -1, -11, -12, 0]) {
      expect(Object.is(snapToGrid(value, INTERVAL), -0)).toBe(false);
    }
  });
});

describe("snappedMoveDelta", () => {
  it("lands the top-left of the box on the grid", () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 };
    expect(snappedMoveDelta(bounds, { x: 30, y: 10 }, INTERVAL)).toEqual({
      x: 38,
      y: 4,
    });
  });

  it("is zero when the box stays on its grid line", () => {
    const bounds = { x: 48, y: -24, width: 100, height: 50 };
    const delta = snappedMoveDelta(bounds, { x: 3, y: -4 }, INTERVAL);
    expect(delta).toEqual({ x: 0, y: 0 });
    expect(Object.is(delta.x, -0)).toBe(false);
  });

  it("moves a selection as one box: relative positions are preserved exactly", () => {
    // Two blocks that are off-grid relative to each other.
    const first = { x: 10, y: 20, width: 100, height: 50 };
    const second = { x: 33, y: 71, width: 100, height: 50 };
    const bounds = boundsOfRects([first, second]);
    if (bounds === null) throw new Error("bounds expected");
    const raw = { x: 5, y: 5 };
    const delta = snappedMoveDelta(bounds, raw, INTERVAL);

    const movedFirst = { x: first.x + delta.x, y: first.y + delta.y };
    const movedSecond = { x: second.x + delta.x, y: second.y + delta.y };
    expect(movedSecond.x - movedFirst.x).toBe(second.x - first.x);
    expect(movedSecond.y - movedFirst.y).toBe(second.y - first.y);
    // The box corner is on the grid; the individual blocks are not.
    expect((bounds.x + delta.x) % INTERVAL).toBe(0);
    expect((bounds.y + delta.y) % INTERVAL).toBe(0);

    // Snapping each block on its own would destroy the layout: NOT what is done.
    const individualFirst = snapToGrid(first.x + raw.x, INTERVAL);
    const individualSecond = snapToGrid(second.x + raw.x, INTERVAL);
    expect(individualSecond - individualFirst).not.toBe(second.x - first.x);
  });
});

describe("boundsOfRects", () => {
  it("is null for no rectangles and the union otherwise", () => {
    expect(boundsOfRects([])).toBeNull();
    expect(
      boundsOfRects([
        { x: 10, y: 20, width: 100, height: 50 },
        { x: -5, y: 60, width: 10, height: 100 },
      ]),
    ).toEqual({ x: -5, y: 20, width: 115, height: 140 });
  });
});

describe("snappedResizeFrame", () => {
  const start = { x: 10, y: 20, width: 100, height: 50 };
  const resize = (edges: ResizeEdges, dx: number, dy: number) =>
    snappedResizeFrame(start, { x: dx, y: dy }, edges, INTERVAL, MIN_SIZE);

  it("snaps the right edge only", () => {
    expect(resize({ right: true }, 40, 99)).toEqual({
      x: 10,
      y: 20,
      width: 134,
      height: 50,
    });
  });

  it("snaps the bottom edge only", () => {
    expect(resize({ bottom: true }, 99, 25)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 76,
    });
  });

  it("snaps the left edge only (the right edge stays)", () => {
    expect(resize({ left: true }, 20, 99)).toEqual({
      x: 24,
      y: 20,
      width: 86,
      height: 50,
    });
  });

  it("snaps the top edge only (the bottom edge stays)", () => {
    expect(resize({ top: true }, 99, -10)).toEqual({
      x: 10,
      y: 0,
      width: 100,
      height: 70,
    });
  });

  it("handles all four corners", () => {
    expect(resize({ left: true, top: true }, 20, -10)).toEqual({
      x: 24,
      y: 0,
      width: 86,
      height: 70,
    });
    expect(resize({ right: true, top: true }, 40, -10)).toEqual({
      x: 10,
      y: 0,
      width: 134,
      height: 70,
    });
    expect(resize({ left: true, bottom: true }, 20, 25)).toEqual({
      x: 24,
      y: 20,
      width: 86,
      height: 76,
    });
    expect(resize({ right: true, bottom: true }, 40, 25)).toEqual({
      x: 10,
      y: 20,
      width: 134,
      height: 76,
    });
  });

  it("keeps the fixed edges exactly where they were", () => {
    const frame = resize({ left: true, top: true }, 33, 17);
    expect(frame.x + frame.width).toBe(110);
    expect(frame.y + frame.height).toBe(70);
    const other = resize({ right: true, bottom: true }, 33, 17);
    expect(other.x).toBe(10);
    expect(other.y).toBe(20);
  });

  it("enforces the minimum width by pulling the snapped edge back", () => {
    expect(resize({ right: true }, -90, 0)).toMatchObject({
      x: 10,
      width: 48,
    });
    expect(resize({ left: true }, 90, 0)).toMatchObject({
      x: 62,
      width: 48,
    });
  });

  it("enforces a minimum height that is not a multiple of the grid", () => {
    expect(MIN_SIZE.height % INTERVAL).not.toBe(0);
    expect(resize({ bottom: true }, 0, -30)).toMatchObject({
      y: 20,
      height: 32,
    });
    expect(resize({ top: true }, 0, 40)).toMatchObject({
      y: 38,
      height: 32,
    });
  });

  it("does not touch an axis that has no moving edge", () => {
    expect(resize({ right: true }, 40, -5000).height).toBe(50);
  });

  it("defaults to the canvas minimum size", () => {
    const frame = snappedResizeFrame(
      start,
      { x: -5000, y: -5000 },
      { right: true, bottom: true },
      INTERVAL,
    );
    expect(frame).toMatchObject({ width: 48, height: 32 });
  });
});
