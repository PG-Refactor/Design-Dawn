import { PASTE_OFFSET } from "../../config/canvas-config";
import { isTextBlockType } from "../../domain/block/block-type";
import { type DomainResult, ok } from "../../domain/shared/domain-result";
import type {
  BlockId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
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
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type {
  ClipboardBlock,
  ClipboardContent,
  ClipboardPort,
} from "./clipboard";

export interface CopyRequest {
  readonly state: DocumentData;
  readonly sheetId: SheetId;
  readonly blockIds: readonly BlockId[];
  readonly projectId: ProjectId;
  readonly gateway: PersistenceGateway;
}

interface CopiedGroup {
  readonly content: ClipboardContent;
  // Top-left of the group's bounding box in world coordinates.
  readonly origin: { readonly x: number; readonly y: number };
}

// Reads the CURRENT text of each block. Callers flush the session first so content the
// session has not saved yet is not missed. Targets come out back-to-front.
async function readGroup(
  request: CopyRequest,
): Promise<OperationResult<CopiedGroup>> {
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
  const origin = {
    x: Math.min(...targets.map((block) => block.position.x)),
    y: Math.min(...targets.map((block) => block.position.y)),
  };
  const blocks: ClipboardBlock[] = [];
  for (const block of targets) {
    const text = await request.gateway.readBlockContent(
      request.projectId,
      request.state.document.documentId,
      block.contentPath,
    );
    if (!text.ok) return failWith(text.error);
    blocks.push({
      blockType: block.blockType,
      size: block.size,
      offset: {
        x: block.position.x - origin.x,
        y: block.position.y - origin.y,
      },
      text: text.value,
    });
  }
  return operationOk({ content: { blocks }, origin });
}

export interface CopyBlocksRequest extends CopyRequest {
  readonly clipboard: ClipboardPort;
}

// Not a history step. On any failure the clipboard keeps its previous content.
export async function copyBlocks(
  request: CopyBlocksRequest,
): Promise<OperationResult<ClipboardContent>> {
  const group = await readGroup(request);
  if (!group.ok) return group;
  request.clipboard.write(group.value.content);
  return operationOk(group.value.content);
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

// Copy + paste in one step: the clipboard is not touched, and the copies land at
// PASTE_OFFSET from the originals as a single command.
export async function duplicateBlocks(
  request: DuplicateRequest,
): Promise<OperationResult<CreateBlocksCommand>> {
  const group = await readGroup(request);
  if (!group.ok) return group;
  const specs = pastedSpecs(
    group.value.content,
    {
      x: group.value.origin.x + PASTE_OFFSET.x,
      y: group.value.origin.y + PASTE_OFFSET.y,
    },
    request.idGenerator,
  );
  if (!specs.ok) return failWith(specs.error);
  return operationOk(createBlocksCommand(request.sheetId, specs.value));
}
