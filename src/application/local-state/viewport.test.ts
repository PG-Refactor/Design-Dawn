import { describe, expect, it } from "vitest";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import { parseViewport } from "./viewport";

const VALID = { panX: 120.5, panY: -48.25, zoom: 1.25 };

describe("parseViewport", () => {
  it("accepts a valid viewport and keeps its values", () => {
    expect(parseViewport(VALID)).toEqual({ ok: true, value: VALID });
  });

  it("accepts the limits themselves", () => {
    const { panLimit, zoomMin, zoomMax } = CANVAS_CONFIG.viewport;
    for (const raw of [
      { panX: panLimit, panY: -panLimit, zoom: zoomMin },
      { panX: 0, panY: 0, zoom: zoomMax },
    ]) {
      expect(parseViewport(raw).ok).toBe(true);
    }
  });

  it("rejects non-finite numbers, which JSON fixtures cannot express", () => {
    for (const raw of [
      { ...VALID, panX: Number.NaN },
      { ...VALID, panY: Number.POSITIVE_INFINITY },
      { ...VALID, panX: Number.NEGATIVE_INFINITY },
      { ...VALID, zoom: Number.NaN },
      { ...VALID, zoom: Number.POSITIVE_INFINITY },
    ]) {
      const result = parseViewport(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalidViewport");
    }
  });
});
