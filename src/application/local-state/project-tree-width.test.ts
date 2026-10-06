import { describe, expect, it } from "vitest";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import {
  clampProjectTreeWidth,
  parseProjectTreeWidth,
} from "./project-tree-width";

const { minWidthPx, maxWidthPx, defaultWidthPx } = LAYOUT_CONFIG.projectTree;

describe("parseProjectTreeWidth", () => {
  it("accepts integers within the limits, including both limits", () => {
    for (const width of [minWidthPx, defaultWidthPx, maxWidthPx]) {
      expect(parseProjectTreeWidth(width)).toEqual({ ok: true, value: width });
    }
  });

  it("rejects out-of-range, fractional and non-finite widths", () => {
    for (const width of [
      minWidthPx - 1,
      maxWidthPx + 1,
      0,
      -1,
      200.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const result = parseProjectTreeWidth(width);
      expect(!result.ok && result.error.kind).toBe("invalidProjectTreeWidth");
    }
  });
});

describe("clampProjectTreeWidth", () => {
  it("rounds and clamps to the limits", () => {
    expect(clampProjectTreeWidth(300.4)).toBe(300);
    expect(clampProjectTreeWidth(0)).toBe(minWidthPx);
    expect(clampProjectTreeWidth(10_000)).toBe(maxWidthPx);
  });

  it("honours a smaller upper limit but never goes below the minimum", () => {
    expect(clampProjectTreeWidth(500, 400)).toBe(400);
    expect(clampProjectTreeWidth(500, 10)).toBe(minWidthPx);
  });
});
