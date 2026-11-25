import { describe, expect, it } from "vitest";
import type { Block } from "../../domain/block/block";
import type { ContentPath } from "../../domain/block/content-path";
import { operationErr, operationOk } from "../ports/operation-error";
import {
  blockIdOf,
  createFakeGateway,
  DOCUMENT_ID,
  type FakeGateway,
  filesForBlocks,
  makeBlockAt,
  makeSheetWith,
  PROJECT_ID,
  position,
  SHEET_ID,
  size,
} from "../test-support/fakes";
import {
  addBlocksWithContent,
  type DeferredFiles,
  removeBlocksWithContent,
  restoreBlocksWithContent,
  type SequenceContext,
} from "./block-file-sequences";
import type { BlockSpec } from "./command";

const TEXT = makeBlockAt(1, 0, 0);
const IMAGE = makeBlockAt(2, 10, 10, "image");
const SHEET = makeSheetWith(SHEET_ID, [TEXT, IMAGE]);

interface Plans {
  readonly created: string[];
  readonly removed: string[];
  readonly restored: string[];
}

function deferredFiles(held: ReadonlyMap<string, string> = new Map()): {
  readonly files: DeferredFiles;
  readonly plans: Plans;
} {
  const plans: Plans = { created: [], removed: [], restored: [] };
  return {
    plans,
    files: {
      textOf: (blockId) => held.get(blockId),
      planCreate: (create) => plans.created.push(create.blockId),
      planRemoval: (blockId) => plans.removed.push(blockId),
      planRestore: (create) => plans.restored.push(create.blockId),
    },
  };
}

function context(
  gateway: FakeGateway,
  deferred: DeferredFiles | null,
  flushFails = false,
): SequenceContext {
  return {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    gateway,
    flushPending: async () =>
      flushFails
        ? operationErr("ioError", "flush failed")
        : operationOk(undefined),
    deferred: () => deferred,
  };
}

const textSpec = (counter: number): BlockSpec => ({
  blockId: blockIdOf(counter),
  blockType: "markdown",
  position: position(1, 1),
  size: size(10, 10),
  text: "new",
});

const imageSpec = (counter: number): BlockSpec => ({
  blockId: blockIdOf(counter),
  blockType: "image",
  position: position(1, 1),
  size: size(10, 10),
  contentPath: "assets/picture.png" as ContentPath,
});

describe("block file sequences with auto-save off", () => {
  it("adds an image block without planning a file, and a text block with one", async () => {
    const { files, plans } = deferredFiles();
    const added = await addBlocksWithContent(
      context(createFakeGateway(), files),
      SHEET,
      [imageSpec(5), textSpec(6)],
    );
    expect(added.ok && added.value.sheet.blocks).toHaveLength(4);
    expect(plans.created).toEqual([blockIdOf(6)]);
  });

  it("refuses a reservation that fails, and a block id that is taken before any file work", async () => {
    const gateway = createFakeGateway();
    gateway.failOn("reserveBlockContent", "ioError");
    const { files } = deferredFiles();
    expect(
      (
        await addBlocksWithContent(context(gateway, files), SHEET, [
          textSpec(6),
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await addBlocksWithContent(context(createFakeGateway(), files), SHEET, [
          imageSpec(1),
        ])
      ).ok,
    ).toBe(false);
  });

  it("removes an image, a held text, a read text and a text whose file is gone", async () => {
    const held = makeBlockAt(3, 0, 0);
    const read = makeBlockAt(4, 0, 0);
    const gone = makeBlockAt(5, 0, 0);
    const sheet = makeSheetWith(SHEET_ID, [IMAGE, held, read, gone]);
    const gateway = createFakeGateway(filesForBlocks([read]));
    const { files, plans } = deferredFiles(new Map([[held.blockId, "held"]]));
    const removed = await removeBlocksWithContent(
      context(gateway, files),
      sheet,
      sheet.blocks.map((block) => block.blockId),
    );
    if (!removed.ok) throw new Error(removed.error.detail);
    expect(removed.value.captured.map((entry) => entry.text)).toEqual([
      null,
      "held",
      expect.any(String),
      null,
    ]);
    expect(plans.removed).toEqual([held.blockId, read.blockId]);

    const restored = restoreBlocksWithContent(
      context(gateway, files),
      makeSheetWith(SHEET_ID, []),
      removed.value.captured,
    );
    expect((await restored).ok).toBe(true);
    expect(plans.restored).toEqual([held.blockId, read.blockId]);
  });

  it("stops a removal when a text cannot be read", async () => {
    const gateway = createFakeGateway(filesForBlocks([TEXT]));
    gateway.failOn("readBlockContent", "ioError");
    const { files } = deferredFiles();
    expect(
      (
        await removeBlocksWithContent(context(gateway, files), SHEET, [
          TEXT.blockId,
        ])
      ).ok,
    ).toBe(false);
  });
});

describe("block file sequences with auto-save on", () => {
  const gateway = () => createFakeGateway(filesForBlocks([TEXT]));

  it("changes nothing for nothing to remove or restore", async () => {
    const removed = await removeBlocksWithContent(
      context(gateway(), null),
      SHEET,
      [],
    );
    expect(removed.ok && removed.value.sheet).toBe(SHEET);
    const restored = await restoreBlocksWithContent(
      context(gateway(), null),
      SHEET,
      [],
    );
    expect(restored.ok && restored.value.sheet).toBe(SHEET);
  });

  it("stops when the pending changes cannot be saved first", async () => {
    expect(
      (
        await removeBlocksWithContent(context(gateway(), null, true), SHEET, [
          TEXT.blockId,
        ])
      ).ok,
    ).toBe(false);
    const captured = [{ block: makeBlockAt(7, 0, 0), index: 0, text: "x" }];
    expect(
      (
        await restoreBlocksWithContent(
          context(gateway(), null, true),
          SHEET,
          captured,
        )
      ).ok,
    ).toBe(false);
  });

  it("refuses to restore a block that is already there", async () => {
    const captured = [{ block: TEXT as Block, index: 0, text: "x" }];
    expect(
      (
        await restoreBlocksWithContent(
          context(gateway(), null),
          SHEET,
          captured,
        )
      ).ok,
    ).toBe(false);
  });
});
