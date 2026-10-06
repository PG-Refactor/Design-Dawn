import type { BlockId, SheetId } from "../../domain/shared/entity-id";
import type {
  BlockSpec,
  CreateBlocksCommand,
  DeleteBlocksCommand,
} from "./command";
import { COMMAND_KINDS } from "./command-kind";

export function createBlocksCommand(
  sheetId: SheetId,
  specs: readonly BlockSpec[],
): CreateBlocksCommand {
  return {
    category: "fileBacked",
    kind: COMMAND_KINDS.createBlocks,
    sheetId,
    specs,
  };
}

export function deleteBlocksCommand(
  sheetId: SheetId,
  blockIds: readonly BlockId[],
): DeleteBlocksCommand {
  return {
    category: "fileBacked",
    kind: COMMAND_KINDS.deleteBlocks,
    sheetId,
    blockIds,
  };
}
