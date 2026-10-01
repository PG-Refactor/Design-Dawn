import { describe, expect, it } from "vitest";
import { PASTE_OFFSET } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import {
  blockIdOf,
  createFakeGateway,
  createSequentialIdGenerator,
  filesForBlocks,
  makeBlockAt,
  makeDocumentData,
  PROJECT_ID,
  position,
  SHEET_ID,
  size,
  textOf,
} from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";
import { createInMemoryClipboard } from "./clipboard";
import { copyBlocks, duplicateBlocks, pasteBlocksCommand } from "./copy-paste";

// Back-to-front: 1 (at 100,100), 2 (at 150,120), 3 (at 400,300).
const BLOCKS: readonly Block[] = [
  makeBlockAt(1, 100, 100),
  makeBlockAt(2, 150, 120),
  makeBlockAt(3, 400, 300),
];

function setup() {
  const data = makeDocumentData(BLOCKS);
  const gateway = createFakeGateway(filesForBlocks(BLOCKS));
  const clipboard = createInMemoryClipboard();
  return {
    data,
    gateway,
    clipboard,
    idGenerator: createSequentialIdGenerator(),
  };
}

describe("copyBlocks", () => {
  it("reads each text and stores offsets relative to the group's top-left", async () => {
    const { data, gateway, clipboard } = setup();
    const result = await copyBlocks({
      state: data,
      sheetId: SHEET_ID,
      // Selection order differs from z-order on purpose.
      blockIds: [blockIdOf(3), blockIdOf(1)],
      projectId: PROJECT_ID,
      gateway,
      clipboard,
    });
    expect(result.ok).toBe(true);
    expect(clipboard.read()).toEqual({
      blocks: [
        {
          blockType: "markdown",
          size: { width: 100, height: 50 },
          offset: { x: 0, y: 0 },
          text: textOf(blockIdOf(1)),
        },
        {
          blockType: "markdown",
          size: { width: 100, height: 50 },
          offset: { x: 300, y: 200 },
          text: textOf(blockIdOf(3)),
        },
      ],
    });
    expect(gateway.methods()).toEqual(["readBlockContent", "readBlockContent"]);
  });

  it("leaves the clipboard unchanged when a read fails or the request is invalid", async () => {
    const { data, gateway, clipboard } = setup();
    const request = {
      state: data,
      sheetId: SHEET_ID,
      projectId: PROJECT_ID,
      gateway,
      clipboard,
    };
    await copyBlocks({ ...request, blockIds: [blockIdOf(1)] });
    const kept = clipboard.read();
    gateway.failOn("readBlockContent", "ioError", 2);
    const failed = await copyBlocks({
      ...request,
      blockIds: [blockIdOf(2), blockIdOf(3)],
    });
    expect(!failed.ok && failed.error.kind).toBe("ioError");
    const unknown = await copyBlocks({ ...request, blockIds: [blockIdOf(99)] });
    expect(!unknown.ok && unknown.error.kind).toBe("entityNotFound");
    const empty = await copyBlocks({ ...request, blockIds: [] });
    expect(empty.ok).toBe(false);
    expect(clipboard.read()).toBe(kept);
  });

  it("is not a history step", async () => {
    const harness = openSession(BLOCKS);
    const clipboard = createInMemoryClipboard();
    await copyBlocks({
      state: {
        document: harness.session.getState().document,
        sheets: harness.session.getState().sheets,
        contents: harness.session.getState().contents,
      },
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1)],
      projectId: PROJECT_ID,
      gateway: harness.gateway,
      clipboard,
    });
    expect(harness.session.getState().history.canUndo).toBe(false);
  });
});

describe("pasteBlocksCommand", () => {
  it("creates new ids at target + offset in back-to-front order, as one history step", async () => {
    const { data, gateway, clipboard, idGenerator } = setup();
    await copyBlocks({
      state: data,
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1), blockIdOf(2)],
      projectId: PROJECT_ID,
      gateway,
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
    const content = {
      blocks: [
        {
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
    const content = {
      blocks: [
        {
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
    const { data, gateway, clipboard, idGenerator } = setup();
    const result = await duplicateBlocks({
      state: data,
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(2), blockIdOf(1)],
      projectId: PROJECT_ID,
      gateway,
      idGenerator,
    });
    if (!result.ok) throw new Error("duplicate should build");
    expect(result.value.specs.map((spec) => spec.position)).toEqual([
      { x: 100 + PASTE_OFFSET.x, y: 100 + PASTE_OFFSET.y },
      { x: 150 + PASTE_OFFSET.x, y: 120 + PASTE_OFFSET.y },
    ]);
    expect(clipboard.read()).toBeNull();

    const harness = openSession(BLOCKS);
    await harness.session.execute(result.value);
    expect(
      harness.session.getState().sheets.get(SHEET_ID)?.blocks,
    ).toHaveLength(5);
    await harness.session.undo();
    expect(
      harness.session.getState().sheets.get(SHEET_ID)?.blocks,
    ).toHaveLength(3);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("fails without a command when reading fails", async () => {
    const { data, gateway, idGenerator } = setup();
    gateway.failAlways("readBlockContent", "ioError");
    const result = await duplicateBlocks({
      state: data,
      sheetId: SHEET_ID,
      blockIds: [blockIdOf(1)],
      projectId: PROJECT_ID,
      gateway,
      idGenerator,
    });
    expect(!result.ok && result.error.kind).toBe("ioError");
  });
});

describe("in-memory clipboard", () => {
  it("starts empty and returns what was written", () => {
    const clipboard = createInMemoryClipboard();
    expect(clipboard.read()).toBeNull();
    const content = { blocks: [] };
    clipboard.write(content);
    expect(clipboard.read()).toBe(content);
  });
});
