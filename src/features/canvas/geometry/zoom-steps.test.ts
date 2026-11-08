import { describe, expect, it } from "vitest";
import { CANVAS_CONFIG } from "../../../config/canvas-config";
import { nextZoomStep, parseZoomPercent, zoomPercentText } from "./zoom-steps";

const { zoomMin, zoomMax } = CANVAS_CONFIG.viewport;

describe("zoom steps", () => {
  it("go to the next stop above or below, from a stop or from between two", () => {
    expect(nextZoomStep(1, "in")).toBe(1.1);
    expect(nextZoomStep(1, "out")).toBe(0.9);
    expect(nextZoomStep(1.3, "in")).toBe(1.5);
    expect(nextZoomStep(1.3, "out")).toBe(1.25);
    expect(nextZoomStep(1 + 1e-9, "in")).toBe(1.1);
  });

  it("stop at the viewport limits", () => {
    expect(nextZoomStep(zoomMax, "in")).toBeNull();
    expect(nextZoomStep(zoomMin, "out")).toBeNull();
    expect(CANVAS_CONFIG.zoom.steps[0]).toBe(zoomMin);
    expect(CANVAS_CONFIG.zoom.steps.at(-1)).toBe(zoomMax);
  });

  it("show whole percent", () => {
    expect(zoomPercentText(1)).toBe("100");
    expect(zoomPercentText(0.333)).toBe("33");
    expect(zoomPercentText(1.256)).toBe("126");
  });

  it("read a typed percentage, with or without %, kept inside the limits", () => {
    expect(parseZoomPercent("150")).toBe(1.5);
    expect(parseZoomPercent(" 75 % ")).toBe(0.75);
    expect(parseZoomPercent("12.5%")).toBe(0.125);
    expect(parseZoomPercent("5")).toBe(zoomMin);
    expect(parseZoomPercent("2000")).toBe(zoomMax);
  });

  it("refuse what is not a positive number", () => {
    for (const text of ["", "abc", "0", "-50", "1e3", "50%%"]) {
      expect(parseZoomPercent(text)).toBeNull();
    }
  });
});
