import { describe, expect, it } from "vitest";
import { CANVAS_CONFIG } from "../../../config/canvas-config";
import {
  homeViewport,
  isOriginOutOfView,
  keepMoveRightOfOrigin,
  keepOriginInView,
  sheetOriginOf,
} from "./sheet-origin";

const MARGIN = CANVAS_CONFIG.viewport.originMargin;

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

  it("stops the view one margin inside the edge, per axis, scaled by the zoom", () => {
    expect(
      keepOriginInView(clampViewport({ panX: 30, panY: -10, zoom: 1 }), ORIGIN),
    ).toEqual({ panX: MARGIN, panY: -10, zoom: 1 });
    expect(
      keepOriginInView(
        clampViewport({ panX: 50, panY: 70, zoom: 0.5 }),
        ORIGIN,
      ),
    ).toEqual({ panX: MARGIN * 0.5, panY: MARGIN * 0.5, zoom: 0.5 });
  });

  it("lets the view reach a moved-out origin, scaled by the zoom", () => {
    const origin = { x: -640, y: -120 };
    expect(
      keepOriginInView(
        clampViewport({ panX: 2000, panY: 100, zoom: 2 }),
        origin,
      ),
    ).toEqual({ panX: (640 + MARGIN) * 2, panY: 100, zoom: 2 });
  });
});

describe("homeViewport and isOriginOutOfView", () => {
  const ORIGIN = { x: 0, y: 0 };

  it("puts the corner one margin inside the edge, keeping the zoom", () => {
    expect(homeViewport(ORIGIN, 2)).toEqual({
      panX: MARGIN * 2,
      panY: MARGIN * 2,
      zoom: 2,
    });
    expect(homeViewport({ x: -100, y: 0 }, 1)).toEqual({
      panX: 100 + MARGIN,
      panY: MARGIN,
      zoom: 1,
    });
  });

  it("tells when the corner was scrolled past on either axis", () => {
    const view = (panX: number, panY: number) =>
      clampViewport({ panX, panY, zoom: 1 });
    expect(isOriginOutOfView(view(MARGIN, MARGIN), ORIGIN)).toBe(false);
    expect(isOriginOutOfView(view(0, 0), ORIGIN)).toBe(false);
    expect(isOriginOutOfView(view(-1, 0), ORIGIN)).toBe(true);
    expect(isOriginOutOfView(view(0, -50), ORIGIN)).toBe(true);
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
