import { PASTE_OFFSET } from "../../config/canvas-config";
import { isTextBlockType } from "../../domain/block/block-type";
import { type DomainResult, ok } from "../../domain/shared/domain-result";
import type { BlockId, SheetId } from "../../domain/shared/entity-id";
import { type Position, parsePosition } from "../../domain/shared/geometry";
import { findDuplicate } from "../../domain/shared/ordered-ids";
import type { BlockSpec, CreateBlocksCommand } from "../commands/command";
import { type DocumentData, findSheet } from "../commands/document-data";
import { createBlocksCommand } from "../commands/file-backed-commands";
import type { IdGenerator } from "../id-generator";
import {
  failWith,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
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
}

interface CopiedGroup {
  readonly content: ClipboardContent;
  // Blocks that went into `content`, back-to-front.
  readonly copiedBlockIds: readonly BlockId[];
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
  const unsupported = targets.find(
    (block) => !isTextBlockType(block.blockType),
  );
  if (unsupported !== undefined) {
    return operationErr(
      "unsupportedBlockType",
      `blocks of type ${unsupported.blockType} cannot be copied yet`,
    );
  }
  const loaded = targets.filter((block) =>
    request.state.contents.has(block.blockId),
  );
  const skippedBlockIds = targets
    .filter((block) => !request.state.contents.has(block.blockId))
    .map((block) => block.blockId);
  if (loaded.length === 0) return operationOk({ group: null, skippedBlockIds });
  const origin = {
    x: Math.min(...loaded.map((block) => block.position.x)),
    y: Math.min(...loaded.map((block) => block.position.y)),
  };
  const blocks: ClipboardBlock[] = loaded.map((block) => ({
    blockType: block.blockType,
    size: block.size,
    offset: {
      x: block.position.x - origin.x,
      y: block.position.y - origin.y,
    },
    text: request.state.contents.get(block.blockId) ?? "",
  }));
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
    specs.push({
      blockId: idGenerator.blockId(),
      blockType: block.blockType,
      position: position.value,
      size: block.size,
      text: block.text,
    });
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
