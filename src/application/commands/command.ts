import { type BlockType, isTextBlockType } from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import type { BlockId, SheetId } from "../../domain/shared/entity-id";
import type { Position, Size } from "../../domain/shared/geometry";
import type { OperationResult } from "../ports/operation-error";
import type { CommandKind } from "./command-kind";
import type { DocumentData } from "./document-data";

// Pure commands: they change only in-memory Domain values. The session marks what
// changed as dirty and auto-save persists it. An instance is single-use per user
// operation: it captures what `revert` needs the first time `apply` succeeds, and the
// same instance is then used for redo.
export interface MetadataCommand {
  readonly category: "metadata";
  readonly kind: CommandKind;
  // Returns the same `DocumentData` reference when the command changes nothing.
  // `OperationResult`, not `DomainResult`: editing text that was never loaded is the
  // session-level `notWritable`, which is not a Domain error. Domain failures
  // (`DomainResult`) are assignable to it.
  apply(state: DocumentData): OperationResult<DocumentData>;
  revert(state: DocumentData): OperationResult<DocumentData>;
}

// Block types whose body is an imported asset instead of a text file (the domain's
// `BLOCK_TYPE_DEFINITIONS` is the source of truth; `isTextBlockType` decides at run time).
export type AssetBlockType = Extract<BlockType, "image">;
export type TextBlockType = Exclude<BlockType, AssetBlockType>;

interface BlockSpecBase {
  readonly blockId: BlockId;
  readonly position: Position;
  readonly size: Size;
}

// A block whose text file is created when the command runs.
export interface TextBlockSpec extends BlockSpecBase {
  readonly blockType: TextBlockType;
  readonly text: string;
}

// A block that references an asset that already exists: assets are created by the import /
// copy BEFORE the command, so the command never creates or deletes a file for it.
export interface AssetBlockSpec extends BlockSpecBase {
  readonly blockType: AssetBlockType;
  readonly contentPath: ContentPath;
}

export type BlockSpec = TextBlockSpec | AssetBlockSpec;

export function isAssetBlockSpec(spec: BlockSpec): spec is AssetBlockSpec {
  return !isTextBlockType(spec.blockType);
}

// File-backed commands only describe the operation. They never call persistence
// themselves: `block-file-sequences.ts` is the single module that orders content and
// metadata writes, and the session drives it.
export interface CreateBlocksCommand {
  readonly category: "fileBacked";
  readonly kind: "createBlocks";
  readonly sheetId: SheetId;
  readonly specs: readonly BlockSpec[];
}

export interface DeleteBlocksCommand {
  readonly category: "fileBacked";
  readonly kind: "deleteBlocks";
  readonly sheetId: SheetId;
  readonly blockIds: readonly BlockId[];
}

export type FileBackedCommand = CreateBlocksCommand | DeleteBlocksCommand;

export type ApplicationCommand = MetadataCommand | FileBackedCommand;
