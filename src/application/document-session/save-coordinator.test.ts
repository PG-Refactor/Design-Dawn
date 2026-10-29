import { describe, expect, it } from "vitest";
import { moveBlocksCommand } from "../commands/block-commands";
import { createBlocksCommand } from "../commands/file-backed-commands";
import { renameDocumentCommand } from "../commands/naming-commands";
import { createFakeAutoSavePolicy } from "../test-support/fake-auto-save-policy";
import {
  blockIdOf,
  displayName,
  position,
  SHEET_ID,
  settle,
  size,
} from "../test-support/fakes";
import {
  openSession,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../test-support/session-harness";

const moveFirst = (x: number) =>
  moveBlocksCommand(SHEET_ID, [
    { blockId: blockIdOf(1), position: position(x, x) },
  ]);

const savedPositionX = (harness: ReturnType<typeof openSession>) =>
  harness.gateway.savedSheets.get(SHEET_ID)?.blocks[0]?.position.x;

describe("auto-save", () => {
  it("saves once after the quiet period, restarting the delay on each change", async () => {
    const harness = openSession();
    const { session, gateway, scheduler } = harness;
    await session.execute(moveFirst(1));
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS - 1);
    await session.execute(moveFirst(2));
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS - 1);
    await settle();
    expect(gateway.methods()).toEqual([]);
    scheduler.advance(1);
    await settle();
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(savedPositionX(harness)).toBe(2);
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
    expect(session.getState().save.saving).toBe(false);
  });

  it("saves the latest state at save time, not the state at scheduling time", async () => {
    const harness = openSession();
    await harness.session.execute(moveFirst(1));
    await harness.session.execute(moveFirst(5));
    await harness.session.undo();
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(savedPositionX(harness)).toBe(1);
  });

  it("tracks dirty sheets and the dirty document, and saves the document", async () => {
    const { session, gateway, scheduler } = openSession();
    await session.execute(renameDocumentCommand(displayName("New name")));
    expect(session.getState().save).toMatchObject({ documentDirty: true });
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual(["saveDocument"]);
    expect(gateway.savedDocumentNames).toEqual(["New name"]);
    expect(session.getState().save.documentDirty).toBe(false);
  });

  it("marks undo and redo changes dirty as well", async () => {
    const { session, scheduler, gateway } = openSession();
    await session.execute(moveFirst(1));
    await session.flush();
    gateway.clearCalls();
    await session.undo();
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual(["saveSheet"]);
  });
});

describe("flush", () => {
  it("saves immediately and cancels the pending timer", async () => {
    const { session, gateway, scheduler } = openSession();
    await session.execute(moveFirst(1));
    expect(scheduler.pendingCount()).toBe(1);
    expect((await session.flush()).ok).toBe(true);
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(scheduler.pendingCount()).toBe(0);
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });

  it("does nothing when nothing is dirty", async () => {
    const { session, gateway } = openSession();
    expect((await session.flush()).ok).toBe(true);
    expect(gateway.calls).toEqual([]);
  });
});

describe("save failures", () => {
  it("keeps the dirty flags, records the error and retries on the next change", async () => {
    const { session, gateway, scheduler } = openSession();
    gateway.failOn("saveSheet", "ioError");
    await session.execute(moveFirst(1));
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    expect(session.getState().save.lastError?.kind).toBe("ioError");
    expect(session.getState().save.saving).toBe(false);
    // No hot retry loop: nothing is scheduled until the next change or flush.
    expect(scheduler.pendingCount()).toBe(0);

    await session.execute(moveFirst(2));
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
    expect(session.getState().save.lastError).toBeNull();
  });

  it("returns the error from flush and retries on the next flush", async () => {
    const { session, gateway } = openSession();
    await session.execute(moveFirst(1));
    gateway.failOn("saveSheet", "ioError");
    const failed = await session.flush();
    expect(!failed.ok && failed.error.kind).toBe("ioError");
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    expect((await session.flush()).ok).toBe(true);
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });

  it("saves the part that works when the other part fails", async () => {
    const { session, gateway } = openSession();
    await session.execute(moveFirst(1));
    await session.execute(renameDocumentCommand(displayName("Renamed")));
    gateway.failOn("saveDocument", "ioError");
    await session.flush();
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
    expect(session.getState().save.documentDirty).toBe(true);
  });
});

describe("serialisation", () => {
  it("runs overlapping execute, undo and flush strictly in call order", async () => {
    const harness = openSession();
    const { session, gateway } = harness;
    await session.execute(moveFirst(1));
    const release = gateway.hold("saveSheet");

    const flushing = session.flush();
    const executing = session.execute(moveFirst(9));
    const undoing = session.undo();
    await settle();
    // The held save blocks everything queued behind it.
    expect(session.getState().save.saving).toBe(true);
    expect(session.getState().sheets.get(SHEET_ID)?.blocks[0]?.position.x).toBe(
      1,
    );
    expect(session.getState().history.undoLabel).toBe("moveBlocks");

    release();
    expect((await flushing).ok).toBe(true);
    expect((await executing).ok).toBe(true);
    expect((await undoing).ok).toBe(true);
    expect(savedPositionX(harness)).toBe(1);
    expect(session.getState().sheets.get(SHEET_ID)?.blocks[0]?.position.x).toBe(
      1,
    );
    expect(session.getState().history.canRedo).toBe(true);
  });

  it("queues an auto-save behind a running command", async () => {
    const { session, gateway, scheduler } = openSession();
    await session.execute(moveFirst(1));
    const release = gateway.hold("saveSheet");
    const flushing = session.flush();
    await settle();
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    expect(gateway.methods("saveSheet")).toHaveLength(1);
    release();
    await flushing;
    await settle();
    expect(gateway.methods("saveSheet")).toHaveLength(1);
  });
});

describe("dispose", () => {
  it("flushes pending changes and stops the timer", async () => {
    const { session, gateway, scheduler } = openSession();
    await session.execute(moveFirst(1));
    expect((await session.close()).ok).toBe(true);
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(scheduler.pendingCount()).toBe(0);
    const afterClose = await session.execute(moveFirst(2));
    expect(!afterClose.ok && afterClose.error.kind).toBe("notWritable");
  });
});

describe("auto-save switched off", () => {
  function openWithPolicy(enabled: boolean) {
    const policy = createFakeAutoSavePolicy(enabled);
    const harness = openSession(undefined, {}, policy);
    return { ...harness, policy };
  }

  it("keeps changes dirty without starting a timer, and flush still saves", async () => {
    const { session, gateway, scheduler } = openWithPolicy(false);
    await session.execute(moveFirst(1));
    expect(scheduler.pendingCount()).toBe(0);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS * 10);
    await settle();
    expect(gateway.methods()).toEqual([]);
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    expect((await session.flush()).ok).toBe(true);
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });

  it("does not save a timer that was already running when it was switched off", async () => {
    const { session, gateway, scheduler, policy } = openWithPolicy(true);
    await session.execute(moveFirst(1));
    policy.set(false);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual([]);
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
  });

  it("saves the dirty session after the delay once auto-save resumes", async () => {
    const { session, gateway, scheduler, policy } = openWithPolicy(false);
    await session.execute(moveFirst(1));
    policy.set(true);
    session.resumeAutoSave();
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS - 1);
    await settle();
    expect(gateway.methods()).toEqual([]);
    scheduler.advance(1);
    await settle();
    expect(gateway.methods()).toEqual(["saveSheet"]);
  });

  it("starts no timer on resume when nothing is dirty", () => {
    const { session, scheduler } = openWithPolicy(true);
    session.resumeAutoSave();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("still writes a file-backed command immediately", async () => {
    const { session, gateway } = openWithPolicy(false);
    const result = await session.execute(
      createBlocksCommand(SHEET_ID, [
        {
          blockId: blockIdOf(10),
          blockType: "markdown",
          position: position(1, 1),
          size: size(100, 80),
          text: "alpha",
        },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(gateway.methods()).toEqual(["createBlockContent", "saveSheet"]);
  });

  it("flushes pending changes before a file-backed command", async () => {
    const { session, gateway } = openWithPolicy(false);
    await session.execute(moveFirst(1));
    await session.execute(
      createBlocksCommand(SHEET_ID, [
        {
          blockId: blockIdOf(10),
          blockType: "markdown",
          position: position(1, 1),
          size: size(100, 80),
          text: "alpha",
        },
      ]),
    );
    expect(gateway.methods()[0]).toBe("saveSheet");
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });
});

describe("saving suspended by an external change", () => {
  const conflict = {
    kind: "externalConflict",
    detail: "changed outside",
  } as const;

  it("starts no timer and writes nothing while suspended, and keeps the changes dirty", async () => {
    const { session, gateway, scheduler } = openSession();
    session.suspendSaving(conflict);
    await session.execute(moveFirst(1));
    expect(scheduler.pendingCount()).toBe(0);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS * 2);
    await settle();
    expect(gateway.methods()).toEqual([]);
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    expect(session.getState().save.lastError?.kind).toBe("externalConflict");
  });

  it("makes flush fail with externalConflict instead of saving", async () => {
    const { session, gateway } = openSession();
    await session.execute(moveFirst(1));
    session.suspendSaving(conflict);
    const flushed = await session.flush();
    expect(flushed.ok).toBe(false);
    if (!flushed.ok) expect(flushed.error.kind).toBe("externalConflict");
    expect(gateway.methods()).toEqual([]);
  });

  it("shows no error and lets flush succeed while nothing is unsaved", async () => {
    const { session } = openSession();
    session.suspendSaving(conflict);
    expect(session.getState().save.lastError).toBeNull();
    expect((await session.flush()).ok).toBe(true);
  });

  it("saves again after resuming, restarting the timer for what is dirty", async () => {
    const { session, gateway, scheduler } = openSession();
    session.suspendSaving(conflict);
    await session.execute(moveFirst(1));
    session.resumeSaving();
    expect(session.getState().save.lastError).toBeNull();
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual(["saveSheet"]);
  });

  it("does not hide a different save error when it resumes", async () => {
    const { session, gateway, scheduler } = openSession();
    gateway.failOn("saveSheet", "ioError");
    await session.execute(moveFirst(1));
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    session.suspendSaving(conflict);
    await session.flush();
    session.resumeSaving();
    // The conflict error is gone, but the sheet is still dirty and can be retried.
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    expect((await session.flush()).ok).toBe(true);
  });

  it("stops a file-backed command, which saves what is pending first", async () => {
    const { session, gateway } = openSession();
    await session.execute(moveFirst(1));
    session.suspendSaving(conflict);
    gateway.clearCalls();
    const created = await session.execute(
      createBlocksCommand(SHEET_ID, [
        {
          blockId: blockIdOf(10),
          blockType: "markdown",
          position: position(1, 1),
          size: size(100, 80),
          text: "alpha",
        },
      ]),
    );
    expect(created.ok).toBe(false);
    expect(gateway.methods("createBlockContent", "saveSheet")).toEqual([]);
  });
});
