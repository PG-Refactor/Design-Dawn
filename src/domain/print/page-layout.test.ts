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

  it("leaves out a page with only a thin strip of a figure larger than the page", () => {
    // 0-120 wide on 100-wide pages: the second column shows 20 of it, where only the
    // frame is (the picture is drawn in 10-90).
    const figure = {
      ...block(0, 0, 120, 50),
      figure: true,
      drawn: block(10, 0, 80, 50),
    };
    expect(
      paginate(block(0, 0, 120, 50), [figure], 100, 100, 0.25).map(
        (page) => page.x,
      ),
    ).toEqual([0]);
    // A wider strip keeps its page.
    expect(
      paginate(
        block(0, 0, 160, 50),
        [{ ...figure, width: 160 }],
        100,
        100,
        0.25,
      ).length,
    ).toBe(2);
    // Text is never left out, however thin the strip.
    expect(
      paginate(block(0, 0, 120, 50), [block(0, 0, 120, 50)], 100, 100, 0.25)
        .length,
    ).toBe(2);
  });

  it("prints the diagrams sheet at 100% on A4 without pages of frame edges, and all of the gantt", () => {
    // Sheet E of the Windows check: a note, then rows of two 960-wide diagrams. Most are
    // drawn about 400 wide in the middle; the gantt (second row, left) 800 wide.
    const rows = [220, 780, 1340, 1900];
    const centred = (x: number, y: number, width: number) =>
      block(x + (960 - width) / 2, y, width, 520);
    const gantt = centred(0, 780, 800);
    const blocks = [
      block(0, 0, 700, 160),
      ...rows.flatMap((y) => [
        {
          ...block(0, y, 960, 520),
          figure: true,
          drawn: y === 780 ? gantt : centred(0, y, 400),
        },
        {
          ...block(1000, y, 960, 520),
          figure: true,
          drawn: centred(1000, y, 400),
        },
      ]),
    ];
    const bounds = contentBounds(blocks, 24);
    if (bounds === null) throw new Error("bounds");
    // A4 portrait at 100%: 794 wide, 1123 - 32 high.
    const without = paginate(bounds, blocks, 794, 1091);
    const pages = paginate(bounds, blocks, 794, 1091, 0.25);
    expect(pages.length).toBeLessThan(without.length);
    // The gantt's right end is on a page.
    const ganttRight = gantt.x + gantt.width - 1;
    expect(
      pages.some(
        (page) =>
          ganttRight >= page.x &&
          ganttRight < page.x + page.width &&
          gantt.y >= page.y &&
          gantt.y < page.y + page.height,
      ),
    ).toBe(true);
  });
});
