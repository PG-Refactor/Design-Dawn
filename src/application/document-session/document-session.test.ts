import { describe, expect, it } from "vitest";
import { err } from "../../domain/shared/domain-result";
import { type BlockId, parseSheetId } from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import {
  moveBlocksCommand,
  type ReorderDirection,
  reorderBlocksCommand,
  resizeBlocksCommand,
} from "../commands/block-commands";
import type { MetadataCommand } from "../commands/command";
import {
  moveSheetCommand,
  renameDocumentCommand,
  renameSheetCommand,
} from "../commands/naming-commands";
import type { DocumentSessionState } from "../state/application-state";
import {
  blockIdOf,
  displayName,
  OTHER_SHEET_ID,
  position,
  SHEET_ID,
  size,
} from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";

const move = (counter: number, x: number, y: number) => ({
  blockId: blockIdOf(counter),
  position: position(x, y),
});

function orderOf(state: DocumentSessionState): BlockId[] | undefined {
  return state.sheets.get(SHEET_ID)?.blocks.map((block) => block.blockId);
}

const UNKNOWN_SHEET_ID = unwrap(
  parseSheetId("01928f3a-7d8e-7f90-b123-456789abcd99"),
);

const COMMANDS: readonly [string, () => MetadataCommand][] = [
  [
    "moveBlocks (several blocks)",
    () => moveBlocksCommand(SHEET_ID, [move(1, 5, 6), move(3, -7, 8)]),
  ],
  [
    "resizeBlocks (several blocks)",
    () =>
      resizeBlocksCommand(SHEET_ID, [
        { blockId: blockIdOf(1), position: position(1, 1), size: size(11, 12) },
        { blockId: blockIdOf(2), position: position(2, 2), size: size(21, 22) },
      ]),
  ],
  [
    "reorder toFront",
    () => reorderBlocksCommand(SHEET_ID, [blockIdOf(1)], "toFront"),
  ],
  [
    "reorder toBack",
    () => reorderBlocksCommand(SHEET_ID, [blockIdOf(3)], "toBack"),
  ],
  [
    "reorder forward",
    () =>
      reorderBlocksCommand(SHEET_ID, [blockIdOf(1), blockIdOf(2)], "forward"),
  ],
  [
    "reorder backward",
    () =>
      reorderBlocksCommand(SHEET_ID, [blockIdOf(2), blockIdOf(3)], "backward"),
  ],
  ["renameSheet", () => renameSheetCommand(SHEET_ID, displayName("Renamed"))],
  ["renameDocument", () => renameDocumentCommand(displayName("Renamed doc"))],
  ["moveSheet", () => moveSheetCommand(SHEET_ID, null)],
];

describe("history: do, undo, redo", () => {
  it.each(COMMANDS)("%s restores deep-equal state", async (_name, create) => {
    const { session } = openSession();
    const before = session.getState();
    expect((await session.execute(create())).ok).toBe(true);
    const after = session.getState();
    expect(after.history.canUndo).toBe(true);
    expect(
      after.sheets !== before.sheets || after.document !== before.document,
    ).toBe(true);

    expect((await session.undo()).ok).toBe(true);
    expect(session.getState().sheets).toEqual(before.sheets);
    expect(session.getState().document).toEqual(before.document);
    expect(session.getState().history.canRedo).toBe(true);

    expect((await session.redo()).ok).toBe(true);
    expect(session.getState().sheets).toEqual(after.sheets);
    expect(session.getState().document).toEqual(after.document);
    expect(session.getState().history.canRedo).toBe(false);
  });

  it("labels the next undo and redo step with the command kind", async () => {
    const { session } = openSession();
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 5, 5)]));
    await session.execute(renameSheetCommand(SHEET_ID, displayName("X")));
    expect(session.getState().history).toMatchObject({
      undoLabel: "renameSheet",
      redoLabel: null,
    });
    await session.undo();
    expect(session.getState().history).toMatchObject({
      undoLabel: "moveBlocks",
      redoLabel: "renameSheet",
    });
  });

  it("restores exact values when a move and a resize of one block are undone in order", async () => {
    const { session } = openSession();
    const initial = session.getState();
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 50, 60)]));
    const afterMove = session.getState();
    await session.execute(
      resizeBlocksCommand(SHEET_ID, [
        {
          blockId: blockIdOf(1),
          position: position(40, 60),
          size: size(300, 200),
        },
      ]),
    );
    const afterResize = session.getState();
    await session.undo();
    expect(session.getState().sheets).toEqual(afterMove.sheets);
    await session.undo();
    expect(session.getState().sheets).toEqual(initial.sheets);
    await session.redo();
    await session.redo();
    expect(session.getState().sheets).toEqual(afterResize.sheets);
  });

  it("restores the full previous block order for z-order commands", async () => {
    const { session } = openSession();
    const initial = orderOf(session.getState());
    await session.execute(
      reorderBlocksCommand(SHEET_ID, [blockIdOf(1)], "toFront"),
    );
    expect(orderOf(session.getState())).toEqual([
      blockIdOf(2),
      blockIdOf(3),
      blockIdOf(1),
    ]);
    await session.execute(
      reorderBlocksCommand(SHEET_ID, [blockIdOf(3)], "toBack"),
    );
    await session.undo();
    await session.undo();
    expect(orderOf(session.getState())).toEqual(initial);
  });

  it("restores sheet order after moving a sheet", async () => {
    const { session } = openSession();
    await session.execute(moveSheetCommand(SHEET_ID, null));
    expect(session.getState().document.sheetOrder).toEqual([
      OTHER_SHEET_ID,
      SHEET_ID,
    ]);
    await session.undo();
    expect(session.getState().document.sheetOrder).toEqual([
      SHEET_ID,
      OTHER_SHEET_ID,
    ]);
  });

  it("clears redo when a new command runs", async () => {
    const { session } = openSession();
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 5, 5)]));
    await session.undo();
    expect(session.getState().history.canRedo).toBe(true);
    await session.execute(moveBlocksCommand(SHEET_ID, [move(2, 9, 9)]));
    expect(session.getState().history.canRedo).toBe(false);
    expect((await session.redo()).ok).toBe(true);
    expect(session.getState().history.canUndo).toBe(true);
  });

  it("drops the oldest steps beyond the limit", async () => {
    const { session } = openSession(undefined, { undoHistoryLimit: 2 });
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 1, 1)]));
    const afterFirst = session.getState();
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 2, 2)]));
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 3, 3)]));
    await session.undo();
    await session.undo();
    expect(session.getState().history.canUndo).toBe(false);
    expect(session.getState().sheets).toEqual(afterFirst.sheets);
  });

  it("does not push commands that change nothing", async () => {
    const { session, scheduler } = openSession();
    const samePosition = { blockId: blockIdOf(1), position: position(0, 0) };
    await session.execute(moveBlocksCommand(SHEET_ID, [samePosition]));
    await session.execute(renameSheetCommand(SHEET_ID, displayName("Sheet")));
    await session.execute(renameDocumentCommand(displayName("Document")));
    await session.execute(
      reorderBlocksCommand(SHEET_ID, [blockIdOf(3)], "toFront"),
    );
    await session.execute(moveSheetCommand(SHEET_ID, OTHER_SHEET_ID));
    const state = session.getState();
    expect(state.history.canUndo).toBe(false);
    expect(state.save.dirtySheetIds.size).toBe(0);
    expect(state.save.documentDirty).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("clearHistory drops both stacks", async () => {
    const { session } = openSession();
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 5, 5)]));
    await session.execute(moveBlocksCommand(SHEET_ID, [move(2, 5, 5)]));
    await session.undo();
    session.clearHistory();
    expect(session.getState().history).toEqual({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
    });
  });

  it("treats undo and redo with empty history as a harmless success", async () => {
    const { session, gateway, states } = openSession();
    const before = session.getState();
    expect((await session.undo()).ok).toBe(true);
    expect((await session.redo()).ok).toBe(true);
    expect(session.getState().sheets).toBe(before.sheets);
    expect(gateway.calls).toEqual([]);
    expect(states).toEqual([]);
  });
});

describe("failed commands", () => {
  it("leave state and history untouched on a domain error", async () => {
    const { session } = openSession();
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 5, 5)]));
    const before = session.getState();
    const result = await session.execute(
      moveBlocksCommand(SHEET_ID, [move(2, 1, 1), move(99, 1, 1)]),
    );
    expect(!result.ok && result.error.kind).toBe("entityNotFound");
    const unknownSheet = await session.execute(
      renameSheetCommand(UNKNOWN_SHEET_ID, displayName("X")),
    );
    expect(!unknownSheet.ok && unknownSheet.error.kind).toBe("entityNotFound");
    const after = session.getState();
    expect(after.sheets).toBe(before.sheets);
    expect(after.document).toBe(before.document);
    expect(after.history).toEqual(before.history);
    expect(after.save.dirtySheetIds).toEqual(before.save.dirtySheetIds);
  });

  it("leave state and history untouched when undo fails", async () => {
    const { session } = openSession();
    const failingRevert: MetadataCommand = {
      category: "metadata",
      kind: "moveBlocks",
      apply: (state) =>
        moveBlocksCommand(SHEET_ID, [move(1, 9, 9)]).apply(state),
      revert: () => err("entityNotFound", "cannot revert"),
    };
    await session.execute(failingRevert);
    const before = session.getState();
    const result = await session.undo();
    expect(!result.ok && result.error.kind).toBe("entityNotFound");
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history).toEqual(before.history);
  });

  it("leave state and history untouched when redo fails", async () => {
    const { session } = openSession();
    let applyCount = 0;
    const real = moveBlocksCommand(SHEET_ID, [move(1, 9, 9)]);
    const failingRedo: MetadataCommand = {
      category: "metadata",
      kind: "moveBlocks",
      apply: (state) => {
        applyCount += 1;
        return applyCount === 1 ? real.apply(state) : err("duplicateId", "no");
      },
      revert: (state) => real.revert(state),
    };
    await session.execute(failingRedo);
    await session.undo();
    const before = session.getState();
    const result = await session.redo();
    expect(!result.ok && result.error.kind).toBe("duplicateId");
    expect(session.getState().sheets).toBe(before.sheets);
    expect(session.getState().history).toEqual(before.history);
  });
});

describe("state publication", () => {
  it("publishes the state through onStateChange and getState", async () => {
    const { session, states } = openSession();
    await session.execute(moveBlocksCommand(SHEET_ID, [move(1, 5, 5)]));
    expect(states.length).toBeGreaterThan(0);
    expect(states.at(-1)).toBe(session.getState());
    expect(session.getState().save.dirtySheetIds.has(SHEET_ID)).toBe(true);
  });

  it("rejects operations after dispose", async () => {
    const { session } = openSession();
    await session.dispose();
    const result = await session.execute(
      moveBlocksCommand(SHEET_ID, [move(1, 5, 5)]),
    );
    expect(result.ok).toBe(false);
  });
});

describe("reorder directions", () => {
  const directions: readonly ReorderDirection[] = [
    "forward",
    "backward",
    "toFront",
    "toBack",
  ];
  it.each(directions)("%s is exposed as one command", async (direction) => {
    const { session } = openSession();
    await session.execute(
      reorderBlocksCommand(SHEET_ID, [blockIdOf(2)], direction),
    );
    expect(session.getState().history.undoLabel).toBe("reorderBlocks");
  });
});
