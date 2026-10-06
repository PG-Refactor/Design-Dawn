import { describe, expect, it } from "vitest";
import type { Block } from "../../domain/block/block";
import { parseContentPath } from "../../domain/block/content-path";
import { unwrap } from "../../domain/shared/test-support";
import {
  blockIdOf,
  DOCUMENT_ID,
  makeBlockAt,
  position,
  SHEET_ID,
  size,
} from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";
import type { AssetBlockSpec, BlockSpec } from "./command";
import {
  createBlocksCommand,
  deleteBlocksCommand,
} from "./file-backed-commands";

const ASSET_PATH = "assets/photo.png";
const TEXT_BLOCKS: readonly Block[] = [makeBlockAt(1, 0, 0)];

function imageSpec(counter: number, contentPath = ASSET_PATH): AssetBlockSpec {
  return {
    blockId: blockIdOf(counter),
    blockType: "image",
    position: position(counter, counter),
    // Smaller than the UI minimum on purpose: the sequence takes the size as given.
    size: size(10, 8),
    contentPath: unwrap(parseContentPath(contentPath)),
  };
}

function textSpec(counter: number): BlockSpec {
  return {
    blockId: blockIdOf(counter),
    blockType: "markdown",
    position: position(counter, counter),
    size: size(100, 80),
    text: `text ${counter}`,
  };
}

function setup(blocks: readonly Block[] = TEXT_BLOCKS) {
  const harness = openSession(blocks);
  harness.gateway.seedAsset(DOCUMENT_ID, ASSET_PATH);
  harness.gateway.clearCalls();
  return harness;
}

const blocksOf = (session: {
  getState(): { sheets: ReadonlyMap<unknown, unknown> };
}) =>
  (session.getState().sheets.get(SHEET_ID) as { blocks: readonly Block[] })
    .blocks;

async function historyDepth(session: {
  getState(): { history: { canUndo: boolean } };
  undo(): Promise<unknown>;
  redo(): Promise<unknown>;
}): Promise<number> {
  let depth = 0;
  while (session.getState().history.canUndo) {
    await session.undo();
    depth += 1;
  }
  for (let step = 0; step < depth; step += 1) await session.redo();
  return depth;
}

describe("creating image blocks", () => {
  it("adds the block with the given path and size, as one history entry, without touching files", async () => {
    const { session, gateway } = setup();
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [imageSpec(10)]),
    );
    expect(result.ok).toBe(true);
    const added = blocksOf(session).find(
      (block) => block.blockId === blockIdOf(10),
    );
    expect(added).toMatchObject({
      blockType: "image",
      contentPath: ASSET_PATH,
      size: { width: 10, height: 8 },
    });
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(gateway.savedSheets.get(SHEET_ID)?.blocks).toHaveLength(2);
    expect(await historyDepth(session)).toBe(1);
  });

  it("gives image blocks no entry in contents or contentStatus", async () => {
    const { session } = setup();
    await session.execute(createBlocksCommand(SHEET_ID, [imageSpec(10)]));
    await session.loadSheetContents(SHEET_ID);
    const state = session.getState();
    expect(state.contents.has(blockIdOf(10))).toBe(false);
    expect(state.contentStatus.has(blockIdOf(10))).toBe(false);
  });

  it("creates mixed text and image blocks as one history entry", async () => {
    const { session, gateway } = setup();
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [textSpec(10), imageSpec(11)]),
    );
    expect(result.ok).toBe(true);
    expect(gateway.methods("createBlockContent")).toHaveLength(1);
    expect(blocksOf(session).map((block) => block.blockType)).toEqual([
      "markdown",
      "markdown",
      "image",
    ]);
    expect(await historyDepth(session)).toBe(1);
    gateway.clearCalls();
    await session.undo();
    expect(blocksOf(session)).toHaveLength(1);
    // The text file goes with its block; the asset stays.
    expect(gateway.methods("deleteBlockContent")).toHaveLength(1);
    expect(gateway.hasAsset(DOCUMENT_ID, ASSET_PATH)).toBe(true);
  });

  it("leaves the sheet and the asset alone when saving the sheet fails", async () => {
    const { session, gateway } = setup();
    const before = session.getState();
    gateway.failOn("saveSheet", "ioError");
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [imageSpec(10)]),
    );
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history.canUndo).toBe(false);
    expect(gateway.methods("deleteBlockContent")).toEqual([]);
    expect(gateway.hasAsset(DOCUMENT_ID, ASSET_PATH)).toBe(true);
  });

  it("rolls back only the text files of a mixed command when saving fails", async () => {
    const { session, gateway } = setup();
    gateway.failOn("saveSheet", "ioError");
    await session.execute(
      createBlocksCommand(SHEET_ID, [textSpec(10), imageSpec(11)]),
    );
    expect(gateway.methods("deleteBlockContent")).toHaveLength(1);
    expect(gateway.hasAsset(DOCUMENT_ID, ASSET_PATH)).toBe(true);
  });
});

describe("deleting and restoring image blocks", () => {
  async function withImage() {
    const harness = setup();
    await harness.session.execute(
      createBlocksCommand(SHEET_ID, [imageSpec(10)]),
    );
    harness.gateway.clearCalls();
    return harness;
  }

  it("removes the block and never deletes the asset", async () => {
    const { session, gateway } = await withImage();
    const result = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(10)]),
    );
    expect(result.ok).toBe(true);
    expect(blocksOf(session).map((block) => block.blockId)).toEqual([
      blockIdOf(1),
    ]);
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(gateway.hasAsset(DOCUMENT_ID, ASSET_PATH)).toBe(true);
    expect(session.getState().warnings).toEqual([]);
  });

  it("undo restores the same block and contentPath, redo removes it again", async () => {
    const { session, gateway } = await withImage();
    await session.execute(deleteBlocksCommand(SHEET_ID, [blockIdOf(10)]));
    gateway.clearCalls();
    await session.undo();
    expect(blocksOf(session).at(-1)).toMatchObject({
      blockId: blockIdOf(10),
      blockType: "image",
      contentPath: ASSET_PATH,
    });
    expect(gateway.methods()).toEqual(["saveSheet"]);
    await session.redo();
    expect(blocksOf(session).map((block) => block.blockId)).toEqual([
      blockIdOf(1),
    ]);
    expect(gateway.hasAsset(DOCUMENT_ID, ASSET_PATH)).toBe(true);
  });

  it("restores the block even when its asset is gone, without inventing a file", async () => {
    const { session, gateway } = await withImage();
    await session.execute(deleteBlocksCommand(SHEET_ID, [blockIdOf(10)]));
    gateway.assets.get(DOCUMENT_ID)?.delete(ASSET_PATH);
    const filesBefore = new Map(gateway.files);
    gateway.clearCalls();
    const undone = await session.undo();
    expect(undone.ok).toBe(true);
    expect(blocksOf(session).at(-1)?.blockId).toBe(blockIdOf(10));
    expect(
      gateway.methods("restoreBlockContent", "createBlockContent"),
    ).toEqual([]);
    expect(gateway.files).toEqual(filesBefore);
    expect(gateway.hasAsset(DOCUMENT_ID, ASSET_PATH)).toBe(false);
  });

  it("deletes mixed blocks in one entry: the text file goes, the asset stays", async () => {
    const { session, gateway } = setup();
    await session.execute(
      createBlocksCommand(SHEET_ID, [textSpec(10), imageSpec(11)]),
    );
    gateway.clearCalls();
    await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(10), blockIdOf(11)]),
    );
    expect(gateway.methods("deleteBlockContent")).toHaveLength(1);
    expect(gateway.hasAsset(DOCUMENT_ID, ASSET_PATH)).toBe(true);
    await session.undo();
    expect(blocksOf(session).map((block) => block.blockType)).toEqual([
      "markdown",
      "markdown",
      "image",
    ]);
    expect(gateway.methods("restoreBlockContent")).toHaveLength(1);
  });
});
