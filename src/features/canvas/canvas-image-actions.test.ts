import { describe, expect, it } from "vitest";
import type { FakeDroppedFile } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
  SHEET_A2,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import { PASTE_OFFSET } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import type { BlockId } from "../../domain/shared/entity-id";
import { getSelection, selectBlocks } from "../workspace/ui-state/ui-state";
import {
  type CanvasHarness,
  createCanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

const VIEWPORT_SIZE = { width: 800, height: 600 };
const SHEET_INPUT = { documentId: DOCUMENT_A, sheetId: SHEET_A1 };
const PHOTO = "assets/photo.png";
const SEEDED_BLOCK_COUNT = 3;

const photoFile = (fileName = "photo.png"): FakeDroppedFile => ({
  fileName,
  naturalWidth: 2000,
  naturalHeight: 1000,
  // Below the UI minimum (48 x 32) on purpose: the drop must not apply it.
  initialWidth: 40,
  initialHeight: 20,
});

let dropCounter = 0;

async function drop(harness: CanvasHarness, files: readonly FakeDroppedFile[]) {
  dropCounter += 1;
  const dropId = `drop-${dropCounter}`;
  harness.gateway.scriptDrop(dropId, files);
  return harness.canvasActions.importDroppedImages({
    dropId,
    viewportSize: VIEWPORT_SIZE,
  });
}

const imageBlocks = (harness: CanvasHarness): readonly Block[] =>
  harness.blocksOfSheetA1().filter((block) => block.blockType === "image");

function select(harness: CanvasHarness, ...blockIds: BlockId[]): void {
  harness.uiStateStore.setState((state) =>
    selectBlocks(state, SHEET_A1, blockIds),
  );
}

const operationErrors = (harness: CanvasHarness) =>
  harness.uiStateStore.getState().operationErrors;

async function withDroppedImage(): Promise<{
  harness: CanvasHarness;
  block: Block;
}> {
  const harness = await openedCanvasHarness();
  await drop(harness, [photoFile()]);
  const [block] = imageBlocks(harness);
  if (block === undefined) throw new Error("an image block is expected");
  // The text blocks of the sheet are read once here, so later gateway calls are only the
  // ones the operation under test makes.
  await harness.canvasActions.loadSheetContents(SHEET_INPUT);
  harness.gateway.clearCalls();
  return { harness, block };
}

describe("importDroppedImages", () => {
  it("answers a drop without an open sheet with an error and imports nothing", async () => {
    const harness = createCanvasHarness();
    harness.gateway.scriptDrop("early", [photoFile()]);
    const result = await harness.canvasActions.importDroppedImages({
      dropId: "early",
      viewportSize: VIEWPORT_SIZE,
    });
    expect(result.ok).toBe(false);
    expect(harness.gateway.methods("importDroppedImages")).toEqual([]);
    expect(operationErrors(harness)).toMatchObject([
      { operation: "importImagesWithoutSheet", subject: null },
    ]);
  });

  it("creates one image block with the returned initial size, as one history entry, and selects it", async () => {
    const harness = await openedCanvasHarness();
    const result = await drop(harness, [photoFile()]);
    expect(result.ok).toBe(true);
    const [block] = imageBlocks(harness);
    expect(block).toMatchObject({
      blockType: "image",
      contentPath: PHOTO,
      size: { width: 40, height: 20 },
      // The visible world is (0,0)-(800,600): the block is centred in it.
      position: { x: 380, y: 290 },
    });
    expect(harness.blocksOfSheetA1()).toHaveLength(SEEDED_BLOCK_COUNT + 1);
    expect(harness.gateway.methods("createBlockContent")).toEqual([]);
    expect(await harness.undoDepth()).toBe(1);
    expect([
      ...getSelection(harness.uiStateStore.getState(), SHEET_A1),
    ]).toEqual([block?.blockId]);
  });

  it("fans several images out by the paste offset in one history entry", async () => {
    const harness = await openedCanvasHarness();
    await drop(harness, [
      photoFile("a.png"),
      photoFile("b.png"),
      photoFile("c.png"),
    ]);
    expect(imageBlocks(harness).map((block) => block.position)).toEqual([
      { x: 380, y: 290 },
      { x: 380 + PASTE_OFFSET.x, y: 290 + PASTE_OFFSET.y },
      { x: 380 + 2 * PASTE_OFFSET.x, y: 290 + 2 * PASTE_OFFSET.y },
    ]);
    expect(await harness.undoDepth()).toBe(1);
    expect([
      ...getSelection(harness.uiStateStore.getState(), SHEET_A1),
    ]).toHaveLength(3);
  });

  it("steps a later drop away from an image already at the centre", async () => {
    const harness = await openedCanvasHarness();
    await drop(harness, [photoFile("a.png")]);
    await drop(harness, [photoFile("b.png")]);
    expect(imageBlocks(harness).map((block) => block.position)).toEqual([
      { x: 380, y: 290 },
      { x: 380 + PASTE_OFFSET.x, y: 290 + PASTE_OFFSET.y },
    ]);
  });

  it("creates blocks for the imported files and reports each rejected file", async () => {
    const harness = await openedCanvasHarness();
    await drop(harness, [
      photoFile(),
      { fileName: "notes.txt", rejectKind: "invalidImageContent" },
      { fileName: "huge.png", rejectKind: "assetTooLarge" },
    ]);
    expect(imageBlocks(harness)).toHaveLength(1);
    expect(
      operationErrors(harness).map((entry) => [
        entry.operation,
        entry.subject,
        entry.error.kind,
      ]),
    ).toEqual([
      ["importImages", "notes.txt", "invalidImageContent"],
      ["importImages", "huge.png", "assetTooLarge"],
    ]);
  });

  it("runs no command when every file is rejected", async () => {
    const harness = await openedCanvasHarness();
    await drop(harness, [
      { fileName: "a.txt", rejectKind: "invalidImageContent" },
      { fileName: "b.txt", rejectKind: "invalidImageContent" },
    ]);
    expect(harness.blocksOfSheetA1()).toHaveLength(SEEDED_BLOCK_COUNT);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.gateway.methods("saveSheet")).toEqual([]);
    expect(operationErrors(harness)).toHaveLength(2);
  });

  it("reports an unknown drop and creates nothing", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.importDroppedImages({
      dropId: "never-scripted",
      viewportSize: VIEWPORT_SIZE,
    });
    expect(!result.ok && result.error.kind).toBe("invalidDropSelection");
    expect(operationErrors(harness)).toMatchObject([
      { operation: "importImages", error: { kind: "invalidDropSelection" } },
    ]);
    expect(harness.blocksOfSheetA1()).toHaveLength(SEEDED_BLOCK_COUNT);
  });

  it("keeps the imported asset when the command fails", async () => {
    const harness = await openedCanvasHarness();
    harness.gateway.failOn("saveSheet", "ioError");
    const result = await drop(harness, [photoFile()]);
    expect(result.ok).toBe(false);
    expect(harness.blocksOfSheetA1()).toHaveLength(SEEDED_BLOCK_COUNT);
    expect(harness.gateway.hasAsset(DOCUMENT_A, PHOTO)).toBe(true);
    expect(operationErrors(harness)).toMatchObject([
      { operation: "importImages", error: { kind: "ioError" } },
    ]);
  });

  it("undo removes the block, keeps the asset, and redo brings the block back", async () => {
    const harness = await openedCanvasHarness();
    await drop(harness, [photoFile()]);
    await harness.canvasActions.undo(DOCUMENT_A);
    expect(imageBlocks(harness)).toHaveLength(0);
    expect(harness.gateway.hasAsset(DOCUMENT_A, PHOTO)).toBe(true);
    await harness.canvasActions.redo(DOCUMENT_A);
    expect(imageBlocks(harness)[0]?.contentPath).toBe(PHOTO);
  });
});

describe("image blocks and the existing operations", () => {
  it("moves and resizes freely, one history entry each", async () => {
    const { harness, block } = await withDroppedImage();
    await harness.canvasActions.commitDrag({
      ...SHEET_INPUT,
      blockIds: [block.blockId],
      worldDelta: { x: 30, y: 10 },
    });
    await harness.canvasActions.commitResize({
      ...SHEET_INPUT,
      blockId: block.blockId,
      frame: { x: 0, y: 0, width: 123, height: 7 },
    });
    expect(imageBlocks(harness)[0]).toMatchObject({
      position: { x: block.position.x + 30, y: block.position.y + 10 },
      size: { width: 123, height: 7 },
    });
    expect(await harness.undoDepth()).toBe(3);
  });

  it("deletes without deleting the asset, and undo restores the same path", async () => {
    const { harness, block } = await withDroppedImage();
    await harness.canvasActions.deleteSelection({
      ...SHEET_INPUT,
      blockIds: [block.blockId],
    });
    expect(imageBlocks(harness)).toHaveLength(0);
    expect(harness.gateway.methods("deleteBlockContent")).toEqual([]);
    expect(harness.gateway.hasAsset(DOCUMENT_A, PHOTO)).toBe(true);
    await harness.canvasActions.undo(DOCUMENT_A);
    expect(imageBlocks(harness)[0]).toMatchObject({
      blockId: block.blockId,
      contentPath: PHOTO,
    });
  });

  it("changes the z-order", async () => {
    const { harness, block } = await withDroppedImage();
    select(harness, block.blockId);
    await harness.canvasActions.reorderSelection({
      ...SHEET_INPUT,
      direction: "toBack",
    });
    expect(harness.blocksOfSheetA1()[0]?.blockId).toBe(block.blockId);
  });

  it("cannot be edited", async () => {
    const { harness, block } = await withDroppedImage();
    expect(
      harness.canvasActions.beginBlockEdit({
        ...SHEET_INPUT,
        blockId: block.blockId,
      }),
    ).toBe(false);
  });
});

describe("clipboard with image blocks", () => {
  it("validates each image through the gateway when copying, and stores the path", async () => {
    const { harness, block } = await withDroppedImage();
    select(harness, block.blockId);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.gateway.calls).toEqual([
      {
        method: "copyAssetToDocument",
        detail: `${DOCUMENT_A}->${DOCUMENT_A}:${PHOTO}`,
      },
    ]);
    expect(harness.clipboard.read()?.blocks).toMatchObject([
      { kind: "asset", blockType: "image", contentPath: PHOTO },
    ]);
    // Copying is not a history step: only the drop's entry exists.
    expect(await harness.undoDepth()).toBe(1);
  });

  it("leaves out an image whose asset is gone and reports it", async () => {
    const { harness, block } = await withDroppedImage();
    const [text] = harness.blocksOfSheetA1();
    if (text === undefined) throw new Error("text block expected");
    harness.gateway.assets.get(DOCUMENT_A)?.delete(PHOTO);
    select(harness, text.blockId, block.blockId);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.clipboard.read()?.blocks).toMatchObject([{ kind: "text" }]);
    expect(operationErrors(harness)).toMatchObject([
      {
        operation: "copyBlocks",
        subject: "1個のBlock",
        error: { kind: "fileNotFound" },
      },
    ]);
  });

  it("keeps the clipboard unchanged when every copied image failed", async () => {
    const { harness, block } = await withDroppedImage();
    const [text] = harness.blocksOfSheetA1();
    if (text === undefined) throw new Error("text block expected");
    select(harness, text.blockId);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    const kept = harness.clipboard.read();
    harness.gateway.assets.get(DOCUMENT_A)?.delete(PHOTO);
    select(harness, block.blockId);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.clipboard.read()).toBe(kept);
    expect(operationErrors(harness)).toHaveLength(1);
  });

  it("pastes into another sheet of the same document sharing the asset (no copy)", async () => {
    const { harness, block } = await withDroppedImage();
    select(harness, block.blockId);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    harness.gateway.clearCalls();
    const result = await harness.canvasActions.pasteClipboard({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A2,
      viewportSize: VIEWPORT_SIZE,
    });
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("copyAssetToDocument")).toEqual([]);
    const pasted = harness.store
      .getState()
      .documents.get(DOCUMENT_A)
      ?.sheets.get(SHEET_A2)
      ?.blocks.at(-1);
    expect(pasted).toMatchObject({ blockType: "image", contentPath: PHOTO });
    expect(pasted?.blockId).not.toBe(block.blockId);
  });

  it("pastes on the same sheet with the usual offset, undo and redo", async () => {
    const { harness, block } = await withDroppedImage();
    select(harness, block.blockId);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    await harness.canvasActions.pasteClipboard({
      ...SHEET_INPUT,
      viewportSize: VIEWPORT_SIZE,
    });
    const [, pasted] = imageBlocks(harness);
    expect(pasted?.position).toEqual({
      x: block.position.x + PASTE_OFFSET.x,
      y: block.position.y + PASTE_OFFSET.y,
    });
    await harness.canvasActions.undo(DOCUMENT_A);
    expect(imageBlocks(harness)).toHaveLength(1);
    await harness.canvasActions.redo(DOCUMENT_A);
    expect(imageBlocks(harness)).toHaveLength(2);
    expect(harness.gateway.hasAsset(DOCUMENT_A, PHOTO)).toBe(true);
  });

  async function openedWithBothDocuments() {
    const prepared = await withDroppedImage();
    expect((await prepared.harness.actions.openDocument(DOCUMENT_B)).ok).toBe(
      true,
    );
    select(prepared.harness, prepared.block.blockId);
    await prepared.harness.canvasActions.copySelection(SHEET_INPUT);
    prepared.harness.gateway.clearCalls();
    return prepared;
  }

  const pasteIntoB = (harness: CanvasHarness) =>
    harness.canvasActions.pasteClipboard({
      documentId: DOCUMENT_B,
      sheetId: SHEET_B1,
      viewportSize: VIEWPORT_SIZE,
    });
  const blocksOfB = (harness: CanvasHarness): readonly Block[] =>
    harness.store.getState().documents.get(DOCUMENT_B)?.sheets.get(SHEET_B1)
      ?.blocks ?? [];

  it("copies the asset into another document before the command and uses the returned path", async () => {
    const { harness } = await openedWithBothDocuments();
    const result = await pasteIntoB(harness);
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods()).toEqual([
      "copyAssetToDocument",
      "saveSheet",
    ]);
    expect(harness.gateway.calls[0]?.detail).toBe(
      `${DOCUMENT_A}->${DOCUMENT_B}:${PHOTO}`,
    );
    expect(blocksOfB(harness)[0]).toMatchObject({
      blockType: "image",
      contentPath: PHOTO,
    });
    expect(harness.gateway.hasAsset(DOCUMENT_B, PHOTO)).toBe(true);
  });

  it("uses the collision-free path of the copy when the name is taken", async () => {
    const { harness } = await openedWithBothDocuments();
    harness.gateway.seedAsset(DOCUMENT_B, PHOTO);
    await pasteIntoB(harness);
    expect(blocksOfB(harness)[0]?.contentPath).toBe("assets/photo-2.png");
    expect(harness.gateway.hasAsset(DOCUMENT_B, "assets/photo-2.png")).toBe(
      true,
    );
  });

  it("leaves out a block whose asset cannot be copied and runs no command when nothing remains", async () => {
    const { harness } = await openedWithBothDocuments();
    harness.gateway.assets.get(DOCUMENT_A)?.delete(PHOTO);
    const result = await pasteIntoB(harness);
    expect(result.ok).toBe(true);
    expect(blocksOfB(harness)).toHaveLength(0);
    expect(harness.gateway.methods("saveSheet")).toEqual([]);
    expect(operationErrors(harness)).toMatchObject([
      {
        operation: "pasteBlocks",
        subject: "1個のBlock",
        error: { kind: "fileNotFound" },
      },
    ]);
  });

  it("keeps a copied asset when the create command then fails", async () => {
    const { harness } = await openedWithBothDocuments();
    harness.gateway.failOn("saveSheet", "ioError");
    const result = await pasteIntoB(harness);
    expect(result.ok).toBe(false);
    expect(blocksOfB(harness)).toHaveLength(0);
    expect(harness.gateway.hasAsset(DOCUMENT_B, PHOTO)).toBe(true);
  });
});

describe("duplicateSelection with image blocks", () => {
  it("shares the asset and creates one history entry; undo and redo work", async () => {
    const { harness, block } = await withDroppedImage();
    select(harness, block.blockId);
    await harness.canvasActions.duplicateSelection(SHEET_INPUT);
    expect(harness.gateway.methods()).toEqual([
      "copyAssetToDocument",
      "saveSheet",
    ]);
    const [, copy] = imageBlocks(harness);
    expect(copy).toMatchObject({
      contentPath: PHOTO,
      position: {
        x: block.position.x + PASTE_OFFSET.x,
        y: block.position.y + PASTE_OFFSET.y,
      },
    });
    expect(harness.gateway.assets.get(DOCUMENT_A)?.size).toBe(1);
    expect(await harness.undoDepth()).toBe(2);
    await harness.canvasActions.undo(DOCUMENT_A);
    expect(imageBlocks(harness)).toHaveLength(1);
    await harness.canvasActions.redo(DOCUMENT_A);
    expect(imageBlocks(harness)).toHaveLength(2);
  });

  it("duplicates nothing when the asset is gone", async () => {
    const { harness, block } = await withDroppedImage();
    harness.gateway.assets.get(DOCUMENT_A)?.delete(PHOTO);
    select(harness, block.blockId);
    await harness.canvasActions.duplicateSelection(SHEET_INPUT);
    expect(imageBlocks(harness)).toHaveLength(1);
    expect(operationErrors(harness)).toMatchObject([
      { operation: "duplicateBlocks", error: { kind: "fileNotFound" } },
    ]);
  });
});

describe("cutSelection with image blocks", () => {
  it("is one history entry, keeps the asset, and undo restores the block", async () => {
    const { harness, block } = await withDroppedImage();
    select(harness, block.blockId);
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    expect(imageBlocks(harness)).toHaveLength(0);
    expect(harness.clipboard.read()?.blocks).toMatchObject([
      { kind: "asset", contentPath: PHOTO },
    ]);
    expect(harness.gateway.methods("deleteBlockContent")).toEqual([]);
    expect(harness.gateway.hasAsset(DOCUMENT_A, PHOTO)).toBe(true);
    expect(await harness.undoDepth()).toBe(2);
    await harness.canvasActions.undo(DOCUMENT_A);
    expect(imageBlocks(harness)[0]).toMatchObject({
      blockId: block.blockId,
      contentPath: PHOTO,
    });
  });

  it("cuts nothing when the image cannot be validated", async () => {
    const { harness, block } = await withDroppedImage();
    harness.gateway.assets.get(DOCUMENT_A)?.delete(PHOTO);
    select(harness, block.blockId);
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    expect(imageBlocks(harness)).toHaveLength(1);
    expect(harness.clipboard.read()).toBeNull();
  });
});
