import { describe, expect, it } from "vitest";
import { moveBlocksCommand } from "../commands/block-commands";
import { renameDocumentCommand } from "../commands/naming-commands";
import {
  blockIdOf,
  displayName,
  position,
  SHEET_ID,
  settle,
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
