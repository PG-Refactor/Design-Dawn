import { describe, expect, it } from "vitest";
import { settle, size, textOf } from "../../application/test-support/fakes";
import { TEST_AUTO_SAVE_DELAY_MS } from "../../application/test-support/session-harness";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
  SHEET_A2,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import type { Block } from "../../domain/block/block";
import type { BlockId } from "../../domain/shared/entity-id";
import { getSelection, selectBlocks } from "../workspace/ui-state/ui-state";
import {
  BLOCK_ONE,
  BLOCK_THREE,
  BLOCK_TWO,
  type CanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

// Blocks (100 x 50): ONE at (10,20), TWO at (300,40), THREE at (0,200).
const VIEWPORT_SIZE = { width: 800, height: 600 };
const SHEET_INPUT = { documentId: DOCUMENT_A, sheetId: SHEET_A1 };

function select(harness: CanvasHarness, ...blockIds: BlockId[]): void {
  harness.uiStateStore.setState((state) =>
    selectBlocks(state, SHEET_A1, blockIds),
  );
}

const selectionOf = (harness: CanvasHarness) => [
  ...getSelection(harness.uiStateStore.getState(), SHEET_A1),
];
const orderOf = (harness: CanvasHarness) =>
  harness.blocksOfSheetA1().map((block) => block.blockId);
const paste = (harness: CanvasHarness) =>
  harness.canvasActions.pasteClipboard({
    ...SHEET_INPUT,
    viewportSize: VIEWPORT_SIZE,
  });

async function loadContents(harness: CanvasHarness): Promise<void> {
  await harness.canvasActions.loadSheetContents(SHEET_INPUT);
  harness.gateway.clearCalls();
}

function newBlocks(harness: CanvasHarness, existing = 3): readonly Block[] {
  return harness.blocksOfSheetA1().slice(existing);
}

function textAt(harness: CanvasHarness, block: Block): string | undefined {
  return harness.gateway.files.get(block.contentPath);
}

describe("copySelection", () => {
  it("does nothing for an empty selection", async () => {
    const harness = await openedCanvasHarness();
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.clipboard.read()).toBeNull();
    expect(harness.gateway.calls).toEqual([]);
  });

  it("copies from the application state without reading any file, with no history entry", async () => {
    const harness = await openedCanvasHarness();
    await loadContents(harness);
    select(harness, BLOCK_ONE, BLOCK_THREE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.gateway.methods("readBlockContent")).toEqual([]);
    expect(harness.gateway.calls).toEqual([]);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.clipboard.read()).toMatchObject({
      source: {
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        origin: { x: 0, y: 20 },
      },
      pasteCount: 0,
      blocks: [
        { offset: { x: 10, y: 0 }, text: textOf(BLOCK_ONE) },
        { offset: { x: 0, y: 180 }, text: textOf(BLOCK_THREE) },
      ],
    });
  });

  it("copies unsaved edits, not the file", async () => {
    const harness = await openedCanvasHarness();
    await loadContents(harness);
    await harness.canvasActions.commitContentEdit({
      ...SHEET_INPUT,
      blockId: BLOCK_ONE,
      text: "edited",
    });
    select(harness, BLOCK_ONE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.clipboard.read()?.blocks[0]?.text).toBe("edited");
  });

  it("waits for the sheet's contents to load before copying", async () => {
    const harness = await openedCanvasHarness();
    expect(harness.session.getState().contents.size).toBe(0);
    select(harness, BLOCK_ONE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.gateway.methods("readBlockContent")).toHaveLength(3);
    expect(harness.clipboard.read()?.blocks[0]?.text).toBe(textOf(BLOCK_ONE));
  });

  it("leaves out blocks that failed to load and reports how many", async () => {
    const harness = await openedCanvasHarness();
    const failed = harness.blocksOfSheetA1()[1];
    if (failed === undefined) throw new Error("block expected");
    harness.gateway.files.delete(failed.contentPath);
    select(harness, BLOCK_ONE, BLOCK_TWO);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.clipboard.read()?.blocks).toHaveLength(1);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      {
        operation: "copyBlocks",
        subject: "1個のBlock",
        error: { kind: "fileNotFound" },
      },
    ]);
  });

  it("keeps the previous clipboard content when every target failed to load", async () => {
    const harness = await openedCanvasHarness();
    const failed = harness.blocksOfSheetA1()[1];
    if (failed === undefined) throw new Error("block expected");
    harness.gateway.files.delete(failed.contentPath);
    select(harness, BLOCK_ONE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    const kept = harness.clipboard.read();
    expect(kept).not.toBeNull();
    select(harness, BLOCK_TWO);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    expect(harness.clipboard.read()).toBe(kept);
    expect(harness.uiStateStore.getState().operationErrors).toHaveLength(1);
  });
});

describe("pasteClipboard on the same sheet", () => {
  it("does nothing while the clipboard is empty", async () => {
    const harness = await openedCanvasHarness();
    expect((await paste(harness)).ok).toBe(true);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("steps +24, +48, +72 from the originals with new ids and new content files", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    harness.gateway.clearCalls();
    for (let count = 0; count < 3; count += 1) await paste(harness);
    const pasted = newBlocks(harness);
    expect(pasted.map((block) => block.position)).toEqual([
      { x: 34, y: 44 },
      { x: 58, y: 68 },
      { x: 82, y: 92 },
    ]);
    const ids = new Set([...orderOf(harness)]);
    expect(ids.size).toBe(6);
    const paths = new Set(harness.blocksOfSheetA1().map((b) => b.contentPath));
    expect(paths.size).toBe(6);
    for (const block of pasted) {
      expect(textAt(harness, block)).toBe(textOf(BLOCK_ONE));
    }
    expect(harness.gateway.methods("createBlockContent")).toHaveLength(3);
    expect(harness.clipboard.read()?.pasteCount).toBe(3);
    // The newest paste is the selection.
    expect(selectionOf(harness)).toEqual([pasted[2]?.blockId]);
    expect(await harness.undoDepth()).toBe(3);
  });

  it("keeps relative positions and z-order of a group and appends it on top", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_THREE, BLOCK_ONE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    await paste(harness);
    const pasted = newBlocks(harness);
    expect(orderOf(harness).slice(0, 3)).toEqual([
      BLOCK_ONE,
      BLOCK_TWO,
      BLOCK_THREE,
    ]);
    // Group origin (0, 20) -> (24, 44); ONE was behind THREE.
    expect(pasted.map((block) => block.position)).toEqual([
      { x: 34, y: 44 },
      { x: 24, y: 224 },
    ]);
    expect(pasted.map((block) => textAt(harness, block))).toEqual([
      textOf(BLOCK_ONE),
      textOf(BLOCK_THREE),
    ]);
    expect(selectionOf(harness)).toEqual(pasted.map((block) => block.blockId));
    expect(harness.session.getState().history.undoLabel).toBe("createBlocks");
    expect(await harness.undoDepth()).toBe(1);
  });

  it("undo removes the pasted blocks and redo brings them back; auto-save persists them", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    await paste(harness);
    const [pasted] = newBlocks(harness);
    if (pasted === undefined) throw new Error("pasted block expected");
    await harness.session.undo();
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.gateway.files.has(pasted.contentPath)).toBe(false);
    await harness.session.redo();
    expect(harness.blocksOfSheetA1()).toHaveLength(4);
    expect(textAt(harness, pasted)).toBe(textOf(BLOCK_ONE));

    harness.gateway.clearCalls();
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    // The create sequence saved the sheet itself; nothing is left dirty afterwards.
    expect(harness.session.getState().save.dirtySheetIds.size).toBe(0);
    expect(
      harness.gateway.savedSheets.get(SHEET_A1)?.blocks.map((b) => b.blockId),
    ).toContain(pasted.blockId);
  });

  it("records an error and creates nothing when the target is out of range", async () => {
    const harness = await openedCanvasHarness();
    harness.clipboard.write({
      source: {
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        origin: { x: 2_147_483_640, y: 0 },
      },
      pasteCount: 0,
      blocks: [
        {
          blockType: "markdown",
          size: size(10, 10),
          offset: { x: 0, y: 0 },
          text: "t",
        },
      ],
    });
    const result = await paste(harness);
    expect(result.ok).toBe(false);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "pasteBlocks" },
    ]);
    expect(harness.clipboard.read()?.pasteCount).toBe(0);
  });
});

describe("pasteClipboard into another sheet or document", () => {
  it("centres the group in the visible rectangle of another sheet; pasteCount stays", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    const result = await harness.canvasActions.pasteClipboard({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A2,
      viewportSize: VIEWPORT_SIZE,
    });
    expect(result.ok).toBe(true);
    const blocks =
      harness.store.getState().documents.get(DOCUMENT_A)?.sheets.get(SHEET_A2)
        ?.blocks ?? [];
    // 100 x 50 block in 800 x 600 -> (350, 275); the seeded block stays below.
    expect(blocks.at(-1)?.position).toEqual({ x: 350, y: 275 });
    expect(blocks).toHaveLength(2);
    expect(harness.clipboard.read()?.pasteCount).toBe(0);
  });

  it("pastes into a different document", async () => {
    const harness = await openedCanvasHarness();
    expect((await harness.actions.openDocument(DOCUMENT_B)).ok).toBe(true);
    select(harness, BLOCK_ONE, BLOCK_TWO);
    await harness.canvasActions.copySelection(SHEET_INPUT);
    harness.gateway.clearCalls();
    const result = await harness.canvasActions.pasteClipboard({
      documentId: DOCUMENT_B,
      sheetId: SHEET_B1,
      viewportSize: VIEWPORT_SIZE,
    });
    expect(result.ok).toBe(true);
    const blocks =
      harness.store.getState().documents.get(DOCUMENT_B)?.sheets.get(SHEET_B1)
        ?.blocks ?? [];
    // Bounding box 390 x 70 at origin (10, 20): centred -> (205, 265).
    expect(blocks.map((block) => block.position)).toEqual([
      { x: 205, y: 265 },
      { x: 495, y: 285 },
    ]);
    expect(harness.gateway.methods("createBlockContent")).toHaveLength(2);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.clipboard.read()?.pasteCount).toBe(0);
  });
});

describe("duplicateSelection", () => {
  it("does nothing for an empty selection", async () => {
    const harness = await openedCanvasHarness();
    await harness.canvasActions.duplicateSelection(SHEET_INPUT);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("duplicates one block +24,+24 as one entry and selects the copy", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE);
    await harness.canvasActions.duplicateSelection(SHEET_INPUT);
    const [copy] = newBlocks(harness);
    expect(copy?.position).toEqual({ x: 34, y: 44 });
    expect(copy === undefined ? null : textAt(harness, copy)).toBe(
      textOf(BLOCK_ONE),
    );
    expect(copy?.contentPath).not.toBe(
      harness.blocksOfSheetA1()[0]?.contentPath,
    );
    expect(selectionOf(harness)).toEqual([copy?.blockId]);
    expect(harness.clipboard.read()).toBeNull();
    expect(await harness.undoDepth()).toBe(1);
    await harness.session.undo();
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    await harness.session.redo();
    expect(harness.blocksOfSheetA1()).toHaveLength(4);
  });

  it("duplicates several blocks in one entry keeping relative position and z-order", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_THREE, BLOCK_TWO);
    await harness.canvasActions.duplicateSelection(SHEET_INPUT);
    expect(newBlocks(harness).map((block) => block.position)).toEqual([
      { x: 324, y: 64 },
      { x: 24, y: 224 },
    ]);
    expect(await harness.undoDepth()).toBe(1);
  });

  it("reads no files for loaded blocks", async () => {
    const harness = await openedCanvasHarness();
    await loadContents(harness);
    select(harness, BLOCK_ONE);
    await harness.canvasActions.duplicateSelection(SHEET_INPUT);
    expect(harness.gateway.methods("readBlockContent")).toEqual([]);
  });

  it("creates nothing and reports when no target has text", async () => {
    const harness = await openedCanvasHarness();
    const missing = harness.blocksOfSheetA1()[0];
    if (missing === undefined) throw new Error("block expected");
    harness.gateway.files.delete(missing.contentPath);
    select(harness, BLOCK_ONE);
    await harness.canvasActions.duplicateSelection(SHEET_INPUT);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "duplicateBlocks", subject: "1個のBlock" },
    ]);
  });
});

describe("cutSelection", () => {
  it("does nothing for an empty selection", async () => {
    const harness = await openedCanvasHarness();
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    expect(harness.clipboard.read()).toBeNull();
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
  });

  it("copies and deletes one block as exactly one history entry; undo restores block and content", async () => {
    const harness = await openedCanvasHarness();
    const original = harness.blocksOfSheetA1()[0];
    if (original === undefined) throw new Error("block expected");
    select(harness, BLOCK_ONE);
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    expect(orderOf(harness)).toEqual([BLOCK_TWO, BLOCK_THREE]);
    expect(harness.clipboard.read()?.blocks[0]?.text).toBe(textOf(BLOCK_ONE));
    expect(harness.session.getState().history.undoLabel).toBe("deleteBlocks");
    expect(harness.gateway.files.has(original.contentPath)).toBe(false);
    expect(await harness.undoDepth()).toBe(1);

    await harness.session.undo();
    expect(orderOf(harness)).toEqual([BLOCK_ONE, BLOCK_TWO, BLOCK_THREE]);
    expect(harness.gateway.files.get(original.contentPath)).toBe(
      textOf(BLOCK_ONE),
    );
    expect(harness.session.getState().contents.get(BLOCK_ONE)).toBe(
      textOf(BLOCK_ONE),
    );
    await harness.session.redo();
    expect(orderOf(harness)).toEqual([BLOCK_TWO, BLOCK_THREE]);
  });

  it("cuts several blocks as one entry", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE, BLOCK_THREE);
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    expect(orderOf(harness)).toEqual([BLOCK_TWO]);
    expect(harness.clipboard.read()?.blocks).toHaveLength(2);
    expect(await harness.undoDepth()).toBe(1);
    await harness.session.undo();
    expect(orderOf(harness)).toEqual([BLOCK_ONE, BLOCK_TWO, BLOCK_THREE]);
  });

  it("pastes next to the cut position afterwards (origin + 24)", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE);
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    await paste(harness);
    expect(harness.blocksOfSheetA1().at(-1)?.position).toEqual({
      x: 34,
      y: 44,
    });
  });

  it("deletes only the blocks that were copied and reports the rest", async () => {
    const harness = await openedCanvasHarness();
    const failed = harness.blocksOfSheetA1()[1];
    if (failed === undefined) throw new Error("block expected");
    harness.gateway.files.delete(failed.contentPath);
    select(harness, BLOCK_ONE, BLOCK_TWO);
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    expect(orderOf(harness)).toEqual([BLOCK_TWO, BLOCK_THREE]);
    expect(harness.clipboard.read()?.blocks).toHaveLength(1);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "cutBlocks", subject: "1個のBlock" },
    ]);
    expect(await harness.undoDepth()).toBe(1);
  });

  it("changes nothing when no target could be copied", async () => {
    const harness = await openedCanvasHarness();
    const failed = harness.blocksOfSheetA1()[1];
    if (failed === undefined) throw new Error("block expected");
    harness.gateway.files.delete(failed.contentPath);
    select(harness, BLOCK_TWO);
    await harness.canvasActions.cutSelection(SHEET_INPUT);
    expect(orderOf(harness)).toEqual([BLOCK_ONE, BLOCK_TWO, BLOCK_THREE]);
    expect(harness.clipboard.read()).toBeNull();
    expect(harness.session.getState().history.canUndo).toBe(false);
  });
});

describe("reorderSelection", () => {
  const reorder = (
    harness: CanvasHarness,
    direction: "forward" | "backward" | "toFront" | "toBack",
  ) => harness.canvasActions.reorderSelection({ ...SHEET_INPUT, direction });

  it("moves one block in each direction as one entry", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE);
    await reorder(harness, "forward");
    expect(orderOf(harness)).toEqual([BLOCK_TWO, BLOCK_ONE, BLOCK_THREE]);
    await reorder(harness, "toFront");
    expect(orderOf(harness)).toEqual([BLOCK_TWO, BLOCK_THREE, BLOCK_ONE]);
    await reorder(harness, "backward");
    expect(orderOf(harness)).toEqual([BLOCK_TWO, BLOCK_ONE, BLOCK_THREE]);
    await reorder(harness, "toBack");
    expect(orderOf(harness)).toEqual([BLOCK_ONE, BLOCK_TWO, BLOCK_THREE]);
    expect(harness.session.getState().history.undoLabel).toBe("reorderBlocks");
  });

  it("keeps the relative order of a multi-selection", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE, BLOCK_TWO);
    await reorder(harness, "toFront");
    expect(orderOf(harness)).toEqual([BLOCK_THREE, BLOCK_ONE, BLOCK_TWO]);
    expect(await harness.undoDepth()).toBe(1);
    select(harness, BLOCK_TWO, BLOCK_THREE);
    await reorder(harness, "toBack");
    expect(orderOf(harness)).toEqual([BLOCK_THREE, BLOCK_TWO, BLOCK_ONE]);
  });

  it("is a no-op without a selection and creates no entry when nothing moves", async () => {
    const harness = await openedCanvasHarness();
    await reorder(harness, "toFront");
    expect(harness.session.getState().history.canUndo).toBe(false);
    select(harness, BLOCK_THREE);
    await reorder(harness, "toFront");
    await reorder(harness, "forward");
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(orderOf(harness)).toEqual([BLOCK_ONE, BLOCK_TWO, BLOCK_THREE]);
  });

  it("undo and redo restore the order", async () => {
    const harness = await openedCanvasHarness();
    select(harness, BLOCK_ONE);
    await reorder(harness, "toFront");
    await harness.session.undo();
    expect(orderOf(harness)).toEqual([BLOCK_ONE, BLOCK_TWO, BLOCK_THREE]);
    await harness.session.redo();
    expect(orderOf(harness)).toEqual([BLOCK_TWO, BLOCK_THREE, BLOCK_ONE]);
  });
});
