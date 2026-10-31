import { describe, expect, it } from "vitest";
import { TEXT_SIZE_ROOT_PX, TEXT_SIZES } from "../../config/text-size-config";
import { applyTextSize } from "./apply-text-size";

describe("applyTextSize", () => {
  it("sets the root font size of each size in pixels", () => {
    for (const size of TEXT_SIZES) {
      const target = { style: { fontSize: "" } };
      applyTextSize(target, size);
      expect(target.style.fontSize).toBe(`${TEXT_SIZE_ROOT_PX[size]}px`);
    }
  });

  it("orders the sizes from smallest to largest", () => {
    const pixels = TEXT_SIZES.map((size) => TEXT_SIZE_ROOT_PX[size]);
    expect(pixels).toEqual([...pixels].sort((a, b) => a - b));
    expect(new Set(pixels).size).toBe(pixels.length);
  });
});
