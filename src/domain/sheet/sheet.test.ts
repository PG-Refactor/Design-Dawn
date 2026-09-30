import { describe, expect, it } from "vitest";
import { type Block, parseBlock } from "../block/block";
import { parseDisplayName } from "../shared/display-name";
import { parseBlockId } from "../shared/entity-id";
import { parsePosition, parseSize } from "../shared/geometry";
import { unwrap } from "../shared/test-support";
import {
  addBlock,
  bringBlockForward,
  bringBlockToFront,
  parseSheet,
  removeBlock,
  renameSheet,
  type Sheet,
  sendBlockBackward,
  sendBlockToBack,
  setBlockPosition,
  setBlockSize,
} from "./sheet";

const SHEET_ID = "01928f3a-7d8e-7f90-b123-456789abcdef";
const BLOCK_ID_PREFIX = "01928f3a-8e9f-7a01-8234-56789abcdef";
const FIRST_BLOCK_ID = `${BLOCK_ID_PREFIX}0`;
const SECOND_BLOCK_ID = `${BLOCK_ID_PREFIX}1`;
const THIRD_BLOCK_ID = `${BLOCK_ID_PREFIX}2`;
const UNKNOWN_BLOCK_ID = `${BLOCK_ID_PREFIX}9`;

function makeBlock(blockId: string): Block {
  return unwrap(
    parseBlock({
      blockId,
      blockType: "markdown",
      position: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
      contentPath: `sheets/s/blocks/${blockId}.md`,
    }),
  );
}

function makeSheet(blockIds: readonly string[]): Sheet {
  return unwrap(
    parseSheet({
      schemaVersion: 1,
      sheetId: SHEET_ID,
      name: "Sheet",
      blocks: blockIds.map((blockId) => ({
        blockId,
        blockType: "markdown",
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
        contentPath: `sheets/s/blocks/${blockId}.md`,
      })),
    }),
  );
}

function ids(sheet: Sheet): string[] {
  return sheet.blocks.map((block) => block.blockId);
}

const blockId = (value: string) => unwrap(parseBlockId(value));

describe("sheet operations", () => {
  const sheet = makeSheet([FIRST_BLOCK_ID, SECOND_BLOCK_ID, THIRD_BLOCK_ID]);

  it("renames without touching blocks", () => {
    const renamed = unwrap(
      renameSheet(sheet, unwrap(parseDisplayName("Renamed"))),
    );
    expect(renamed.name).toBe("Renamed");
    expect(renamed.blocks).toEqual(sheet.blocks);
  });

  it("appends added blocks as frontmost", () => {
    const added = unwrap(
      addBlock(makeSheet([FIRST_BLOCK_ID]), makeBlock(SECOND_BLOCK_ID)),
    );
    expect(ids(added)).toEqual([FIRST_BLOCK_ID, SECOND_BLOCK_ID]);
  });

  it("rejects adding a duplicate block id", () => {
    const result = addBlock(sheet, makeBlock(FIRST_BLOCK_ID));
    expect(!result.ok && result.error.kind).toBe("duplicateId");
  });

  it("removes a block and reports unknown ones", () => {
    expect(ids(unwrap(removeBlock(sheet, blockId(SECOND_BLOCK_ID))))).toEqual([
      FIRST_BLOCK_ID,
      THIRD_BLOCK_ID,
    ]);
    const result = removeBlock(sheet, blockId(UNKNOWN_BLOCK_ID));
    expect(!result.ok && result.error.kind).toBe("entityNotFound");
  });

  it("updates position and size of only the target block", () => {
    const position = unwrap(parsePosition({ x: 5, y: -5 }));
    const size = unwrap(parseSize({ width: 7, height: 8 }));
    const moved = unwrap(
      setBlockPosition(sheet, blockId(SECOND_BLOCK_ID), position),
    );
    const resized = unwrap(setBlockSize(moved, blockId(SECOND_BLOCK_ID), size));
    expect(resized.blocks[1]?.position).toEqual(position);
    expect(resized.blocks[1]?.size).toEqual(size);
    expect(resized.blocks[0]).toEqual(sheet.blocks[0]);
    expect(resized.blocks[2]).toEqual(sheet.blocks[2]);
  });

  it("reports unknown blocks for updates", () => {
    const position = unwrap(parsePosition({ x: 1, y: 1 }));
    const size = unwrap(parseSize({ width: 1, height: 1 }));
    const unknown = blockId(UNKNOWN_BLOCK_ID);
    for (const result of [
      setBlockPosition(sheet, unknown, position),
      setBlockSize(sheet, unknown, size),
      bringBlockForward(sheet, unknown),
      sendBlockBackward(sheet, unknown),
      bringBlockToFront(sheet, unknown),
      sendBlockToBack(sheet, unknown),
    ]) {
      expect(!result.ok && result.error.kind).toBe("entityNotFound");
    }
  });

  it("changes z-order", () => {
    const first = blockId(FIRST_BLOCK_ID);
    const third = blockId(THIRD_BLOCK_ID);
    expect(ids(unwrap(bringBlockForward(sheet, first)))).toEqual([
      SECOND_BLOCK_ID,
      FIRST_BLOCK_ID,
      THIRD_BLOCK_ID,
    ]);
    expect(ids(unwrap(sendBlockBackward(sheet, third)))).toEqual([
      FIRST_BLOCK_ID,
      THIRD_BLOCK_ID,
      SECOND_BLOCK_ID,
    ]);
    expect(ids(unwrap(bringBlockToFront(sheet, first)))).toEqual([
      SECOND_BLOCK_ID,
      THIRD_BLOCK_ID,
      FIRST_BLOCK_ID,
    ]);
    expect(ids(unwrap(sendBlockToBack(sheet, third)))).toEqual([
      THIRD_BLOCK_ID,
      FIRST_BLOCK_ID,
      SECOND_BLOCK_ID,
    ]);
  });

  it("returns an equal sheet when already at the limit", () => {
    const first = blockId(FIRST_BLOCK_ID);
    const third = blockId(THIRD_BLOCK_ID);
    expect(unwrap(bringBlockForward(sheet, third))).toEqual(sheet);
    expect(unwrap(bringBlockToFront(sheet, third))).toEqual(sheet);
    expect(unwrap(sendBlockBackward(sheet, first))).toEqual(sheet);
    expect(unwrap(sendBlockToBack(sheet, first))).toEqual(sheet);
  });

  it("does not mutate the input sheet", () => {
    const before = structuredClone(sheet);
    bringBlockToFront(sheet, blockId(FIRST_BLOCK_ID));
    removeBlock(sheet, blockId(FIRST_BLOCK_ID));
    expect(sheet).toEqual(before);
  });
});
