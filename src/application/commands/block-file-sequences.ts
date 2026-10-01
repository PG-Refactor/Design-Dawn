// The ONE place that orders block content files against sheet metadata
// (docs/architecture.md §9.4, file-format.md §9):
//
//   add     content file(s) first, then sheet metadata
//   remove  sheet metadata first, then content file(s)
//   restore content file(s) first, then sheet metadata
//
// Commands, the session and the UI must not call content gateway methods themselves.
// Every sequence flushes pending metadata saves first, validates against the in-memory
// sheet before touching any file, and on failure leaves the sheet value to the caller
// unchanged after undoing only the files THIS attempt created or restored.

import type { Block } from "../../domain/block/block";
import { isTextBlockType } from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import type {
  BlockId,
  DocumentId,
  ProjectId,
} from "../../domain/shared/entity-id";
import { findDuplicate } from "../../domain/shared/ordered-ids";
import {
  addBlocks,
  insertBlocksAt,
  removeBlocks,
  type Sheet,
} from "../../domain/sheet/sheet";
import {
  OPERATION_WARNING_KINDS,
  type OperationWarning,
} from "../operation-warning";
import {
  failWith,
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { BlockSpec } from "./command";

// A block together with what is needed to bring it back: its z-order index and its text.
export interface CapturedBlock {
  readonly block: Block;
  readonly index: number;
  readonly text: string;
}

export interface SequenceContext {
  readonly projectId: ProjectId;
  readonly documentId: DocumentId;
  readonly gateway: PersistenceGateway;
  // Saves pending metadata changes; a failure aborts the sequence before any file work.
  flushPending(): Promise<OperationResult<void>>;
}

export interface SequenceSuccess {
  readonly sheet: Sheet;
  readonly captured: readonly CapturedBlock[];
  readonly warnings: readonly OperationWarning[];
}

type SequenceResult = Promise<OperationResult<SequenceSuccess>>;

function unchanged(sheet: Sheet): OperationResult<SequenceSuccess> {
  return operationOk({ sheet, captured: [], warnings: [] });
}

function unsupportedType(block: { readonly blockType: string }) {
  return operationErr<SequenceSuccess>(
    "unsupportedBlockType",
    `blocks of type ${block.blockType} have no text content file`,
  );
}

async function deleteContentFiles(
  ctx: SequenceContext,
  contentPaths: readonly ContentPath[],
): Promise<readonly { path: ContentPath; error: OperationError }[]> {
  const failures: { path: ContentPath; error: OperationError }[] = [];
  for (const path of contentPaths) {
    const deleted = await ctx.gateway.deleteBlockContent(
      ctx.projectId,
      ctx.documentId,
      path,
    );
    if (!deleted.ok) failures.push({ path, error: deleted.error });
  }
  return failures;
}

// Best-effort rollback; the original error stays the reported kind and the detail says
// which files could not be cleaned up.
async function failAfterRollback(
  ctx: SequenceContext,
  error: OperationError,
  contentPaths: readonly ContentPath[],
): SequenceResult {
  const failures = await deleteContentFiles(ctx, contentPaths);
  if (failures.length === 0) return failWith(error);
  const leftovers = failures
    .map(({ path, error: cause }) => `${path} (${cause.kind})`)
    .join(", ");
  return failWith({
    kind: error.kind,
    detail: `${error.detail}; rollback could not delete: ${leftovers}`,
  });
}

export async function addBlocksWithContent(
  ctx: SequenceContext,
  sheet: Sheet,
  specs: readonly BlockSpec[],
): SequenceResult {
  if (specs.length === 0) return unchanged(sheet);
  const unsupported = specs.find((spec) => !isTextBlockType(spec.blockType));
  if (unsupported !== undefined) return unsupportedType(unsupported);
  const duplicate = findDuplicate([
    ...sheet.blocks.map((block) => block.blockId),
    ...specs.map((spec) => spec.blockId),
  ]);
  if (duplicate !== null) {
    return operationErr("duplicateId", `blockId already present: ${duplicate}`);
  }
  const flushed = await ctx.flushPending();
  if (!flushed.ok) return flushed;

  const createdPaths: ContentPath[] = [];
  const captured: CapturedBlock[] = [];
  for (const spec of specs) {
    const content = await ctx.gateway.createBlockContent(
      ctx.projectId,
      ctx.documentId,
      sheet.sheetId,
      spec.blockType,
      spec.text,
    );
    if (!content.ok) {
      return failAfterRollback(ctx, content.error, createdPaths);
    }
    createdPaths.push(content.value);
    captured.push({
      block: {
        blockId: spec.blockId,
        blockType: spec.blockType,
        position: spec.position,
        size: spec.size,
        contentPath: content.value,
      },
      index: sheet.blocks.length + captured.length,
      text: spec.text,
    });
  }

  const added = addBlocks(
    sheet,
    captured.map((entry) => entry.block),
  );
  if (!added.ok) return failAfterRollback(ctx, added.error, createdPaths);
  const saved = await ctx.gateway.saveSheet(
    ctx.projectId,
    ctx.documentId,
    added.value,
  );
  if (!saved.ok) return failAfterRollback(ctx, saved.error, createdPaths);
  return operationOk({ sheet: added.value, captured, warnings: [] });
}

export async function removeBlocksWithContent(
  ctx: SequenceContext,
  sheet: Sheet,
  blockIds: readonly BlockId[],
): SequenceResult {
  if (blockIds.length === 0) return unchanged(sheet);
  // Validates ids (unknown / duplicate) before any I/O.
  const removed = removeBlocks(sheet, blockIds);
  if (!removed.ok) return failWith(removed.error);
  const targetIds = new Set(blockIds);
  const targets = sheet.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => targetIds.has(block.blockId));
  const unsupported = targets.find(
    ({ block }) => !isTextBlockType(block.blockType),
  );
  if (unsupported !== undefined) return unsupportedType(unsupported.block);
  const flushed = await ctx.flushPending();
  if (!flushed.ok) return flushed;

  // Text is read BEFORE the metadata is saved so a read failure leaves everything intact.
  const captured: CapturedBlock[] = [];
  for (const { block, index } of targets) {
    const text = await ctx.gateway.readBlockContent(
      ctx.projectId,
      ctx.documentId,
      block.contentPath,
    );
    if (!text.ok) return failWith(text.error);
    captured.push({ block, index, text: text.value });
  }

  const saved = await ctx.gateway.saveSheet(
    ctx.projectId,
    ctx.documentId,
    removed.value,
  );
  if (!saved.ok) return failWith(saved.error);

  // From here the command has succeeded: the metadata no longer references the files.
  const failures = await deleteContentFiles(
    ctx,
    captured.map((entry) => entry.block.contentPath),
  );
  const warnings = failures.map(({ path, error }) => ({
    kind: OPERATION_WARNING_KINDS.orphanContentFile,
    contentPath: path,
    error,
  }));
  return operationOk({ sheet: removed.value, captured, warnings });
}

export async function restoreBlocksWithContent(
  ctx: SequenceContext,
  sheet: Sheet,
  captured: readonly CapturedBlock[],
): SequenceResult {
  if (captured.length === 0) return unchanged(sheet);
  // Validates ids and indexes before any I/O.
  const inserted = insertBlocksAt(
    sheet,
    captured.map(({ block, index }) => ({ block, index })),
  );
  if (!inserted.ok) return failWith(inserted.error);
  const flushed = await ctx.flushPending();
  if (!flushed.ok) return flushed;

  // Only files restored by THIS attempt may be deleted on failure; a file that made
  // `restoreBlockContent` fail with `alreadyExists` belongs to someone else.
  const restoredPaths: ContentPath[] = [];
  for (const { block, text } of captured) {
    const restored = await ctx.gateway.restoreBlockContent(
      ctx.projectId,
      ctx.documentId,
      block.blockType,
      block.contentPath,
      text,
    );
    if (!restored.ok) {
      return failAfterRollback(ctx, restored.error, restoredPaths);
    }
    restoredPaths.push(block.contentPath);
  }

  const saved = await ctx.gateway.saveSheet(
    ctx.projectId,
    ctx.documentId,
    inserted.value,
  );
  if (!saved.ok) return failAfterRollback(ctx, saved.error, restoredPaths);
  return operationOk({ sheet: inserted.value, captured, warnings: [] });
}
