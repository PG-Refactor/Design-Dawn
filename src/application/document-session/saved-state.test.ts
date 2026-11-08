import { describe, expect, it } from "vitest";
import { moveBlocksCommand } from "../commands/block-commands";
import type { AutoSavePolicy } from "../ports/auto-save-policy";
import type { DocumentSessionState } from "../state/application-state";
import { blockIdOf, position, SHEET_ID } from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";

// Unsaved means "the data differs from what the files hold", as in an editor: undo / redo
// back to the last saved state leaves nothing unsaved.

const moveFirstBlock = (x: number) =>
  moveBlocksCommand(SHEET_ID, [
    { blockId: blockIdOf(1), position: position(x, 0) },
  ]);

function isUnsaved(state: DocumentSessionState): boolean {
  const { save } = state;
  return (
    save.documentDirty ||
    save.dirtySheetIds.size > 0 ||
    save.dirtyContentBlockIds.size > 0
  );
}

// Auto-save off: what is unsaved stays visible until an explicit save.
const MANUAL_SAVE: AutoSavePolicy = {
  isEnabled: () => false,
  subscribe: () => () => undefined,
};

describe("unsaved after undo and redo", () => {
  it("is cleared by undoing back to the state the files hold", async () => {
    const { session, gateway } = openSession(undefined, {}, MANUAL_SAVE);
    await session.execute(moveFirstBlock(10));
    await session.execute(moveFirstBlock(20));
    expect(isUnsaved(session.getState())).toBe(true);

    await session.undo();
    expect(isUnsaved(session.getState())).toBe(true);
    await session.undo();
    expect(isUnsaved(session.getState())).toBe(false);

    // Redo moves away from the saved state again, and a second undo returns to it.
    await session.redo();
    expect(isUnsaved(session.getState())).toBe(true);
    await session.undo();
    expect(isUnsaved(session.getState())).toBe(false);
    expect(gateway.methods()).toEqual([]);
  });

  it("follows the last save: undo after saving is unsaved, redo back to it is not", async () => {
    const { session } = openSession(undefined, {}, MANUAL_SAVE);
    await session.execute(moveFirstBlock(10));
    expect((await session.flush()).ok).toBe(true);
    expect(isUnsaved(session.getState())).toBe(false);

    await session.undo();
    expect(isUnsaved(session.getState())).toBe(true);
    await session.redo();
    expect(isUnsaved(session.getState())).toBe(false);
  });

  it("stays unsaved after a new command replaced the redo branch", async () => {
    const { session } = openSession(undefined, {}, MANUAL_SAVE);
    await session.execute(moveFirstBlock(10));
    await session.flush();
    await session.undo();
    await session.execute(moveFirstBlock(30));
    await session.undo();
    // Back at the state before the save, which is not what the files hold.
    expect(isUnsaved(session.getState())).toBe(true);
  });

  it("stays unsaved when a save did not finish", async () => {
    const { session, gateway } = openSession(undefined, {}, MANUAL_SAVE);
    await session.execute(moveFirstBlock(10));
    gateway.failOn("saveSheet", "ioError");
    expect((await session.flush()).ok).toBe(false);
    await session.undo();
    expect(isUnsaved(session.getState())).toBe(true);
  });

  it("stays unsaved when a change outside the history was made", async () => {
    const { session } = openSession(undefined, {}, MANUAL_SAVE);
    await session.runExclusive(async (scope) => {
      scope.markDirty({
        documentChanged: true,
        changedSheetIds: [],
        changedContentBlockIds: [],
      });
      return { ok: true, value: undefined };
    });
    await session.execute(moveFirstBlock(10));
    await session.undo();
    expect(isUnsaved(session.getState())).toBe(true);
  });
});
