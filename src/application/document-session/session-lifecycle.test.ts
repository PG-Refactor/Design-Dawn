import { describe, expect, it } from "vitest";
import { err, ok } from "../../domain/shared/domain-result";
import {
  renameDocumentCommand,
  renameSheetCommand,
} from "../commands/naming-commands";
import { displayName, OTHER_SHEET_ID, SHEET_ID } from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";

describe("close", () => {
  it("returns the save error and keeps the session open when saving fails", async () => {
    const { session, gateway } = openSession();
    await session.execute(renameSheetCommand(SHEET_ID, displayName("A")));
    gateway.failOn("saveSheet", "ioError");
    const closed = await session.close();
    expect(!closed.ok && closed.error.kind).toBe("ioError");
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
    expect(session.getState().history.canUndo).toBe(true);
    expect(
      (await session.execute(renameSheetCommand(SHEET_ID, displayName("B"))))
        .ok,
    ).toBe(true);
    expect((await session.close()).ok).toBe(true);
    expect(gateway.savedSheets.get(SHEET_ID)?.name).toBe("B");
  });

  it("is idempotent once closed", async () => {
    const { session } = openSession();
    expect((await session.close()).ok).toBe(true);
    expect((await session.close()).ok).toBe(true);
  });
});

describe("discard", () => {
  it("closes without saving and stops the timer", async () => {
    const { session, gateway, scheduler } = openSession();
    await session.execute(renameSheetCommand(SHEET_ID, displayName("Lost")));
    await session.discard();
    expect(gateway.methods()).toEqual([]);
    expect(scheduler.pendingCount()).toBe(0);
    const afterDiscard = await session.flush();
    expect(!afterDiscard.ok && afterDiscard.error.kind).toBe("notWritable");
    expect(gateway.methods()).toEqual([]);
  });

  it("does not save when a timer callback was already queued", async () => {
    const { session, gateway, scheduler } = openSession();
    await session.execute(renameSheetCommand(SHEET_ID, displayName("Lost")));
    scheduler.advance(1000);
    await session.discard();
    expect(gateway.methods()).toEqual([]);
  });
});

describe("runExclusive", () => {
  it("is rejected after close", async () => {
    const { session } = openSession();
    await session.close();
    const result = await session.runExclusive(async () => ({
      ok: true,
      value: 1,
    }));
    expect(!result.ok && result.error.kind).toBe("notWritable");
  });

  it("applies structural changes outside the history and clears it on request", async () => {
    const { session } = openSession();
    await session.execute(renameSheetCommand(SHEET_ID, displayName("A")));
    await session.runExclusive(async (scope) => {
      const renamed = scope.applyStructuralChange(
        (data) =>
          ok({
            ...data,
            document: {
              ...data.document,
              sheetOrder: [OTHER_SHEET_ID],
            },
          }),
        { clearHistory: false, markDirty: true },
      );
      expect(renamed.ok).toBe(true);
      return ok(undefined);
    });
    expect(session.getState().history.canUndo).toBe(true);
    expect(session.getState().save.documentDirty).toBe(true);
    await session.runExclusive(async (scope) =>
      scope.applyStructuralChange((data) => ok(data), {
        clearHistory: true,
        markDirty: false,
      }),
    );
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("does not mark sheets that appear or disappear dirty", async () => {
    const { session } = openSession();
    await session.runExclusive(async (scope) =>
      scope.applyStructuralChange(
        (data) => {
          const sheets = new Map(data.sheets);
          sheets.delete(OTHER_SHEET_ID);
          return ok({ ...data, sheets });
        },
        { clearHistory: false, markDirty: true },
      ),
    );
    expect(session.getState().save.dirtySheetIds.size).toBe(0);
  });

  it("returns a failing change as an error and changes nothing", async () => {
    const { session } = openSession();
    const before = session.getState();
    const result = await session.runExclusive(async (scope) =>
      scope.applyStructuralChange(() => err("entityNotFound", "nope"), {
        clearHistory: true,
        markDirty: true,
      }),
    );
    expect(!result.ok && result.error.kind).toBe("entityNotFound");
    expect(session.getState()).toBe(before);
  });

  it("runs behind queued commands", async () => {
    const { session } = openSession();
    const order: string[] = [];
    const command = session
      .execute(renameDocumentCommand(displayName("X")))
      .then(() => order.push("command"));
    const exclusive = session.runExclusive(async () => {
      order.push("exclusive");
      return ok(undefined);
    });
    await Promise.all([command, exclusive]);
    expect(order).toEqual(["command", "exclusive"]);
  });
});
