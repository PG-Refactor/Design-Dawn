import { describe, expect, it } from "vitest";
import type { Block } from "../../domain/block/block";
import type { DocumentSessionState } from "../state/application-state";
import {
  blockIdOf,
  makeBlockAt,
  position,
  SHEET_ID,
  size,
  textOf,
} from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";
import { moveBlocksCommand } from "./block-commands";
import type { BlockSpec, TextBlockType } from "./command";
import {
  createBlocksCommand,
  deleteBlocksCommand,
} from "./file-backed-commands";

function spec(
  counter: number,
  text: string,
  blockType: TextBlockType = "markdown",
): BlockSpec {
  return {
    blockId: blockIdOf(counter),
    blockType,
    position: position(counter, counter),
    size: size(100, 80),
    text,
  };
}

const THREE_BLOCKS: readonly Block[] = [
  makeBlockAt(1, 0, 0),
  makeBlockAt(2, 10, 10),
  makeBlockAt(3, 20, 20),
];
const FOUR_BLOCKS: readonly Block[] = [...THREE_BLOCKS, makeBlockAt(4, 30, 30)];

const sheetOf = (session: {
  getState(): { sheets: ReadonlyMap<unknown, unknown> };
}) => session.getState().sheets.get(SHEET_ID) as { blocks: readonly Block[] };

describe("create blocks", () => {
  it("writes content first, then the sheet once, as one history step", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "alpha"), spec(11, "beta")]),
    );
    expect(result.ok).toBe(true);
    expect(gateway.methods()).toEqual([
      "createBlockContent",
      "createBlockContent",
      "saveSheet",
    ]);
    const blocks = sheetOf(session).blocks;
    expect(blocks.map((block) => block.blockId)).toEqual([
      ...THREE_BLOCKS.map((block) => block.blockId),
      blockIdOf(10),
      blockIdOf(11),
    ]);
    expect(gateway.files.get(blocks[3]?.contentPath ?? "")).toBe("alpha");
    expect(gateway.savedSheets.get(SHEET_ID)).toBe(sheetOf(session));
    expect(session.getState().history.undoLabel).toBe("createBlocks");
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });

  it("undo deletes the files after saving the sheet; redo restores the same paths", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "alpha"), spec(11, "beta")]),
    );
    const created = sheetOf(session);
    const createdPaths = created.blocks
      .slice(3)
      .map((block) => block.contentPath);
    gateway.clearCalls();

    expect((await session.undo()).ok).toBe(true);
    expect(gateway.methods()).toEqual([
      "readBlockContent",
      "readBlockContent",
      "saveSheet",
      "deleteBlockContent",
      "deleteBlockContent",
    ]);
    expect(sheetOf(session).blocks).toHaveLength(3);
    for (const path of createdPaths)
      expect(gateway.files.has(path)).toBe(false);

    gateway.clearCalls();
    expect((await session.redo()).ok).toBe(true);
    expect(gateway.methods()).toEqual([
      "restoreBlockContent",
      "restoreBlockContent",
      "saveSheet",
    ]);
    expect(sheetOf(session)).toEqual(created);
    expect(createdPaths.map((path) => gateway.files.get(path))).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("flushes a pending auto-save before touching files", async () => {
    const { session, gateway, scheduler } = openSession(THREE_BLOCKS);
    await session.execute(
      moveBlocksCommand(SHEET_ID, [
        { blockId: blockIdOf(1), position: position(7, 7) },
      ]),
    );
    expect(scheduler.pendingCount()).toBe(1);
    await session.execute(createBlocksCommand(SHEET_ID, [spec(10, "alpha")]));
    expect(gateway.methods()).toEqual([
      "saveSheet",
      "createBlockContent",
      "saveSheet",
    ]);
    expect(scheduler.pendingCount()).toBe(0);
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });

  it("does nothing for an empty request", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    expect((await session.execute(createBlocksCommand(SHEET_ID, []))).ok).toBe(
      true,
    );
    expect(gateway.calls).toEqual([]);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("rejects duplicate ids before any I/O", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const before = session.getState();
    const duplicate = await session.execute(
      createBlocksCommand(SHEET_ID, [spec(1, "x")]),
    );
    expect(!duplicate.ok && duplicate.error.kind).toBe("duplicateId");
    const repeated = await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "x"), spec(10, "y")]),
    );
    expect(!repeated.ok && repeated.error.kind).toBe("duplicateId");
    expect(gateway.calls).toEqual([]);
    expect(session.getState().sheets).toBe(before.sheets);
  });

  it("rolls back created files and keeps state when a later content creation fails", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const before = session.getState();
    gateway.failOn("createBlockContent", "ioError", 2);
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "a"), spec(11, "b")]),
    );
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(gateway.methods()).toEqual([
      "createBlockContent",
      "createBlockContent",
      "deleteBlockContent",
    ]);
    expect(
      [...gateway.files.keys()].filter((path) => path.includes("-c")),
    ).toEqual([]);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("rolls back every created file when saving the sheet fails", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const before = session.getState();
    gateway.failOn("saveSheet", "ioError");
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "a"), spec(11, "b")]),
    );
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(gateway.methods()).toEqual([
      "createBlockContent",
      "createBlockContent",
      "saveSheet",
      "deleteBlockContent",
      "deleteBlockContent",
    ]);
    expect(
      [...gateway.files.keys()].filter((path) => path.includes("-c")),
    ).toEqual([]);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("keeps the original error kind and reports files the rollback could not delete", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    gateway.failOn("saveSheet", "ioError");
    gateway.failAlways("deleteBlockContent", "pathOutsideRoot");
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "a")]),
    );
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(!result.ok && result.error.detail).toContain(
      "rollback could not delete",
    );
  });

  it("aborts before creating files when the pending save fails", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    await session.execute(
      moveBlocksCommand(SHEET_ID, [
        { blockId: blockIdOf(1), position: position(7, 7) },
      ]),
    );
    gateway.failOn("saveSheet", "ioError");
    const before = session.getState();
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "a")]),
    );
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    expect(session.getState().save.lastError?.kind).toBe("ioError");
  });

  it("undo of a create keeps state and history when saving the sheet fails", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    await session.execute(createBlocksCommand(SHEET_ID, [spec(10, "a")]));
    const before = session.getState();
    const filesBefore = new Map(gateway.files);
    gateway.failOn("saveSheet", "ioError");
    const result = await session.undo();
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(gateway.methods("deleteBlockContent")).toEqual([]);
    expect(gateway.files).toEqual(filesBefore);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history).toEqual(before.history);
  });

  it("redo of a create that finds its path occupied fails without overwriting", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    await session.execute(createBlocksCommand(SHEET_ID, [spec(10, "mine")]));
    const path = sheetOf(session).blocks[3]?.contentPath ?? "";
    await session.undo();
    gateway.files.set(path, "someone else");
    const before = session.getState();
    const result = await session.redo();
    expect(!result.ok && result.error.kind).toBe("alreadyExists");
    expect(gateway.files.get(path)).toBe("someone else");
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history).toEqual(before.history);
    expect(session.getState().history.canRedo).toBe(true);
  });
});

function remainingBlockIds(session: { getState(): DocumentSessionState }) {
  return (
    session
      .getState()
      .sheets.get(SHEET_ID)
      ?.blocks.map((block) => block.blockId) ?? []
  );
}

describe("delete blocks", () => {
  it("saves the sheet first, then deletes files; reads happen before", async () => {
    const { session, gateway } = openSession(FOUR_BLOCKS);
    const result = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(3)]),
    );
    expect(result.ok).toBe(true);
    expect(gateway.methods()).toEqual([
      "readBlockContent",
      "readBlockContent",
      "saveSheet",
      "deleteBlockContent",
      "deleteBlockContent",
    ]);
    expect(sheetOf(session).blocks.map((b) => b.blockId)).toEqual([
      blockIdOf(2),
      blockIdOf(4),
    ]);
    expect(gateway.files.has(FOUR_BLOCKS[0]?.contentPath ?? "")).toBe(false);
    expect(session.getState().history.undoLabel).toBe("deleteBlocks");
  });

  it("undo restores files and the original z-order; redo deletes again", async () => {
    const { session, gateway } = openSession(FOUR_BLOCKS);
    const before = session.getState();
    await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(3)]),
    );
    const afterDelete = session.getState();
    gateway.clearCalls();

    expect((await session.undo()).ok).toBe(true);
    expect(gateway.methods()).toEqual([
      "restoreBlockContent",
      "restoreBlockContent",
      "saveSheet",
    ]);
    expect(session.getState().sheets).toEqual(before.sheets);
    expect(gateway.files.get(FOUR_BLOCKS[2]?.contentPath ?? "")).toBe(
      textOf(blockIdOf(3)),
    );

    gateway.clearCalls();
    expect((await session.redo()).ok).toBe(true);
    expect(gateway.methods()).toEqual([
      "readBlockContent",
      "readBlockContent",
      "saveSheet",
      "deleteBlockContent",
      "deleteBlockContent",
    ]);
    expect(session.getState().sheets).toEqual(afterDelete.sheets);
  });

  it("fails without changes when a block id is unknown or repeated", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const unknown = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(99)]),
    );
    expect(!unknown.ok && unknown.error.kind).toBe("entityNotFound");
    const repeated = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(1)]),
    );
    expect(!repeated.ok && repeated.error.kind).toBe("duplicateId");
    expect(gateway.calls).toEqual([]);
  });

  it("fails without changes when a body exists but cannot be read", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const before = session.getState();
    gateway.failOn("readBlockContent", "ioError", 2);
    const result = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(2)]),
    );
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(gateway.methods("saveSheet", "deleteBlockContent")).toEqual([]);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("removes a block whose content file is missing and undo restores it without inventing a file", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const missingPath = THREE_BLOCKS[1]?.contentPath ?? "";
    gateway.files.delete(missingPath);
    const filesBefore = new Map(gateway.files);
    gateway.clearCalls();

    const deleted = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(2)]),
    );
    expect(deleted.ok).toBe(true);
    expect(remainingBlockIds(session)).toEqual([blockIdOf(3)]);
    // Only the file that existed is deleted; nothing is attempted for the missing one.
    expect(gateway.methods("deleteBlockContent")).toHaveLength(1);
    expect(session.getState().warnings).toEqual([]);

    const undone = await session.undo();
    expect(undone.ok).toBe(true);
    expect(remainingBlockIds(session)).toEqual([
      blockIdOf(1),
      blockIdOf(2),
      blockIdOf(3),
    ]);
    // Back to exactly the state before: one file restored, the missing one still missing.
    expect(gateway.files).toEqual(filesBefore);
    expect(gateway.files.has(missingPath)).toBe(false);
    expect(session.getState().contents.has(blockIdOf(2))).toBe(false);
    expect(session.getState().contentStatus.has(blockIdOf(2))).toBe(false);

    const redone = await session.redo();
    expect(redone.ok).toBe(true);
    expect(remainingBlockIds(session)).toEqual([blockIdOf(3)]);
  });

  it("deletes no file when saving the sheet fails", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    const before = session.getState();
    gateway.failOn("saveSheet", "ioError");
    const result = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1)]),
    );
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(gateway.methods("deleteBlockContent")).toEqual([]);
    expect(gateway.files.size).toBe(3);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("succeeds with a warning when a file cannot be deleted after the sheet was saved", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    gateway.failOn("deleteBlockContent", "ioError", 2);
    const result = await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(2)]),
    );
    expect(result.ok).toBe(true);
    expect(sheetOf(session).blocks).toHaveLength(1);
    expect(session.getState().history.undoLabel).toBe("deleteBlocks");
    expect(session.getState().warnings).toEqual([
      {
        kind: "orphanContentFile",
        contentPath: THREE_BLOCKS[1]?.contentPath,
        error: { kind: "ioError", detail: "injected: deleteBlockContent" },
      },
    ]);
    await session.execute(
      moveBlocksCommand(SHEET_ID, [
        { blockId: blockIdOf(3), position: position(1, 1) },
      ]),
    );
    expect(session.getState().warnings).toEqual([]);
  });

  it("undo that finds a path occupied removes only the files it restored itself", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(2)]),
    );
    const squatted = THREE_BLOCKS[1]?.contentPath ?? "";
    gateway.files.set(squatted, "squatter");
    const before = session.getState();
    gateway.clearCalls();

    const result = await session.undo();
    expect(!result.ok && result.error.kind).toBe("alreadyExists");
    expect(gateway.methods()).toEqual([
      "restoreBlockContent",
      "restoreBlockContent",
      "deleteBlockContent",
    ]);
    expect(gateway.files.has(THREE_BLOCKS[0]?.contentPath ?? "")).toBe(false);
    expect(gateway.files.get(squatted)).toBe("squatter");
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history).toEqual(before.history);
    expect(session.getState().history.canUndo).toBe(true);
  });

  it("undo removes the restored files again when saving the sheet fails", async () => {
    const { session, gateway } = openSession(THREE_BLOCKS);
    await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(2)]),
    );
    const before = session.getState();
    gateway.clearCalls();
    gateway.failOn("saveSheet", "ioError");
    const result = await session.undo();
    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(gateway.methods()).toEqual([
      "restoreBlockContent",
      "restoreBlockContent",
      "saveSheet",
      "deleteBlockContent",
      "deleteBlockContent",
    ]);
    expect(gateway.files.has(THREE_BLOCKS[0]?.contentPath ?? "")).toBe(false);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history).toEqual(before.history);
  });
});

describe("history across kinds", () => {
  it("undoes a create, a move and a delete in LIFO order", async () => {
    const { session } = openSession(THREE_BLOCKS);
    const initial = session.getState();
    await session.execute(createBlocksCommand(SHEET_ID, [spec(10, "a")]));
    await session.execute(
      moveBlocksCommand(SHEET_ID, [
        { blockId: blockIdOf(10), position: position(77, 77) },
      ]),
    );
    await session.execute(
      deleteBlocksCommand(SHEET_ID, [blockIdOf(2), blockIdOf(10)]),
    );
    for (let step = 0; step < 3; step += 1) {
      expect((await session.undo()).ok).toBe(true);
    }
    expect(session.getState().sheets).toEqual(initial.sheets);
    for (let step = 0; step < 3; step += 1) {
      expect((await session.redo()).ok).toBe(true);
    }
    expect(sheetOf(session).blocks.map((b) => b.blockId)).toEqual([
      blockIdOf(1),
      blockIdOf(3),
    ]);
  });
});
