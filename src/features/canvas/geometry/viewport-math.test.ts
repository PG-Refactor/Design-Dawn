import { describe, expect, it } from "vitest";
import {
  parseViewport,
  type RawViewport,
  type Viewport,
} from "../../../application/local-state/viewport";
import { CANVAS_CONFIG } from "../../../config/canvas-config";
import {
  clampViewport,
  DEFAULT_VIEWPORT,
  panBy,
  screenDeltaToWorld,
  screenToWorld,
  viewportCenterWorld,
  visibleWorldRect,
  worldLayerTransform,
  worldRectToScreen,
  worldSizeToScreen,
  worldToScreen,
  zoomAt,
  zoomByWheel,
} from "./viewport-math";

function viewportOf(raw: RawViewport): Viewport {
  const parsed = parseViewport(raw);
  if (!parsed.ok) throw new Error("fixture viewport is valid");
  return parsed.value;
}

const { zoomMin, zoomMax, panLimit } = CANVAS_CONFIG.viewport;
const ZOOMS = [zoomMin, 1, zoomMax];
const PANS = [
  { panX: 0, panY: 0 },
  { panX: 250.5, panY: -130.25 },
  { panX: -panLimit + 1, panY: panLimit - 1 },
];

describe("world <-> screen", () => {
  it("follows screen = world * zoom + pan", () => {
    const viewport = viewportOf({ panX: 100, panY: -50, zoom: 2 });
    expect(worldToScreen({ x: 10, y: 20 }, viewport)).toEqual({
      x: 120,
      y: -10,
    });
    expect(screenToWorld({ x: 120, y: -10 }, viewport)).toEqual({
      x: 10,
      y: 20,
    });
  });

  it("round-trips at the zoom limits, with fractional screen points and large pans", () => {
    for (const zoom of ZOOMS) {
      for (const pan of PANS) {
        const viewport = viewportOf({ ...pan, zoom });
        for (const screen of [
          { x: 0, y: 0 },
          { x: 123.456, y: -78.9 },
          { x: 1920.25, y: 1080.75 },
        ]) {
          const world = screenToWorld(screen, viewport);
          const back = worldToScreen(world, viewport);
          // Relative tolerance: with a pan near 1e11 doubles keep ~1e-5 absolute.
          const tolerance = Math.max(1e-9, Math.abs(viewport.panX) * 1e-14 * 8);
          expect(Math.abs(back.x - screen.x)).toBeLessThanOrEqual(tolerance);
          expect(Math.abs(back.y - screen.y)).toBeLessThanOrEqual(tolerance);
        }
      }
    }
  });

  it("converts sizes and distances without the pan", () => {
    const viewport = viewportOf({ panX: 999, panY: -999, zoom: 4 });
    expect(worldSizeToScreen({ width: 10, height: 5 }, viewport)).toEqual({
      width: 40,
      height: 20,
    });
    expect(screenDeltaToWorld({ x: 40, y: -20 }, viewport)).toEqual({
      x: 10,
      y: -5,
    });
  });

  it("converts rectangles", () => {
    const viewport = viewportOf({ panX: 10, panY: 20, zoom: 0.5 });
    expect(
      worldRectToScreen({ x: 100, y: 200, width: 40, height: 20 }, viewport),
    ).toEqual({
      x: 60,
      y: 120,
      width: 20,
      height: 10,
    });
  });

  it("builds the CSS transform of the world layer", () => {
    expect(
      worldLayerTransform(viewportOf({ panX: 12.5, panY: -3, zoom: 2 })),
    ).toBe("translate(12.5px, -3px) scale(2)");
  });

  it("derives the visible world rectangle and its center", () => {
    const viewport = viewportOf({ panX: 100, panY: 50, zoom: 2 });
    const size = { width: 800, height: 600 };
    expect(visibleWorldRect(size, viewport)).toEqual({
      x: -50,
      y: -25,
      width: 400,
      height: 300,
    });
    expect(viewportCenterWorld(size, viewport)).toEqual({ x: 150, y: 125 });
  });
});

describe("panBy", () => {
  it("moves the pan by the screen delta and keeps the zoom", () => {
    const next = panBy(viewportOf({ panX: 1, panY: 2, zoom: 3 }), {
      x: 10,
      y: -20,
    });
    expect(next).toEqual({ panX: 11, panY: -18, zoom: 3 });
  });

  it("clamps at the pan limit", () => {
    const next = panBy(viewportOf({ panX: panLimit, panY: 0, zoom: 1 }), {
      x: 5,
      y: 0,
    });
    expect(next.panX).toBe(panLimit);
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the anchor fixed", () => {
    const viewport = viewportOf({ panX: 37.5, panY: -12, zoom: 1.5 });
    const anchor = { x: 321.5, y: 144.25 };
    const worldBefore = screenToWorld(anchor, viewport);
    for (const zoom of [0.3, 1, 2.75, 6]) {
      const next = zoomAt(viewport, anchor, zoom);
      expect(next.zoom).toBe(zoom);
      const worldAfter = screenToWorld(anchor, next);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    }
  });

  it("clamps at both limits and still keeps the anchor fixed", () => {
    const viewport = viewportOf({ panX: 10, panY: 10, zoom: 1 });
    const anchor = { x: 200, y: 100 };
    const worldBefore = screenToWorld(anchor, viewport);
    const zoomedIn = zoomAt(viewport, anchor, 1000);
    const zoomedOut = zoomAt(viewport, anchor, 0.0001);
    expect(zoomedIn.zoom).toBe(zoomMax);
    expect(zoomedOut.zoom).toBe(zoomMin);
    for (const next of [zoomedIn, zoomedOut]) {
      const worldAfter = screenToWorld(anchor, next);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    }
  });

  it("ignores a non-finite zoom", () => {
    const viewport = viewportOf({ panX: 0, panY: 0, zoom: 2 });
    expect(zoomAt(viewport, { x: 5, y: 5 }, Number.NaN).zoom).toBe(2);
  });
});

describe("zoomByWheel", () => {
  const viewport = viewportOf({ panX: 0, panY: 0, zoom: 1 });
  const anchor = { x: 100, y: 100 };

  it("zooms in for a negative delta and out for a positive one", () => {
    expect(zoomByWheel(viewport, anchor, -100).zoom).toBeGreaterThan(1);
    expect(zoomByWheel(viewport, anchor, 100).zoom).toBeLessThan(1);
  });

  it("uses the configured step and cancels out", () => {
    const zoomedIn = zoomByWheel(viewport, anchor, -100);
    expect(zoomedIn.zoom).toBeCloseTo(
      Math.exp(100 * CANVAS_CONFIG.zoom.wheelStep),
      12,
    );
    expect(zoomByWheel(zoomedIn, anchor, 100).zoom).toBeCloseTo(1, 12);
  });

  it("stays within the limits for extreme deltas", () => {
    expect(zoomByWheel(viewport, anchor, -1e9).zoom).toBe(zoomMax);
    expect(zoomByWheel(viewport, anchor, 1e9).zoom).toBe(zoomMin);
  });
});

describe("clampViewport", () => {
  it("clamps every field into the limits and the result passes the parser", () => {
    const clamped = clampViewport({ panX: 5e11, panY: -5e11, zoom: 100 });
    expect(clamped).toEqual({ panX: panLimit, panY: -panLimit, zoom: zoomMax });
    expect(parseViewport(clamped).ok).toBe(true);
    expect(clampViewport({ panX: 0, panY: 0, zoom: 0 }).zoom).toBe(zoomMin);
  });

  it("replaces non-finite values", () => {
    const clamped = clampViewport({
      panX: Number.NaN,
      panY: Number.POSITIVE_INFINITY,
      zoom: Number.NaN,
    });
    expect(parseViewport(clamped).ok).toBe(true);
    expect(clamped).toEqual(DEFAULT_VIEWPORT);
  });

  it("leaves a valid viewport unchanged", () => {
    const valid = { panX: 12.5, panY: -7, zoom: 0.75 };
    expect(clampViewport(valid)).toEqual(valid);
  });

  it("has a valid configured default", () => {
    expect(DEFAULT_VIEWPORT).toEqual(CANVAS_CONFIG.viewport.default);
  });
});
