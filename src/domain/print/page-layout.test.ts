import { describe, expect, it } from "vitest";
import { contentBounds, paginate } from "./page-layout";

const block = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

describe("contentBounds", () => {
  it("is the box around the blocks plus the margin", () => {
    expect(
      contentBounds([block(10, 20, 100, 50), block(200, 0, 10, 10)], 5),
    ).toEqual({ x: 5, y: -5, width: 210, height: 80 });
    expect(contentBounds([], 5)).toBeNull();
  });
});

describe("paginate", () => {
  it("is one page when everything fits", () => {
    const blocks = [block(0, 0, 100, 100)];
    expect(paginate(block(0, 0, 100, 100), blocks, 500, 500)).toEqual([
      block(0, 0, 100, 100),
    ]);
  });

  it("moves a cut back to the top of a block it would split", () => {
    const blocks = [block(0, 0, 100, 80), block(0, 90, 100, 60)];
    const pages = paginate(block(0, 0, 100, 150), blocks, 100, 100);
    expect(pages).toEqual([block(0, 0, 100, 90), block(0, 90, 100, 60)]);
  });

  it("moves a cut back again when the new place splits another block", () => {
    // A cut at 100 splits the block at 90; its top (90) splits the one at 60, so the cut
    // goes to 60, where nothing is split.
    const blocks = [
      block(0, 0, 100, 50),
      block(0, 60, 40, 50),
      block(50, 90, 50, 50),
    ];
    const pages = paginate(block(0, 0, 100, 140), blocks, 100, 100);
    expect(pages.map((page) => page.y)).toEqual([0, 60]);
  });

  it("splits a block taller than a page and leaves out empty pages", () => {
    const blocks = [block(0, 0, 50, 250), block(300, 0, 50, 50)];
    const pages = paginate(block(0, 0, 350, 250), blocks, 100, 100);
    // Columns 0-100 and 300-350 have blocks; 100-200 and 200-300 do not.
    expect(pages.map((page) => [page.x, page.y])).toEqual([
      [0, 0],
      [300, 0],
      [0, 100],
      [0, 200],
    ]);
  });
});
