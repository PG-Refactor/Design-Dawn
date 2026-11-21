import { describe, expect, it } from "vitest";
import {
  fittedPicturePercent,
  largestFittingPercent,
} from "./fit-content-scale";

describe("largestFittingPercent", () => {
  it("finds the largest size that fits, within a percent", () => {
    // Content that fits up to 137%.
    const found = largestFittingPercent((percent) => percent <= 137.4);
    expect(found).toBeGreaterThanOrEqual(136);
    expect(found).toBeLessThanOrEqual(137);
  });

  it("is the largest size when all fits and the smallest when nothing does", () => {
    expect(largestFittingPercent(() => true)).toBe(400);
    expect(largestFittingPercent(() => false)).toBe(25);
  });
});

describe("fittedPicturePercent", () => {
  it("is the smaller of the two ratios, and nothing without a size", () => {
    expect(
      fittedPicturePercent(
        { width: 200, height: 100 },
        { width: 400, height: 100 },
      ),
    ).toBe(100);
    expect(
      fittedPicturePercent(
        { width: 200, height: 100 },
        { width: 400, height: 300 },
      ),
    ).toBe(200);
    expect(
      fittedPicturePercent({ width: 0, height: 0 }, { width: 1, height: 1 }),
    ).toBeNull();
  });
});
