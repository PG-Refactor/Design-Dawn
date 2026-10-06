import { describe, expect, it } from "vitest";
import type { Block } from "../../../domain/block/block";
import { parseSize } from "../../../domain/shared/geometry";
import { makeBlockAt } from "../../../domain/shared/test-fixtures";
import { unwrap } from "../../../domain/shared/test-support";
import { type AlignMode, alignedMoves } from "./align";

function sized(
  counter: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Block {
  return {
    ...makeBlockAt(counter, x, y),
    size: unwrap(parseSize({ width, height })),
  };
}

// Box of the three blocks: x -40..360 (centre 160), y 20..210 (centre 115).
const FIRST = sized(1, 10, 20, 100, 50);
const SECOND = sized(2, 300, 40, 60, 31);
const THIRD = sized(3, -40, 200, 101, 10);
const THREE = [FIRST, SECOND, THIRD];

function moved(blocks: readonly Block[], mode: AlignMode) {
  const result = alignedMoves(blocks, mode);
  if (!result.ok) throw new Error("align failed");
  return result.value.map((move) => [
    move.blockId,
    move.position.x,
    move.position.y,
  ]);
}

describe("alignedMoves with three blocks", () => {
  it("aligns left to the box's left edge, leaving y alone", () => {
    expect(moved(THREE, "alignLeft")).toEqual([
      [FIRST.blockId, -40, 20],
      [SECOND.blockId, -40, 40],
    ]);
  });

  it("aligns right edges to the box's right edge", () => {
    expect(moved(THREE, "alignRight")).toEqual([
      [FIRST.blockId, 260, 20],
      [THIRD.blockId, 259, 200],
    ]);
  });

  it("aligns horizontal centres; a half-integer rounds toward +infinity", () => {
    // THIRD: -40 + (400 - 101) / 2 = 109.5 -> 110.
    expect(moved(THREE, "alignHorizontalCenter")).toEqual([
      [FIRST.blockId, 110, 20],
      [SECOND.blockId, 130, 40],
      [THIRD.blockId, 110, 200],
    ]);
  });

  it("aligns top, leaving x alone", () => {
    expect(moved(THREE, "alignTop")).toEqual([
      [SECOND.blockId, 300, 20],
      [THIRD.blockId, -40, 20],
    ]);
  });

  it("aligns bottom edges to the box's bottom edge", () => {
    expect(moved(THREE, "alignBottom")).toEqual([
      [FIRST.blockId, 10, 160],
      [SECOND.blockId, 300, 179],
    ]);
  });

  it("aligns vertical centres; a half-integer rounds toward +infinity", () => {
    // SECOND: 20 + (190 - 31) / 2 = 99.5 -> 100.
    expect(moved(THREE, "alignVerticalCenter")).toEqual([
      [FIRST.blockId, 10, 90],
      [SECOND.blockId, 300, 100],
      [THIRD.blockId, -40, 110],
    ]);
  });
});

describe("alignedMoves with two blocks", () => {
  it("aligns the second to the box of both", () => {
    expect(moved([FIRST, SECOND], "alignLeft")).toEqual([
      [SECOND.blockId, 10, 40],
    ]);
    expect(moved([FIRST, SECOND], "alignTop")).toEqual([
      [SECOND.blockId, 300, 20],
    ]);
  });
});

describe("alignedMoves details", () => {
  it("does not snap to the grid", () => {
    const left = sized(1, 137, 5, 40, 40);
    const right = sized(2, 500, 9, 40, 40);
    expect(moved([left, right], "alignLeft")).toEqual([
      [right.blockId, 137, 9],
    ]);
  });

  it("rounds negative half-integers toward +infinity too", () => {
    const wide = sized(1, -100, 0, 100, 10);
    const narrow = sized(2, -49, 0, 1, 10);
    // -100 + (100 - 1) / 2 = -50.5 -> -50.
    expect(moved([wide, narrow], "alignHorizontalCenter")).toEqual([
      [narrow.blockId, -50, 0],
    ]);
  });

  it("returns only block id and position, so sizes cannot change", () => {
    const result = alignedMoves(THREE, "alignLeft");
    if (!result.ok) throw new Error("align failed");
    for (const move of result.value) {
      expect(Object.keys(move).sort()).toEqual(["blockId", "position"]);
    }
  });

  it("has nothing to do for fewer than two blocks or already aligned blocks", () => {
    expect(moved([], "alignLeft")).toEqual([]);
    expect(moved([FIRST], "alignLeft")).toEqual([]);
    const aligned = [sized(1, 10, 0, 5, 5), sized(2, 10, 50, 9, 9)];
    expect(moved(aligned, "alignLeft")).toEqual([]);
  });
});
