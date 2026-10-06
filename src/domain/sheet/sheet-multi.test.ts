import { describe, expect, it } from "vitest";
import type { Block } from "../block/block";
import type { BlockId } from "../shared/entity-id";
import { parsePosition, parseSize } from "../shared/geometry";
import {
  blockIdOf,
  makeBlockAt,
  makeSheetWith,
  SHEET_ID,
} from "../shared/test-fixtures";
import { unwrap } from "../shared/test-support";
import {
  addBlocks,
  bringBlockForward,
  bringBlocksForward,
  bringBlocksToFront,
  insertBlocksAt,
  removeBlocks,
  reorderBlocks,
  type Sheet,
  sendBlocksBackward,
  sendBlocksToBack,
  setBlockFrames,
} from "./sheet";

const ids = (sheet: Sheet): BlockId[] => sheet.blocks.map((b) => b.blockId);
const sheetOf = (...counters: number[]): Sheet =>
  makeSheetWith(
    SHEET_ID,
    counters.map((counter) => makeBlockAt(counter)),
  );
const idsOf = (...counters: number[]): BlockId[] => counters.map(blockIdOf);

function failureKind<T>(
  result: { ok: true; value: T } | { ok: false; error: { kind: string } },
): string | null {
  return result.ok ? null : result.error.kind;
}

describe("addBlocks", () => {
  it("appends in the given order", () => {
    const next = unwrap(
      addBlocks(sheetOf(1), [makeBlockAt(2), makeBlockAt(3)]),
    );
    expect(ids(next)).toEqual(idsOf(1, 2, 3));
  });

  it("rejects duplicates against the sheet and inside the list, changing nothing", () => {
    const sheet = sheetOf(1);
    expect(failureKind(addBlocks(sheet, [makeBlockAt(1)]))).toBe("duplicateId");
    expect(
      failureKind(addBlocks(sheet, [makeBlockAt(2), makeBlockAt(2)])),
    ).toBe("duplicateId");
    expect(ids(sheet)).toEqual(idsOf(1));
  });

  it("returns the same sheet for an empty list", () => {
    const sheet = sheetOf(1);
    expect(unwrap(addBlocks(sheet, []))).toBe(sheet);
  });
});

describe("insertBlocksAt", () => {
  it("re-inserts at final indexes", () => {
    const sheet = sheetOf(2, 4);
    const next = unwrap(
      insertBlocksAt(sheet, [
        { block: makeBlockAt(1), index: 0 },
        { block: makeBlockAt(3), index: 2 },
        { block: makeBlockAt(5), index: 4 },
      ]),
    );
    expect(ids(next)).toEqual(idsOf(1, 2, 3, 4, 5));
  });

  it("rejects an index outside the resulting array and a repeated index", () => {
    const sheet = sheetOf(1);
    expect(
      failureKind(insertBlocksAt(sheet, [{ block: makeBlockAt(2), index: 2 }])),
    ).toBe("invalidBlockIndex");
    expect(
      failureKind(
        insertBlocksAt(sheet, [{ block: makeBlockAt(2), index: -1 }]),
      ),
    ).toBe("invalidBlockIndex");
    expect(
      failureKind(
        insertBlocksAt(sheet, [
          { block: makeBlockAt(2), index: 1 },
          { block: makeBlockAt(3), index: 1 },
        ]),
      ),
    ).toBe("invalidBlockIndex");
    expect(ids(sheet)).toEqual(idsOf(1));
  });

  it("rejects ids that are already present", () => {
    expect(
      failureKind(
        insertBlocksAt(sheetOf(1), [{ block: makeBlockAt(1), index: 0 }]),
      ),
    ).toBe("duplicateId");
  });
});

describe("removeBlocks", () => {
  it("removes several blocks and keeps the order of the rest", () => {
    expect(ids(unwrap(removeBlocks(sheetOf(1, 2, 3, 4), idsOf(4, 2))))).toEqual(
      idsOf(1, 3),
    );
  });

  it("is all-or-nothing", () => {
    const sheet = sheetOf(1, 2);
    expect(failureKind(removeBlocks(sheet, idsOf(1, 9)))).toBe(
      "entityNotFound",
    );
    expect(failureKind(removeBlocks(sheet, idsOf(1, 1)))).toBe("duplicateId");
    expect(ids(sheet)).toEqual(idsOf(1, 2));
  });
});

describe("setBlockFrames", () => {
  const frame = (counter: number, x: number, width: number) => ({
    blockId: blockIdOf(counter),
    position: unwrap(parsePosition({ x, y: 5 })),
    size: unwrap(parseSize({ width, height: 7 })),
  });

  it("updates several blocks at once and leaves the others alone", () => {
    const sheet = sheetOf(1, 2, 3);
    const next = unwrap(
      setBlockFrames(sheet, [frame(1, 10, 20), frame(3, 30, 40)]),
    );
    expect(next.blocks[0]?.position).toEqual({ x: 10, y: 5 });
    expect(next.blocks[0]?.size).toEqual({ width: 20, height: 7 });
    expect(next.blocks[1]).toBe(sheet.blocks[1]);
    expect(next.blocks[2]?.position).toEqual({ x: 30, y: 5 });
  });

  it("is all-or-nothing", () => {
    const sheet = sheetOf(1);
    expect(
      failureKind(setBlockFrames(sheet, [frame(1, 1, 1), frame(9, 1, 1)])),
    ).toBe("entityNotFound");
    expect(
      failureKind(setBlockFrames(sheet, [frame(1, 1, 1), frame(1, 2, 2)])),
    ).toBe("duplicateId");
    expect(sheet.blocks[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it("returns the same sheet when no frame changes", () => {
    const sheet = sheetOf(1);
    const block = sheet.blocks[0] as Block;
    const same = {
      blockId: block.blockId,
      position: block.position,
      size: block.size,
    };
    expect(unwrap(setBlockFrames(sheet, [same]))).toBe(sheet);
    expect(unwrap(setBlockFrames(sheet, []))).toBe(sheet);
  });
});

describe("multi-block z-order", () => {
  const front = (sheet: Sheet, ...counters: number[]) =>
    ids(unwrap(bringBlocksToFront(sheet, idsOf(...counters))));
  const back = (sheet: Sheet, ...counters: number[]) =>
    ids(unwrap(sendBlocksToBack(sheet, idsOf(...counters))));
  const forward = (sheet: Sheet, ...counters: number[]) =>
    ids(unwrap(bringBlocksForward(sheet, idsOf(...counters))));
  const backward = (sheet: Sheet, ...counters: number[]) =>
    ids(unwrap(sendBlocksBackward(sheet, idsOf(...counters))));

  it("to front: single, non-contiguous targets keep their relative order", () => {
    const sheet = sheetOf(1, 2, 3, 4, 5);
    expect(front(sheet, 2)).toEqual(idsOf(1, 3, 4, 5, 2));
    expect(front(sheet, 4, 2)).toEqual(idsOf(1, 3, 5, 2, 4));
  });

  it("to back: single and non-contiguous targets", () => {
    const sheet = sheetOf(1, 2, 3, 4, 5);
    expect(back(sheet, 4)).toEqual(idsOf(4, 1, 2, 3, 5));
    expect(back(sheet, 5, 2)).toEqual(idsOf(2, 5, 1, 3, 4));
  });

  it("forward: each target swaps with the non-target in front of it", () => {
    const sheet = sheetOf(1, 2, 3, 4, 5);
    expect(forward(sheet, 2)).toEqual(idsOf(1, 3, 2, 4, 5));
    expect(forward(sheet, 1, 3)).toEqual(idsOf(2, 1, 4, 3, 5));
    expect(forward(sheet, 2, 3)).toEqual(idsOf(1, 4, 2, 3, 5));
  });

  it("forward: a contiguous group at the front does not move", () => {
    const sheet = sheetOf(1, 2, 3, 4);
    expect(unwrap(bringBlocksForward(sheet, idsOf(3, 4)))).toBe(sheet);
    expect(forward(sheet, 2, 4)).toEqual(idsOf(1, 3, 2, 4));
  });

  it("backward mirrors forward", () => {
    const sheet = sheetOf(1, 2, 3, 4, 5);
    expect(backward(sheet, 4)).toEqual(idsOf(1, 2, 4, 3, 5));
    expect(backward(sheet, 3, 5)).toEqual(idsOf(1, 3, 2, 5, 4));
    expect(backward(sheet, 3, 4)).toEqual(idsOf(1, 3, 4, 2, 5));
    expect(unwrap(sendBlocksBackward(sheet, idsOf(1, 2)))).toBe(sheet);
  });

  it("returns the same sheet when nothing moves", () => {
    const sheet = sheetOf(1, 2, 3);
    expect(unwrap(bringBlocksToFront(sheet, idsOf(3)))).toBe(sheet);
    expect(unwrap(sendBlocksToBack(sheet, idsOf(1, 2)))).toBe(sheet);
    expect(unwrap(bringBlocksToFront(sheet, []))).toBe(sheet);
  });

  it("is all-or-nothing and does not mutate its input", () => {
    const sheet = sheetOf(1, 2, 3);
    for (const operation of [
      bringBlocksToFront,
      sendBlocksToBack,
      bringBlocksForward,
      sendBlocksBackward,
    ]) {
      expect(failureKind(operation(sheet, idsOf(1, 9)))).toBe("entityNotFound");
      expect(failureKind(operation(sheet, idsOf(1, 1)))).toBe("duplicateId");
    }
    expect(ids(sheet)).toEqual(idsOf(1, 2, 3));
  });

  it("keeps the single-block functions working", () => {
    expect(
      ids(unwrap(bringBlockForward(sheetOf(1, 2, 3), blockIdOf(1)))),
    ).toEqual(idsOf(2, 1, 3));
    const sheet = sheetOf(1, 2);
    expect(unwrap(bringBlockForward(sheet, blockIdOf(2)))).toBe(sheet);
  });
});

describe("reorderBlocks", () => {
  it("sets the exact order", () => {
    expect(
      ids(unwrap(reorderBlocks(sheetOf(1, 2, 3), idsOf(3, 1, 2)))),
    ).toEqual(idsOf(3, 1, 2));
  });

  it("requires a permutation of the current ids", () => {
    const sheet = sheetOf(1, 2, 3);
    expect(failureKind(reorderBlocks(sheet, idsOf(1, 2)))).toBe(
      "entityNotFound",
    );
    expect(failureKind(reorderBlocks(sheet, idsOf(1, 2, 9)))).toBe(
      "entityNotFound",
    );
    expect(failureKind(reorderBlocks(sheet, idsOf(1, 2, 2)))).toBe(
      "duplicateId",
    );
    expect(failureKind(reorderBlocks(sheet, idsOf(1, 2, 3, 4)))).toBe(
      "entityNotFound",
    );
  });

  it("returns the same sheet for the current order", () => {
    const sheet = sheetOf(1, 2);
    expect(unwrap(reorderBlocks(sheet, idsOf(1, 2)))).toBe(sheet);
  });
});
