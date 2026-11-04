// Metadata commands as plain data. A history entry has to move with its document when the
// document moves to another window (a separate JavaScript world), and a command object
// holds closures; its snapshot holds the arguments and what the first `apply` captured,
// and `commandFromSnapshot` rebuilds an equivalent command.

import type { Caption } from "../../domain/block/caption";
import type { DisplayName } from "../../domain/shared/display-name";
import type { BlockId, SheetId } from "../../domain/shared/entity-id";
import {
  type BlockFrame,
  type BlockMove,
  type CaptionRestore,
  moveBlocksCommand,
  type ReorderDirection,
  reorderBlocksCommand,
  resizeBlocksCommand,
  setBlockCaptionCommand,
} from "./block-commands";
import type { MetadataCommand } from "./command";
import { COMMAND_KINDS } from "./command-kind";
import { editBlockContentCommand } from "./content-commands";
import {
  moveSheetCommand,
  renameDocumentCommand,
  renameSheetCommand,
} from "./naming-commands";

// Where a moved sheet goes back to: before this sheet (null = the end).
export interface MoveSheetRestore {
  readonly sheetId: SheetId | null;
}

export type MetadataCommandSnapshot =
  | {
      readonly kind: typeof COMMAND_KINDS.moveBlocks;
      readonly sheetId: SheetId;
      readonly moves: readonly BlockMove[];
      readonly previousFrames: readonly BlockFrame[] | null;
    }
  | {
      readonly kind: typeof COMMAND_KINDS.resizeBlocks;
      readonly sheetId: SheetId;
      readonly frames: readonly BlockFrame[];
      readonly previousFrames: readonly BlockFrame[] | null;
    }
  | {
      readonly kind: typeof COMMAND_KINDS.reorderBlocks;
      readonly sheetId: SheetId;
      readonly blockIds: readonly BlockId[];
      readonly direction: ReorderDirection;
      readonly previousOrder: readonly BlockId[] | null;
    }
  | {
      readonly kind: typeof COMMAND_KINDS.renameSheet;
      readonly sheetId: SheetId;
      readonly name: DisplayName;
      readonly previousName: DisplayName | null;
    }
  | {
      readonly kind: typeof COMMAND_KINDS.renameDocument;
      readonly name: DisplayName;
      readonly previousName: DisplayName | null;
    }
  | {
      readonly kind: typeof COMMAND_KINDS.moveSheet;
      readonly sheetId: SheetId;
      readonly beforeSheetId: SheetId | null;
      readonly restoreBefore: MoveSheetRestore | null;
    }
  | {
      readonly kind: typeof COMMAND_KINDS.setBlockCaption;
      readonly sheetId: SheetId;
      readonly blockId: BlockId;
      readonly caption: Caption | null;
      readonly previous: CaptionRestore | null;
    }
  | {
      readonly kind: typeof COMMAND_KINDS.editBlockContent;
      readonly sheetId: SheetId;
      readonly blockId: BlockId;
      readonly text: string;
      readonly previousText: string | null;
    };

export function commandFromSnapshot(
  snapshot: MetadataCommandSnapshot,
): MetadataCommand {
  switch (snapshot.kind) {
    case COMMAND_KINDS.moveBlocks:
      return moveBlocksCommand(
        snapshot.sheetId,
        snapshot.moves,
        snapshot.previousFrames,
      );
    case COMMAND_KINDS.resizeBlocks:
      return resizeBlocksCommand(
        snapshot.sheetId,
        snapshot.frames,
        snapshot.previousFrames,
      );
    case COMMAND_KINDS.reorderBlocks:
      return reorderBlocksCommand(
        snapshot.sheetId,
        snapshot.blockIds,
        snapshot.direction,
        snapshot.previousOrder,
      );
    case COMMAND_KINDS.renameSheet:
      return renameSheetCommand(
        snapshot.sheetId,
        snapshot.name,
        snapshot.previousName,
      );
    case COMMAND_KINDS.renameDocument:
      return renameDocumentCommand(snapshot.name, snapshot.previousName);
    case COMMAND_KINDS.moveSheet:
      return moveSheetCommand(
        snapshot.sheetId,
        snapshot.beforeSheetId,
        snapshot.restoreBefore,
      );
    case COMMAND_KINDS.setBlockCaption:
      return setBlockCaptionCommand(
        snapshot.sheetId,
        snapshot.blockId,
        snapshot.caption,
        snapshot.previous,
      );
    case COMMAND_KINDS.editBlockContent:
      return editBlockContentCommand(
        {
          sheetId: snapshot.sheetId,
          blockId: snapshot.blockId,
          text: snapshot.text,
        },
        snapshot.previousText,
      );
  }
}
