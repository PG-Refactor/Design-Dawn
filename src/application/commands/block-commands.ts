import type { Block } from "../../domain/block/block";
import { type DomainResult, err, ok } from "../../domain/shared/domain-result";
import type { BlockId, SheetId } from "../../domain/shared/entity-id";
import type { Position, Size } from "../../domain/shared/geometry";
import {
  type BlockFrameUpdate,
  bringBlocksForward,
  bringBlocksToFront,
  reorderBlocks,
  type Sheet,
  sendBlocksBackward,
  sendBlocksToBack,
  setBlockFrames,
} from "../../domain/sheet/sheet";
import type { MetadataCommand } from "./command";
import { COMMAND_KINDS, type CommandKind } from "./command-kind";
import type { MetadataCommandSnapshot } from "./command-snapshot";
import { commandNotApplied, updateSheet } from "./document-data";

export interface BlockMove {
  readonly blockId: BlockId;
  readonly position: Position;
}

export interface BlockFrame {
  readonly blockId: BlockId;
  readonly position: Position;
  readonly size: Size;
}

export type ReorderDirection = "forward" | "backward" | "toFront" | "toBack";

const REORDER_OPERATIONS: Readonly<
  Record<
    ReorderDirection,
    (sheet: Sheet, blockIds: readonly BlockId[]) => DomainResult<Sheet>
  >
> = {
  forward: bringBlocksForward,
  backward: sendBlocksBackward,
  toFront: bringBlocksToFront,
  toBack: sendBlocksToBack,
};

function frameOf(block: Block): BlockFrame {
  return { blockId: block.blockId, position: block.position, size: block.size };
}

// Move and resize share this: `resolve` turns the request into frames from the current
// sheet; the frames before the first successful change are kept so `revert` restores them
// exactly (position and size), which is sound because history is undone in LIFO order.
function frameCommand(
  kind: CommandKind,
  sheetId: SheetId,
  resolve: (sheet: Sheet) => DomainResult<readonly BlockFrameUpdate[]>,
  snapshotOf: (
    previousFrames: readonly BlockFrame[] | null,
  ) => MetadataCommandSnapshot,
  restored: readonly BlockFrame[] | null,
): MetadataCommand {
  let previousFrames: readonly BlockFrame[] | null = restored;
  return {
    category: "metadata",
    kind,
    snapshot: () => snapshotOf(previousFrames),
    apply: (state) =>
      updateSheet(state, sheetId, (sheet) => {
        const updates = resolve(sheet);
        if (!updates.ok) return updates;
        const next = setBlockFrames(sheet, updates.value);
        if (next.ok && next.value !== sheet && previousFrames === null) {
          previousFrames = capturePreviousFrames(sheet, updates.value);
        }
        return next;
      }),
    revert: (state) =>
      updateSheet(state, sheetId, (sheet) =>
        previousFrames === null
          ? commandNotApplied()
          : setBlockFrames(sheet, previousFrames),
      ),
  };
}

function capturePreviousFrames(
  sheet: Sheet,
  updates: readonly BlockFrameUpdate[],
): readonly BlockFrame[] {
  const ids = new Set(updates.map((update) => update.blockId));
  return sheet.blocks.filter((block) => ids.has(block.blockId)).map(frameOf);
}

// `restored`: what an earlier run captured (a command rebuilt from its snapshot).
export function moveBlocksCommand(
  sheetId: SheetId,
  moves: readonly BlockMove[],
  restored: readonly BlockFrame[] | null = null,
): MetadataCommand {
  return frameCommand(
    COMMAND_KINDS.moveBlocks,
    sheetId,
    (sheet) => {
      const updates: BlockFrameUpdate[] = [];
      for (const move of moves) {
        const block = sheet.blocks.find(
          (candidate) => candidate.blockId === move.blockId,
        );
        if (block === undefined) {
          return err("entityNotFound", `block not found: ${move.blockId}`);
        }
        updates.push({ ...move, size: block.size });
      }
      return ok(updates);
    },
    (previousFrames) => ({
      kind: COMMAND_KINDS.moveBlocks,
      sheetId,
      moves,
      previousFrames,
    }),
    restored,
  );
}

export function resizeBlocksCommand(
  sheetId: SheetId,
  frames: readonly BlockFrame[],
  restored: readonly BlockFrame[] | null = null,
): MetadataCommand {
  return frameCommand(
    COMMAND_KINDS.resizeBlocks,
    sheetId,
    () => ok(frames),
    (previousFrames) => ({
      kind: COMMAND_KINDS.resizeBlocks,
      sheetId,
      frames,
      previousFrames,
    }),
    restored,
  );
}

export function reorderBlocksCommand(
  sheetId: SheetId,
  blockIds: readonly BlockId[],
  direction: ReorderDirection,
  restored: readonly BlockId[] | null = null,
): MetadataCommand {
  let previousOrder: readonly BlockId[] | null = restored;
  return {
    category: "metadata",
    kind: COMMAND_KINDS.reorderBlocks,
    snapshot: () => ({
      kind: COMMAND_KINDS.reorderBlocks,
      sheetId,
      blockIds,
      direction,
      previousOrder,
    }),
    apply: (state) =>
      updateSheet(state, sheetId, (sheet) => {
        const next = REORDER_OPERATIONS[direction](sheet, blockIds);
        if (next.ok && next.value !== sheet && previousOrder === null) {
          previousOrder = sheet.blocks.map((block) => block.blockId);
        }
        return next;
      }),
    revert: (state) =>
      updateSheet(state, sheetId, (sheet) =>
        previousOrder === null
          ? commandNotApplied()
          : reorderBlocks(sheet, previousOrder),
      ),
  };
}
