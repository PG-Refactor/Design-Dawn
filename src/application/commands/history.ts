import type { SheetId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import type { OperationResult } from "../ports/operation-error";
import { operationOk } from "../ports/operation-error";
import {
  type CapturedBlock,
  removeBlocksWithContent,
  restoreBlocksWithContent,
  type SequenceContext,
  type SequenceSuccess,
} from "./block-file-sequences";
import type { MetadataCommand } from "./command";
import type { CommandKind } from "./command-kind";

// What the undo / redo stacks hold. A file-backed entry is not a command object: after
// the first run it is the data needed to move the same blocks in and out of the sheet,
// and `present` says which side they are on now.
export type HistoryEntry =
  | { readonly type: "metadata"; readonly command: MetadataCommand }
  | {
      readonly type: "fileBacked";
      readonly label: CommandKind;
      readonly sheetId: SheetId;
      readonly blocks: readonly CapturedBlock[];
      readonly present: boolean;
    };

export type FileBackedEntry = Extract<HistoryEntry, { type: "fileBacked" }>;

export function entryLabel(entry: HistoryEntry): CommandKind {
  return entry.type === "metadata" ? entry.command.kind : entry.label;
}

// Drops the oldest entries beyond `limit`.
export function pushWithLimit(
  stack: readonly HistoryEntry[],
  entry: HistoryEntry,
  limit: number,
): readonly HistoryEntry[] {
  const next = [...stack, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

// Undo and redo of a file-backed entry are the same toggle: blocks that are present are
// removed (content deleted after metadata), blocks that are absent are restored (content
// recreated before metadata). The ordering itself lives in block-file-sequences.ts.
export async function toggleFileBackedEntry(
  ctx: SequenceContext,
  sheet: Sheet,
  entry: FileBackedEntry,
): Promise<OperationResult<{ entry: FileBackedEntry } & SequenceSuccess>> {
  const outcome = entry.present
    ? await removeBlocksWithContent(
        ctx,
        sheet,
        entry.blocks.map((captured) => captured.block.blockId),
      )
    : await restoreBlocksWithContent(ctx, sheet, entry.blocks);
  if (!outcome.ok) return outcome;
  return operationOk({
    ...outcome.value,
    entry: {
      ...entry,
      // Removal re-reads text and indexes; restore keeps what it was given.
      blocks: entry.present ? outcome.value.captured : entry.blocks,
      present: !entry.present,
    },
  });
}
