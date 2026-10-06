import { PASTE_OFFSET } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import { isTextBlockType } from "../../domain/block/block-type";
import { type DomainResult, ok } from "../../domain/shared/domain-result";
import type {
  BlockId,
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import { type Position, parsePosition } from "../../domain/shared/geometry";
import { findDuplicate } from "../../domain/shared/ordered-ids";
import type {
  AssetBlockType,
  BlockSpec,
  CreateBlocksCommand,
  TextBlockType,
} from "../commands/command";
import { type DocumentData, findSheet } from "../commands/document-data";
import { createBlocksCommand } from "../commands/file-backed-commands";
import type { IdGenerator } from "../id-generator";
import {
  failWith,
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type {
  ClipboardBlock,
  ClipboardContent,
  ClipboardPort,
} from "./clipboard";

export interface CopyRequest {
  // Application state of the document: block text comes from `contents` (the loaded
  // text, including edits not saved yet), never from a file. Callers load the sheet's
  // contents first.
  readonly state: DocumentData;
  readonly sheetId: SheetId;
  readonly blockIds: readonly BlockId[];
  // Image blocks whose asset failed `validateAssetBlocks`: left out of the group. The
  // caller already holds their errors and reports them.
  readonly assetErrors?: ReadonlyMap<BlockId, OperationError>;
}

interface CopiedGroup {
  readonly content: ClipboardContent;
  // Blocks that went into `content`, back-to-front.
  readonly copiedBlockIds: readonly BlockId[];
}

const NO_ASSET_ERRORS: ReadonlyMap<BlockId, OperationError> = new Map();

export interface AssetValidationRequest {
  readonly gateway: PersistenceGateway;
  readonly projectId: ProjectId;
  readonly state: DocumentData;
  readonly sheetId: SheetId;
  readonly blockIds: readonly BlockId[];
}

// Copy / cut / duplicate of image blocks first proves that each asset is still a valid
// image: copying a document-local asset into its own Document copies nothing in Rust and
// only validates the file. Returns the errors of the blocks that failed (empty when all
// are fine or there are no image blocks).
export async function validateAssetBlocks(
  request: AssetValidationRequest,
): Promise<ReadonlyMap<BlockId, OperationError>> {
  const sheet = findSheet(request.state, request.sheetId);
  if (!sheet.ok) return NO_ASSET_ERRORS;
  const wanted = new Set(request.blockIds);
  const { documentId } = request.state.document;
  const errors = new Map<BlockId, OperationError>();
  for (const block of sheet.value.blocks) {
    if (!wanted.has(block.blockId) || isTextBlockType(block.blockType))
      continue;
    const validated = await request.gateway.copyAssetToDocument(
      request.projectId,
      documentId,
      block.contentPath,
      documentId,
    );
    if (!validated.ok) errors.set(block.blockId, validated.error);
  }
  return errors;
}

// Targets come out back-to-front. Returns null content when no target has loaded text.
function readGroup(request: CopyRequest): OperationResult<{
  readonly group: CopiedGroup | null;
  // Targets without loaded text (failed or never read). They are left out, never copied
  // with a made-up text, and the caller reports them.
  readonly skippedBlockIds: readonly BlockId[];
}> {
  const sheet = findSheet(request.state, request.sheetId);
  if (!sheet.ok) return failWith(sheet.error);
  if (request.blockIds.length === 0) {
    return operationErr("entityNotFound", "no blocks to copy");
  }
  const duplicate = findDuplicate(request.blockIds);
  if (duplicate !== null) {
    return operationErr("duplicateId", `duplicate blockId: ${duplicate}`);
  }
  const wanted = new Set(request.blockIds);
  const targets = sheet.value.blocks.filter((block) =>
    wanted.has(block.blockId),
  );
  if (targets.length !== wanted.size) {
    return operationErr("entityNotFound", "a block to copy was not found");
  }
  const assetErrors = request.assetErrors ?? NO_ASSET_ERRORS;
  const hasUsableContent = (block: Block): boolean =>
    isTextBlockType(block.blockType)
      ? request.state.contents.has(block.blockId)
      : !assetErrors.has(block.blockId);
  const loaded = targets.filter(hasUsableContent);
  // Only text blocks can be "not loaded"; an image block with a failed asset is the
  // caller's to report.
  const skippedBlockIds = targets
    .filter(
      (block) =>
        isTextBlockType(block.blockType) &&
        !request.state.contents.has(block.blockId),
    )
    .map((block) => block.blockId);
  if (loaded.length === 0) return operationOk({ group: null, skippedBlockIds });
  const origin = {
    x: Math.min(...loaded.map((block) => block.position.x)),
    y: Math.min(...loaded.map((block) => block.position.y)),
  };
  const blocks: ClipboardBlock[] = loaded.map((block) => {
    const base = {
      size: block.size,
      offset: {
        x: block.position.x - origin.x,
        y: block.position.y - origin.y,
      },
    };
    // `isTextBlockType` is the run-time switch; the cast narrows the block type for the
    // two clipboard shapes it selects between.
    return isTextBlockType(block.blockType)
      ? {
          ...base,
          kind: "text" as const,
          blockType: block.blockType as TextBlockType,
          text: request.state.contents.get(block.blockId) ?? "",
        }
      : {
          ...base,
          kind: "asset" as const,
          blockType: block.blockType as AssetBlockType,
          contentPath: block.contentPath,
        };
  });
  return operationOk({
    group: {
      content: {
        source: {
          documentId: request.state.document.documentId,
          sheetId: request.sheetId,
          origin,
        },
        pasteCount: 0,
        blocks,
      },
      copiedBlockIds: loaded.map((block) => block.blockId),
    },
    skippedBlockIds,
  });
}

export interface CopyBlocksRequest extends CopyRequest {
  readonly clipboard: ClipboardPort;
}

export interface CopyOutcome {
  // The blocks that were copied (empty when none had loaded text), back-to-front.
  readonly copiedBlockIds: readonly BlockId[];
  readonly skippedBlockIds: readonly BlockId[];
}

// Not a history step and no I/O. The clipboard keeps its previous content on any
// failure and when no target could be copied.
export function copyBlocks(
  request: CopyBlocksRequest,
): OperationResult<CopyOutcome> {
  const read = readGroup(request);
  if (!read.ok) return read;
  const { group, skippedBlockIds } = read.value;
  if (group === null) {
    return operationOk({ copiedBlockIds: [], skippedBlockIds });
  }
  request.clipboard.write(group.content);
  return operationOk({
    copiedBlockIds: group.copiedBlockIds,
    skippedBlockIds,
  });
}

export interface PasteRequest {
  readonly content: ClipboardContent;
  readonly sheetId: SheetId;
  // Where the top-left of the pasted group's bounding box goes.
  readonly target: Position;
  readonly idGenerator: IdGenerator;
}

function pastedSpecs(
  content: ClipboardContent,
  target: { readonly x: number; readonly y: number },
  idGenerator: IdGenerator,
): DomainResult<readonly BlockSpec[]> {
  const specs: BlockSpec[] = [];
  for (const block of content.blocks) {
    const position = parsePosition({
      x: target.x + block.offset.x,
      y: target.y + block.offset.y,
    });
    if (!position.ok) return position;
    const placed = {
      blockId: idGenerator.blockId(),
      position: position.value,
      size: block.size,
    };
    specs.push(
      block.kind === "text"
        ? { ...placed, blockType: block.blockType, text: block.text }
        : {
            ...placed,
            blockType: block.blockType,
            contentPath: block.contentPath,
          },
    );
  }
  return ok(specs);
}

// New ids, new content files (created when the command runs), appended on top in the
// clipboard's back-to-front order. One command for the whole group.
export function pasteBlocksCommand(
  request: PasteRequest,
): OperationResult<CreateBlocksCommand> {
  const specs = pastedSpecs(
    request.content,
    request.target,
    request.idGenerator,
  );
  if (!specs.ok) return failWith(specs.error);
  return operationOk(createBlocksCommand(request.sheetId, specs.value));
}

export interface PasteAssetsResolution {
  // The content to paste: asset blocks point at files inside the target Document, and
  // blocks whose asset could not be copied are gone.
  readonly content: ClipboardContent;
  // One error per block that was left out.
  readonly failures: readonly OperationError[];
}

export interface PasteAssetsRequest {
  readonly gateway: PersistenceGateway;
  readonly projectId: ProjectId;
  readonly content: ClipboardContent;
  readonly targetDocumentId: DocumentId;
}

// Pasting into the Document the blocks came from reuses the asset files (nothing is
// copied). Another Document needs its own copy: each asset is copied BEFORE the create
// command (Rust keeps the name, `-2` on collision) and the block uses the returned path.
// Copies made before a later failure stay (an unused asset is harmless; a block pointing
// at a missing file is not).
export async function resolvePasteAssets(
  request: PasteAssetsRequest,
): Promise<PasteAssetsResolution> {
  const { content, targetDocumentId } = request;
  if (content.source.documentId === targetDocumentId) {
    return { content, failures: [] };
  }
  const blocks: ClipboardBlock[] = [];
  const failures: OperationError[] = [];
  for (const block of content.blocks) {
    if (block.kind === "text") {
      blocks.push(block);
      continue;
    }
    const copied = await request.gateway.copyAssetToDocument(
      request.projectId,
      content.source.documentId,
      block.contentPath,
      targetDocumentId,
    );
    if (copied.ok) {
      blocks.push({ ...block, contentPath: copied.value.contentPath });
    } else {
      failures.push(copied.error);
    }
  }
  return { content: { ...content, blocks }, failures };
}

export interface DuplicateRequest extends CopyRequest {
  readonly idGenerator: IdGenerator;
}

export interface DuplicateOutcome {
  // null when no target had loaded text: nothing is created then.
  readonly command: CreateBlocksCommand | null;
  readonly skippedBlockIds: readonly BlockId[];
}

// Copy + paste in one step: the clipboard is not touched, and the copies land at
// PASTE_OFFSET from the originals as a single command.
export function duplicateBlocks(
  request: DuplicateRequest,
): OperationResult<DuplicateOutcome> {
  const read = readGroup(request);
  if (!read.ok) return read;
  const { group, skippedBlockIds } = read.value;
  if (group === null) return operationOk({ command: null, skippedBlockIds });
  const { origin } = group.content.source;
  const specs = pastedSpecs(
    group.content,
    { x: origin.x + PASTE_OFFSET.x, y: origin.y + PASTE_OFFSET.y },
    request.idGenerator,
  );
  if (!specs.ok) return failWith(specs.error);
  return operationOk({
    command: createBlocksCommand(request.sheetId, specs.value),
    skippedBlockIds,
  });
}
