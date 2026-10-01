import { describe, expect, it } from "vitest";
import {
  commitPosition,
  commitSize,
} from "../../../application/commit-geometry";
import { CANVAS_CONFIG } from "../../../config/canvas-config";
import {
  dragPreviewPosition,
  exceedsDragThreshold,
  pointDifference,
  resizePreviewFrame,
} from "./interaction-math";

describe("drag", () => {
  it("previews with fractional values", () => {
    expect(
      dragPreviewPosition({ x: 100, y: 50 }, { x: 3.72, y: -0.4 }),
    ).toEqual({
      x: 103.72,
      y: 49.6,
    });
  });

  it("commits rounded integers (103.72 -> 104)", () => {
    const preview = dragPreviewPosition(
      { x: 100, y: 50 },
      { x: 3.72, y: -0.4 },
    );
    const committed = commitPosition(preview);
    expect(committed.ok && committed.value).toEqual({ x: 104, y: 50 });
  });
});

describe("resize", () => {
  const frame = { x: 10, y: 20, width: 100, height: 60 };
  const { minSize } = CANVAS_CONFIG.block;

  it("grows and shrinks from the bottom-right corner", () => {
    expect(resizePreviewFrame(frame, { x: 25.5, y: -10 })).toEqual({
      x: 10,
      y: 20,
      width: 125.5,
      height: 50,
    });
  });

  it("never goes below the configured minimum, never zero or negative", () => {
    const shrunk = resizePreviewFrame(frame, { x: -1000, y: -1000 });
    expect(shrunk.width).toBe(minSize.width);
    expect(shrunk.height).toBe(minSize.height);
    expect(minSize.width).toBeGreaterThanOrEqual(1);
    expect(minSize.height).toBeGreaterThanOrEqual(1);
    const custom = resizePreviewFrame(
      frame,
      { x: -1000, y: -1000 },
      { width: 1, height: 1 },
    );
    expect(custom.width).toBe(1);
  });

  it("commits integers and rejects an out-of-range size", () => {
    const committed = commitSize(resizePreviewFrame(frame, { x: 0.6, y: 0.4 }));
    expect(committed.ok && committed.value).toEqual({ width: 101, height: 60 });
    const huge = commitSize(resizePreviewFrame(frame, { x: 3e9, y: 0 }));
    expect(huge.ok).toBe(false);
  });
});

describe("drag threshold", () => {
  it("is exceeded only strictly beyond the threshold", () => {
    const start = { x: 10, y: 10 };
    expect(exceedsDragThreshold(start, { x: 14, y: 10 }, 4)).toBe(false);
    expect(exceedsDragThreshold(start, { x: 14.1, y: 10 }, 4)).toBe(true);
    expect(exceedsDragThreshold(start, { x: 13, y: 13 }, 4)).toBe(true);
  });

  it("uses the configured threshold by default", () => {
    const limit = CANVAS_CONFIG.interaction.dragThresholdPx;
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: limit, y: 0 })).toBe(
      false,
    );
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: limit + 1, y: 0 })).toBe(
      true,
    );
  });

  it("computes point differences", () => {
    expect(pointDifference({ x: 5, y: 1 }, { x: 2, y: 4 })).toEqual({
      x: 3,
      y: -3,
    });
  });
});
