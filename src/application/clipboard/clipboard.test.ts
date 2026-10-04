import { describe, expect, it } from "vitest";
import { PASTE_OFFSET } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import { type DocumentData, withContents } from "../commands/document-data";
import {
  blockIdOf,
  createSequentialIdGenerator,
  DOCUMENT_ID,
  makeBlockAt,
  makeDocumentData,
  OTHER_SHEET_ID,
  position,
  SHEET_ID,
  size,
  textOf,
  textOfBlockLike,
} from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";
import { type ClipboardContent, createInMemoryClipboard } from "./clipboard";
import { copyBlocks, duplicateBlocks, pasteBlocksCommand } from "./copy-paste";

// Back-to-front: 1 (at 100,100), 2 (at 150,120), 3 (at 400,300).
const BLOCKS: readonly Block[] = [
  makeBlockAt(1, 100, 100),
  makeBlockAt(2, 150, 120),
  makeBlockAt(3, 400, 300),
];

const SOURCE = {
  documentId: DOCUMENT_ID,
  sheetId: SHEET_ID,
  origin: { x: 0, y: 0 },
} as const;

// Application state whose texts are loaded for every block except `unloaded`.
function loadedData(unloaded: readonly number[] = []): DocumentData {
  const unloadedIds = new Set(unloaded.map(blockIdOf));
  return withContents(
    makeDocumentData(BLOCKS),
    BLOCKS.filter((block) => !unloadedIds.has(block.blockId)).map(
      (block) => [block.blockId, textOf(block.blockId)] as const,
    ),
  );
}

function setup() {
  return {
    data: loadedData(),
    clipboard: createInMemoryClipboard(),
    idGenerator: createSequentialIdGenerator(),
  };
}

describe("copyBlocks", () => {
  it("takes each text from the application state and stores offsets relative to the group's top-left", () => {
    const { data, clipboard } = setup();
    const result = copyBlocks({
      state: data,
      sheetId: SHEET_ID,
      // Selection order differs from z-order on purpose.
      blockIds: [blockIdOf(3), blockIdOf(1)],
      clipboard,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        copiedBlockIds: [blockIdOf(1), blockIdOf(3)],
        skippedBlockIds: [],
      },
    });
    expect(clipboard.read()).toEqual({
      source: { ...SOURCE, origin: { x: 100, y: 100 } },
      pasteCount: 0,
      blocks: [
        {
          kind: "text",
          blockType: "markdown",
          size: { width: 100, height: 50 },
          offset: { x: 0, y: 0 },
          text: textOf(blockIdOf(1)),
        },
        {
          kind: "text",
          blockType: "markdown",
          size: { width: 100, height: 50 },
          offset: { x: 300, y: 200 },
          text: textOf(blockIdOf(3)),
        },
      ],
    });
  });

  it("copies the current (edited, unsaved) text, not a file", () => {
    const { clipboard } = setup();
    const edited = withContents(loadedData(), [[blockIdOf(1), "edited"]]);
    copyBlocks({
      state: edited,
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1)],
      clipboard,
    });
    expect(textOfBlockLike(clipboard.read()?.blocks[0])).toBe("edited");
  });

  it("leaves blocks without loaded text out and reports them", () => {
    const { clipboard } = setup();
    const result = copyBlocks({
      state: loadedData([2]),
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1), blockIdOf(2), blockIdOf(3)],
      clipboard,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        copiedBlockIds: [blockIdOf(1), blockIdOf(3)],
        skippedBlockIds: [blockIdOf(2)],
      },
    });
    expect(clipboard.read()?.blocks).toHaveLength(2);
  });

  it("measures the origin from the copied blocks only", () => {
    const { clipboard } = setup();
    copyBlocks({
      state: loadedData([1]),
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1), blockIdOf(2)],
      clipboard,
    });
    expect(clipboard.read()?.source.origin).toEqual({ x: 150, y: 120 });
  });

  it("leaves the clipboard unchanged when nothing has loaded text or the request is invalid", () => {
    const { data, clipboard } = setup();
    const request = { state: data, sheetId: SHEET_ID, clipboard };
    copyBlocks({ ...request, blockIds: [blockIdOf(1)] });
    const kept = clipboard.read();
    const nothingLoaded = copyBlocks({
      ...request,
      state: loadedData([2, 3]),
      blockIds: [blockIdOf(2), blockIdOf(3)],
    });
    expect(nothingLoaded).toEqual({
      ok: true,
      value: {
        copiedBlockIds: [],
        skippedBlockIds: [blockIdOf(2), blockIdOf(3)],
      },
    });
    const unknown = copyBlocks({ ...request, blockIds: [blockIdOf(99)] });
    expect(!unknown.ok && unknown.error.kind).toBe("entityNotFound");
    const empty = copyBlocks({ ...request, blockIds: [] });
    expect(empty.ok).toBe(false);
    expect(clipboard.read()).toBe(kept);
  });

  it("is not a history step and does no I/O", async () => {
    const harness = openSession(BLOCKS);
    await harness.session.loadSheetContents(SHEET_ID);
    harness.gateway.clearCalls();
    const clipboard = createInMemoryClipboard();
    copyBlocks({
      state: harness.session.getState(),
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1)],
      clipboard,
    });
    expect(harness.session.getState().history.canUndo).toBe(false);
    expect(harness.gateway.calls).toEqual([]);
  });
});

describe("pasteBlocksCommand", () => {
  it("creates new ids at target + offset in back-to-front order, as one history step", async () => {
    const { data, clipboard, idGenerator } = setup();
    copyBlocks({
      state: data,
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1), blockIdOf(2)],
      clipboard,
    });
    const content = clipboard.read();
    if (content === null) throw new Error("clipboard should hold content");
    const command = pasteBlocksCommand({
      content,
      sheetId: SHEET_ID,
      target: position(1000, 2000),
      idGenerator,
    });
    if (!command.ok) throw new Error("paste should build");
    expect(command.value.specs.map((spec) => spec.position)).toEqual([
      { x: 1000, y: 2000 },
      { x: 1050, y: 2020 },
    ]);
    const originalIds = BLOCKS.map((block) => block.blockId);
    expect(
      command.value.specs.every((spec) => !originalIds.includes(spec.blockId)),
    ).toBe(true);

    const harness = openSession(BLOCKS);
    harness.gateway.clearCalls();
    expect((await harness.session.execute(command.value)).ok).toBe(true);
    expect(harness.gateway.methods()).toEqual([
      "createBlockContent",
      "createBlockContent",
      "saveSheet",
    ]);
    const blocks =
      harness.session.getState().sheets.get(SHEET_ID)?.blocks ?? [];
    expect(blocks.slice(0, 3)).toEqual(BLOCKS);
    expect(blocks.slice(3).map((block) => block.position)).toEqual([
      { x: 1000, y: 2000 },
      { x: 1050, y: 2020 },
    ]);
    const pastedTexts = blocks
      .slice(3)
      .map((block) => harness.gateway.files.get(block.contentPath));
    expect(pastedTexts).toEqual([textOf(blockIdOf(1)), textOf(blockIdOf(2))]);
    await harness.session.undo();
    expect(harness.session.getState().sheets.get(SHEET_ID)?.blocks).toEqual(
      BLOCKS,
    );
  });

  it("pastes the same content twice with distinct ids", () => {
    const { clipboard, idGenerator } = setup();
    const content: ClipboardContent = {
      source: SOURCE,
      pasteCount: 0,
      blocks: [
        {
          kind: "text" as const,
          blockType: "markdown" as const,
          size: size(1, 1),
          offset: { x: 0, y: 0 },
          text: "t",
        },
      ],
    };
    clipboard.write(content);
    const first = pasteBlocksCommand({
      content,
      sheetId: SHEET_ID,
      target: position(0, 0),
      idGenerator,
    });
    const second = pasteBlocksCommand({
      content,
      sheetId: SHEET_ID,
      target: position(0, 0),
      idGenerator,
    });
    expect(first.ok && second.ok && first.value.specs[0]?.blockId).not.toBe(
      second.ok && second.value.specs[0]?.blockId,
    );
  });

  it("rejects a target that puts a block outside the coordinate range", () => {
    const { idGenerator } = setup();
    const content: ClipboardContent = {
      source: SOURCE,
      pasteCount: 0,
      blocks: [
        {
          kind: "text" as const,
          blockType: "markdown" as const,
          size: size(1, 1),
          offset: { x: 10, y: 0 },
          text: "",
        },
      ],
    };
    const result = pasteBlocksCommand({
      content,
      sheetId: SHEET_ID,
      target: position(2_147_483_647, 0),
      idGenerator,
    });
    expect(!result.ok && result.error.kind).toBe("invalidPosition");
  });
});

describe("duplicateBlocks", () => {
  it("offsets the copies by PASTE_OFFSET as one command and leaves the clipboard alone", async () => {
    const { data, clipboard, idGenerator } = setup();
    const result = duplicateBlocks({
      state: data,
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(2), blockIdOf(1)],
      idGenerator,
    });
    if (!result.ok || result.value.command === null) {
      throw new Error("duplicate should build");
    }
    const { command } = result.value;
    expect(command.specs.map((spec) => spec.position)).toEqual([
      { x: 100 + PASTE_OFFSET.x, y: 100 + PASTE_OFFSET.y },
      { x: 150 + PASTE_OFFSET.x, y: 120 + PASTE_OFFSET.y },
    ]);
    expect(command.specs.map((spec) => textOfBlockLike(spec))).toEqual([
      textOf(blockIdOf(1)),
      textOf(blockIdOf(2)),
    ]);
    expect(clipboard.read()).toBeNull();

    const harness = openSession(BLOCKS);
    await harness.session.execute(command);
    expect(
      harness.session.getState().sheets.get(SHEET_ID)?.blocks,
    ).toHaveLength(5);
    await harness.session.undo();
    expect(
      harness.session.getState().sheets.get(SHEET_ID)?.blocks,
    ).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("creates nothing when no target has loaded text and reports skipped blocks", () => {
    const { idGenerator } = setup();
    const result = duplicateBlocks({
      state: loadedData([1, 2]),
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1), blockIdOf(2)],
      idGenerator,
    });
    expect(result).toEqual({
      ok: true,
      value: { command: null, skippedBlockIds: [blockIdOf(1), blockIdOf(2)] },
    });
  });

  it("duplicates only the blocks that have text", () => {
    const { idGenerator } = setup();
    const result = duplicateBlocks({
      state: loadedData([1]),
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1), blockIdOf(2)],
      idGenerator,
    });
    expect(result.ok && result.value.command?.specs).toHaveLength(1);
    expect(result.ok && result.value.skippedBlockIds).toEqual([blockIdOf(1)]);
  });
});

describe("in-memory clipboard", () => {
  it("starts empty and returns what was written", () => {
    const clipboard = createInMemoryClipboard();
    expect(clipboard.read()).toBeNull();
    const content: ClipboardContent = {
      source: { ...SOURCE, sheetId: OTHER_SHEET_ID },
      pasteCount: 0,
      blocks: [],
    };
    clipboard.write(content);
    expect(clipboard.read()).toBe(content);
  });
});
