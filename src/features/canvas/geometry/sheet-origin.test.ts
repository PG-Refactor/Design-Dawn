import { describe, expect, it } from "vitest";
import {
  keepMoveRightOfOrigin,
  keepOriginInView,
  sheetOriginOf,
} from "./sheet-origin";
import { clampViewport } from "./viewport-math";

const block = (x: number, y: number) => ({
  position: { x, y },
  size: { width: 100, height: 50 },
});

describe("sheetOriginOf", () => {
  it("is the world origin for an empty sheet and for blocks right of / below it", () => {
    expect(sheetOriginOf([])).toEqual({ x: 0, y: 0 });
    expect(sheetOriginOf([block(10, 20), block(300, 0)])).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("moves out to blocks left of or above the origin, per axis", () => {
    expect(sheetOriginOf([block(-640, 20), block(10, -120)])).toEqual({
      x: -640,
      y: -120,
    });
  });
});

describe("keepOriginInView", () => {
  const ORIGIN = { x: 0, y: 0 };

  it("keeps a view that is right of / below the origin unchanged", () => {
    const viewport = clampViewport({ panX: -200, panY: -10, zoom: 2 });
    expect(keepOriginInView(viewport, ORIGIN)).toBe(viewport);
  });

  it("stops the view at the origin, per axis, at any zoom", () => {
    expect(
      keepOriginInView(clampViewport({ panX: 30, panY: -10, zoom: 1 }), ORIGIN),
    ).toEqual({ panX: 0, panY: -10, zoom: 1 });
    expect(
      keepOriginInView(clampViewport({ panX: 5, panY: 7, zoom: 0.5 }), ORIGIN),
    ).toEqual({ panX: 0, panY: 0, zoom: 0.5 });
  });

  it("lets the view reach a moved-out origin, scaled by the zoom", () => {
    const origin = { x: -640, y: -120 };
    expect(
      keepOriginInView(
        clampViewport({ panX: 2000, panY: 100, zoom: 2 }),
        origin,
      ),
    ).toEqual({ panX: 1280, panY: 100, zoom: 2 });
  });
});

describe("keepMoveRightOfOrigin", () => {
  it("stops a selection at the origin", () => {
    const bounds = { x: 48, y: 24, width: 100, height: 100 };
    expect(keepMoveRightOfOrigin(bounds, { x: -100, y: -10 })).toEqual({
      x: -48,
      y: -10,
    });
    expect(keepMoveRightOfOrigin(bounds, { x: 30, y: 30 })).toEqual({
      x: 30,
      y: 30,
    });
  });

  it("lets a selection beyond the origin stay or come back, but not go further", () => {
    const bounds = { x: -640, y: 10, width: 100, height: 100 };
    expect(keepMoveRightOfOrigin(bounds, { x: -24, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(keepMoveRightOfOrigin(bounds, { x: 24, y: 0 })).toEqual({
      x: 24,
      y: 0,
    });
  });

  it("passes the move through when there is no selection box", () => {
    expect(keepMoveRightOfOrigin(null, { x: -5, y: -5 })).toEqual({
      x: -5,
      y: -5,
    });
  });
});
