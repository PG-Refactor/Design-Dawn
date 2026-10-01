import { describe, expect, it } from "vitest";
import { blockIdOf, textOf } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import { parseBlockId } from "../../domain/shared/entity-id";
import { MARKDOWN_BLOCK_DEFAULTS } from "../markdown/markdown-block-defaults";
import { getSelection, setViewport } from "../workspace/ui-state/ui-state";
import { clampViewport } from "./geometry/viewport-math";
import {
  BLOCK_ONE,
  type CanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

const VIEWPORT_SIZE = { width: 800, height: 600 };

// With the default viewport (no pan, zoom 1) the visible world rectangle is the canvas
// itself, so a 480 x 320 block is centred at ((800-480)/2, (600-320)/2).
const CENTRED = { x: 160, y: 140 };

async function createMarkdown(harness: CanvasHarness) {
  return harness.canvasActions.createBlock({
    documentId: DOCUMENT_A,
    sheetId: SHEET_A1,
    blockType: "markdown",
    viewportSize: VIEWPORT_SIZE,
  });
}

function newestBlock(harness: CanvasHarness) {
  const block = harness.blocksOfSheetA1().at(-1);
  if (block === undefined) throw new Error("the sheet has no block");
  return block;
}

describe("createBlock", () => {
  it("adds one markdown block as ONE createBlocks history entry and selects it", async () => {
    const harness = await openedCanvasHarness();
    const result = await createMarkdown(harness);
    expect(result.ok).toBe(true);

    const block = newestBlock(harness);
    expect(harness.blocksOfSheetA1()).toHaveLength(4);
    expect(block.blockType).toBe("markdown");
    expect(parseBlockId(block.blockId).ok).toBe(true);
    expect(result.ok && result.value).toBe(block.blockId);
    expect(block.size).toEqual(MARKDOWN_BLOCK_DEFAULTS.size);
    expect(harness.session.getState().history.undoLabel).toBe("createBlocks");
    expect(await harness.undoDepth()).toBe(1);
    expect([
      ...getSelection(harness.uiStateStore.getState(), SHEET_A1),
    ]).toEqual([block.blockId]);
  });

  it("writes the initial text to the content file under the sheet's blocks directory", async () => {
    const harness = await openedCanvasHarness();
    await createMarkdown(harness);
    const block = newestBlock(harness);
    expect(block.contentPath).toMatch(
      /^sheets\/[^/]+\/blocks\/markdown-.+\.md$/,
    );
    expect(harness.gateway.files.get(block.contentPath)).toBe("# New Markdown");
    // The text is known to the session, so the block shows it without a read.
    expect(harness.session.getState().contents.get(block.blockId)).toBe(
      "# New Markdown",
    );
    expect(harness.gateway.methods("readBlockContent")).toEqual([]);
  });

  it("centres the block in the visible world rectangle", async () => {
    const harness = await openedCanvasHarness();
    await createMarkdown(harness);
    expect(newestBlock(harness).position).toEqual(CENTRED);
  });

  it("follows pan and zoom of the sheet's viewport", async () => {
    const harness = await openedCanvasHarness();
    harness.uiStateStore.setState((state) =>
      setViewport(
        state,
        SHEET_A1,
        clampViewport({ panX: -100, panY: -50, zoom: 2 }),
      ),
    );
    await createMarkdown(harness);
    // Visible: x 50..450, y 25..325 -> centre (250, 175) -> top-left (10, 15).
    expect(newestBlock(harness).position).toEqual({ x: 10, y: 15 });
  });

  it("steps by the paste offset until the position is free", async () => {
    const harness = await openedCanvasHarness();
    await createMarkdown(harness);
    await createMarkdown(harness);
    await createMarkdown(harness);
    expect(
      harness
        .blocksOfSheetA1()
        .slice(3)
        .map((block) => block.position),
    ).toEqual([CENTRED, { x: 184, y: 164 }, { x: 208, y: 188 }]);
  });

  it("never reuses the content file of a deleted block, and undo / redo restore the same path", async () => {
    const harness = await openedCanvasHarness();
    await createMarkdown(harness);
    const first = newestBlock(harness);
    await harness.canvasActions.deleteSelection({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockIds: [first.blockId],
    });
    expect(harness.gateway.files.has(first.contentPath)).toBe(false);

    await createMarkdown(harness);
    const second = newestBlock(harness);
    expect(second.contentPath).not.toBe(first.contentPath);

    await harness.session.undo();
    expect(
      harness.blocksOfSheetA1().map((block) => block.blockId),
    ).not.toContain(second.blockId);
    expect(harness.gateway.files.has(second.contentPath)).toBe(false);
    await harness.session.redo();
    expect(newestBlock(harness).contentPath).toBe(second.contentPath);
    expect(harness.gateway.files.get(second.contentPath)).toBe(
      "# New Markdown",
    );
  });

  it("records an operation error and changes nothing when the file cannot be created", async () => {
    const harness = await openedCanvasHarness();
    harness.gateway.failOn("createBlockContent", "ioError");
    const result = await createMarkdown(harness);
    expect(result.ok).toBe(false);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(getSelection(harness.uiStateStore.getState(), SHEET_A1).size).toBe(
      0,
    );
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "createBlock", error: { kind: "ioError" } },
    ]);
  });

  it("refuses a block type that cannot be created", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.createBlock({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockType: "mermaid",
      viewportSize: VIEWPORT_SIZE,
    });
    expect(result.ok).toBe(false);
    expect(harness.blocksOfSheetA1()).toHaveLength(3);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "createBlock", error: { kind: "unsupportedBlockType" } },
    ]);
  });
});

describe("loadSheetContents", () => {
  it("reads the texts of the sheet once; a repeat reads nothing", async () => {
    const harness = await openedCanvasHarness();
    const input = { documentId: DOCUMENT_A, sheetId: SHEET_A1 };
    expect((await harness.canvasActions.loadSheetContents(input)).ok).toBe(
      true,
    );
    expect(harness.session.getState().contents.get(BLOCK_ONE)).toBe(
      textOf(BLOCK_ONE),
    );
    expect(harness.gateway.methods("readBlockContent")).toHaveLength(3);
    await harness.canvasActions.loadSheetContents(input);
    expect(harness.gateway.methods("readBlockContent")).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("marks a missing file as failed instead of showing empty text", async () => {
    const harness = await openedCanvasHarness();
    const missing = harness.blocksOfSheetA1()[0];
    if (missing === undefined) throw new Error("block expected");
    harness.gateway.files.delete(missing.contentPath);
    await harness.canvasActions.loadSheetContents({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
    });
    const state = harness.session.getState();
    expect(state.contentStatus.get(missing.blockId)).toMatchObject({
      status: "failed",
      error: { kind: "fileNotFound" },
    });
    expect(state.contents.has(missing.blockId)).toBe(false);
  });

  it("records an error for a document that is not open", async () => {
    const harness = await openedCanvasHarness();
    const result = await harness.canvasActions.loadSheetContents({
      documentId:
        harness.store.getState().project?.documents[1]?.documentId ??
        DOCUMENT_A,
      sheetId: SHEET_A2,
    });
    expect(result.ok).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "loadBlockContents" },
    ]);
  });
});

describe("beginBlockEdit", () => {
  const edit = (blockId = BLOCK_ONE) => ({
    documentId: DOCUMENT_A,
    sheetId: SHEET_A1,
    blockId,
  });

  async function loaded(): Promise<CanvasHarness> {
    const harness = await openedCanvasHarness();
    await harness.canvasActions.loadSheetContents({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
    });
    return harness;
  }

  it("opens the editor for a loaded Markdown block and selects it", async () => {
    const harness = await loaded();
    expect(harness.canvasActions.beginBlockEdit(edit())).toBe(true);
    const ui = harness.uiStateStore.getState();
    expect(ui.editingBlock).toEqual({ sheetId: SHEET_A1, blockId: BLOCK_ONE });
    expect([...getSelection(ui, SHEET_A1)]).toEqual([BLOCK_ONE]);
  });

  it("refuses a block whose text is not loaded", async () => {
    const harness = await openedCanvasHarness();
    expect(harness.canvasActions.beginBlockEdit(edit())).toBe(false);
    expect(harness.uiStateStore.getState().editingBlock).toBeNull();
  });

  it("refuses a block whose text failed to load", async () => {
    const harness = await openedCanvasHarness();
    const block = harness.blocksOfSheetA1()[0];
    if (block === undefined) throw new Error("block expected");
    harness.gateway.files.delete(block.contentPath);
    await harness.canvasActions.loadSheetContents({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
    });
    expect(harness.canvasActions.beginBlockEdit(edit(block.blockId))).toBe(
      false,
    );
  });

  it("refuses an unknown block", async () => {
    const harness = await loaded();
    expect(harness.canvasActions.beginBlockEdit(edit(blockIdOf(999)))).toBe(
      false,
    );
  });
});

describe("commitContentEdit", () => {
  async function loaded(): Promise<CanvasHarness> {
    const harness = await openedCanvasHarness();
    await harness.canvasActions.loadSheetContents({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
    });
    return harness;
  }
  const commit = (harness: CanvasHarness, text: string, blockId = BLOCK_ONE) =>
    harness.canvasActions.commitContentEdit({
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      blockId,
      text,
    });

  it("makes one editBlockContent entry; undo and redo switch the text", async () => {
    const harness = await loaded();
    expect((await commit(harness, "# Edited")).ok).toBe(true);
    expect(harness.session.getState().contents.get(BLOCK_ONE)).toBe("# Edited");
    expect(harness.session.getState().history.undoLabel).toBe(
      "editBlockContent",
    );
    expect(await harness.undoDepth()).toBe(1);
    await harness.session.undo();
    expect(harness.session.getState().contents.get(BLOCK_ONE)).toBe(
      textOf(BLOCK_ONE),
    );
    await harness.session.redo();
    expect(harness.session.getState().contents.get(BLOCK_ONE)).toBe("# Edited");
  });

  it("makes no history entry for identical text", async () => {
    const harness = await loaded();
    expect((await commit(harness, textOf(BLOCK_ONE))).ok).toBe(true);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("records an operation error for a block whose text is not loaded", async () => {
    const harness = await openedCanvasHarness();
    const result = await commit(harness, "x");
    expect(result.ok).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "editBlockContent", error: { kind: "notWritable" } },
    ]);
  });
});
