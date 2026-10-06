import { describe, expect, it } from "vitest";
import { moveBlocksCommand } from "../commands/block-commands";
import type { BlockSpec } from "../commands/command";
import { editBlockContentCommand } from "../commands/content-commands";
import {
  createBlocksCommand,
  deleteBlocksCommand,
} from "../commands/file-backed-commands";
import {
  blockIdOf,
  PROJECT_ID,
  position,
  SHEET_ID,
  settle,
  size,
  textOf,
} from "../test-support/fakes";
import {
  openSession,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../test-support/session-harness";
import { withSheetRemoved } from "../workspace/sheet-structure";
import { createDocumentSession } from "./document-session";

const FIRST = blockIdOf(1);
const edit = (text: string, blockId = FIRST) =>
  editBlockContentCommand({ sheetId: SHEET_ID, blockId, text });

async function loadedSession() {
  const harness = openSession();
  await harness.session.loadSheetContents(SHEET_ID);
  harness.gateway.clearCalls();
  return harness;
}

const pathOf = (harness: Awaited<ReturnType<typeof loadedSession>>) =>
  harness.session.getState().sheets.get(SHEET_ID)?.blocks[0]?.contentPath ?? "";

describe("saving edited content", () => {
  it("marks the content dirty, updates state at once and writes after the delay", async () => {
    const harness = await loadedSession();
    const { session, gateway, scheduler } = harness;
    await session.execute(edit("edited"));
    expect(session.getState().contents.get(FIRST)).toBe("edited");
    expect([...session.getState().save.dirtyContentBlockIds]).toEqual([FIRST]);
    expect(gateway.methods()).toEqual([]);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual(["writeBlockContent"]);
    expect(gateway.files.get(pathOf(harness))).toBe("edited");
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });

  it("writes only the last text of several edits within the delay", async () => {
    const harness = await loadedSession();
    const { session, gateway, scheduler } = harness;
    await session.execute(edit("one"));
    await session.execute(edit("two"));
    await session.execute(edit("three"));
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual(["writeBlockContent"]);
    expect(gateway.files.get(pathOf(harness))).toBe("three");
  });

  it("writes LF-normalized text, equal to the state", async () => {
    const harness = await loadedSession();
    await harness.session.execute(edit("a\r\nb"));
    await harness.session.flush();
    expect(harness.gateway.files.get(pathOf(harness))).toBe(
      harness.session.getState().contents.get(FIRST),
    );
  });

  it("keeps the dirty flag and the error on a write failure and retries on flush", async () => {
    const harness = await loadedSession();
    const { session, gateway } = harness;
    await session.execute(edit("edited"));
    gateway.failOn("writeBlockContent", "ioError");
    const failed = await session.flush();
    expect(!failed.ok && failed.error.kind).toBe("ioError");
    expect(session.getState().save.lastError?.kind).toBe("ioError");
    expect(session.getState().save.dirtyContentBlockIds.has(FIRST)).toBe(true);
    expect(gateway.files.get(pathOf(harness))).toBe(textOf(FIRST));

    expect((await session.flush()).ok).toBe(true);
    expect(gateway.files.get(pathOf(harness))).toBe("edited");
    expect(session.getState().save.lastError).toBeNull();
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
  });

  it("writes content before the sheet when both are dirty", async () => {
    const harness = await loadedSession();
    const { session, gateway } = harness;
    await session.execute(
      moveBlocksCommand(SHEET_ID, [
        { blockId: FIRST, position: position(3, 3) },
      ]),
    );
    await session.execute(edit("edited"));
    await session.flush();
    expect(gateway.methods()).toEqual(["writeBlockContent", "saveSheet"]);
  });

  it("saves dirty content when the session closes", async () => {
    const harness = await loadedSession();
    await harness.session.execute(edit("edited"));
    expect((await harness.session.close()).ok).toBe(true);
    expect(harness.gateway.files.get(pathOf(harness))).toBe("edited");
  });

  it("drops the dirty flag of a block removed without a write to a missing file", async () => {
    const harness = await loadedSession();
    const { session, gateway } = harness;
    await session.execute(edit("edited"));
    const path = pathOf(harness);
    await session.execute(deleteBlocksCommand(SHEET_ID, [FIRST]));
    expect(gateway.methods()).toEqual([
      // The pending edit is flushed before the sequence reads the text.
      "writeBlockContent",
      "readBlockContent",
      "saveSheet",
      "deleteBlockContent",
    ]);
    expect(gateway.files.has(path)).toBe(false);
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
    gateway.clearCalls();
    await session.flush();
    expect(gateway.calls).toEqual([]);
  });

  it("drops the dirty flag when its sheet is removed without flushing", async () => {
    const { session, gateway } = await loadedSession();
    await session.execute(edit("edited"));
    await session.runExclusive(async (scope) =>
      scope.applyStructuralChange((data) => withSheetRemoved(data, SHEET_ID), {
        clearHistory: true,
        markDirty: false,
      }),
    );
    const state = session.getState();
    expect(state.save.dirtyContentBlockIds.size).toBe(0);
    expect(state.contents.size).toBe(0);
    expect(state.contentStatus.size).toBe(0);
    await session.flush();
    expect(gateway.methods("writeBlockContent")).toEqual([]);
  });

  it("a new session on the same disk sees the saved text after loading", async () => {
    const harness = await loadedSession();
    await harness.session.execute(edit("persisted"));
    await harness.session.flush();
    const state = harness.session.getState();
    const reopened = createDocumentSession({
      projectId: PROJECT_ID,
      document: state.document,
      sheets: state.sheets,
      gateway: harness.gateway,
      scheduler: harness.scheduler,
      config: {
        undoHistoryLimit: 50,
        autoSaveDelayMs: TEST_AUTO_SAVE_DELAY_MS,
      },
      onStateChange: () => undefined,
    });
    expect(reopened.getState().contents.size).toBe(0);
    await reopened.loadSheetContents(SHEET_ID);
    expect(reopened.getState().contents.get(FIRST)).toBe("persisted");
  });
});

function spec(counter: number, text: string): BlockSpec {
  return {
    blockId: blockIdOf(counter),
    blockType: "markdown",
    position: position(counter, counter),
    size: size(100, 80),
    text,
  };
}

const NEW_BLOCK = blockIdOf(10);

// Every loaded text must equal its file once everything is saved.
function expectContentsOnDisk(
  harness: Awaited<ReturnType<typeof loadedSession>>,
) {
  const state = harness.session.getState();
  const blocks = state.sheets.get(SHEET_ID)?.blocks ?? [];
  for (const block of blocks) {
    const text = state.contents.get(block.blockId);
    expect(text).toBeDefined();
    expect(harness.gateway.files.get(block.contentPath)).toBe(text);
  }
}

describe("content in file-backed sequences", () => {
  it("create puts the initial text into state as loaded", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    await session.execute(
      createBlocksCommand(SHEET_ID, [spec(10, "alpha\r\n")]),
    );
    const state = session.getState();
    expect(state.contents.get(NEW_BLOCK)).toBe("alpha\n");
    expect(state.contentStatus.get(NEW_BLOCK)).toEqual({ status: "loaded" });
    expect(state.save.dirtyContentBlockIds.size).toBe(0);
    expectContentsOnDisk(harness);
  });

  it("delete removes texts, status and dirty flags; undo restores the text", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    await session.execute(deleteBlocksCommand(SHEET_ID, [FIRST]));
    let state = session.getState();
    expect(state.contents.has(FIRST)).toBe(false);
    expect(state.contentStatus.has(FIRST)).toBe(false);
    await session.undo();
    state = session.getState();
    expect(state.contents.get(FIRST)).toBe(textOf(FIRST));
    expect(state.contentStatus.get(FIRST)).toEqual({ status: "loaded" });
    await session.flush();
    expectContentsOnDisk(harness);
  });

  it("an edited but unsaved text survives delete then undo", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    await session.execute(edit("edited, not saved yet"));
    expect(session.getState().save.dirtyContentBlockIds.has(FIRST)).toBe(true);
    await session.execute(deleteBlocksCommand(SHEET_ID, [FIRST]));
    await session.undo();
    expect(session.getState().contents.get(FIRST)).toBe(
      "edited, not saved yet",
    );
    const restoredPath = session
      .getState()
      .sheets.get(SHEET_ID)
      ?.blocks.find((block) => block.blockId === FIRST)?.contentPath;
    expect(harness.gateway.files.get(restoredPath ?? "")).toBe(
      "edited, not saved yet",
    );
  });

  it("an edit can be undone and redone after a block was restored", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    await session.execute(createBlocksCommand(SHEET_ID, [spec(10, "alpha")]));
    await session.execute(edit("beta", NEW_BLOCK));
    await session.undo(); // edit
    await session.undo(); // create
    expect(session.getState().contents.has(NEW_BLOCK)).toBe(false);
    await session.redo(); // create (restore)
    expect(session.getState().contents.get(NEW_BLOCK)).toBe("alpha");
    await session.redo(); // edit
    expect(session.getState().contents.get(NEW_BLOCK)).toBe("beta");
    await session.flush();
    expectContentsOnDisk(harness);
  });

  it("keeps contents consistent with the disk through an undo / redo chain", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    await session.execute(edit("one"));
    await session.execute(deleteBlocksCommand(SHEET_ID, [FIRST]));
    await session.execute(createBlocksCommand(SHEET_ID, [spec(10, "alpha")]));
    for (const operation of [
      () => session.undo(),
      () => session.undo(),
      () => session.undo(),
      () => session.redo(),
      () => session.redo(),
      () => session.redo(),
    ]) {
      await operation();
      await session.flush();
      expectContentsOnDisk(harness);
    }
  });
});
