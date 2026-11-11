import { describe, expect, it } from "vitest";
import { paperDimensions, paperLayout } from "./paper";

const MARGIN = 24;
const HEADING = 32;

describe("paperLayout", () => {
  it("cuts the sheet into the part of each page below the heading", () => {
    const layout = paperLayout(
      [
        { x: 0, y: 0, width: 300, height: 600 },
        { x: 0, y: 700, width: 300, height: 600 },
      ],
      { size: "a4", orientation: "portrait", scale: "actual" },
      MARGIN,
      HEADING,
    );
    expect(layout?.scale).toBe(1);
    expect(layout?.paper).toEqual({ width: 794, height: 1123 });
    expect(layout?.area).toEqual({ width: 794, height: 1123 - HEADING });
    // The second block would be cut: the page ends at its top edge instead.
    expect(layout?.pages.map((page) => [page.y, page.height])).toEqual([
      [-MARGIN, 700 + MARGIN],
      [700, 600 + MARGIN],
    ]);
  });

  it("scales a wide sheet down to the paper's width, never up", () => {
    const wide = paperLayout(
      [{ x: 0, y: 0, width: 2000 - MARGIN * 2, height: 100 }],
      { size: "a4", orientation: "portrait", scale: "fitWidth" },
      MARGIN,
      HEADING,
    );
    expect(wide?.scale).toBeCloseTo(794 / 2000);
    expect(wide?.pages).toHaveLength(1);
    const small = paperLayout(
      [{ x: 0, y: 0, width: 100, height: 100 }],
      { size: "a4", orientation: "portrait", scale: "fitPage" },
      MARGIN,
      HEADING,
    );
    expect(small?.scale).toBe(1);
  });

  it("has nothing for an empty sheet", () => {
    expect(
      paperLayout(
        [],
        { size: "a3", orientation: "landscape", scale: "actual" },
        MARGIN,
        HEADING,
      ),
    ).toBeNull();
    expect(
      paperDimensions({
        size: "a3",
        orientation: "landscape",
        scale: "actual",
      }),
    ).toEqual({ width: 1587, height: 1123 });
  });
});
