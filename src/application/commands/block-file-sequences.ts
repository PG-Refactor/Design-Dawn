// The ONE place that orders block content files against sheet metadata:
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
import { type BlockSpec, isAssetBlockSpec } from "./command";

// A block together with what is needed to bring it back: its z-order index and its text.
// `text` is null when the block has no text file of its own: an image block (its asset
// is never touched by add / remove / restore), or a text block whose content file did
// not exist when it was removed. Such a block has no file to
// delete and none to restore: undoing brings back the same state (an image block whose
// asset has since gone simply shows its load error).
export interface CapturedBlock {
  readonly block: Block;
  readonly index: number;
  readonly text: string | null;
}

// Why a missing file does not stop a removal: a block whose content is gone must still be
// removable, and nothing can be lost because there is nothing on disk. Any other read
// failure (the file exists but cannot be read) aborts, since deleting would destroy
// content that undo could not bring back.
const MISSING_CONTENT_KIND = "fileNotFound";

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
    const index = sheet.blocks.length + captured.length;
    if (isAssetBlockSpec(spec)) {
      // The asset exists already (the import / copy ran first), so there is nothing to
      // create and nothing to roll back for this block.
      captured.push({
        block: {
          blockId: spec.blockId,
          blockType: spec.blockType,
          position: spec.position,
          size: spec.size,
          contentPath: spec.contentPath,
          ...(spec.caption === undefined ? {} : { caption: spec.caption }),
        },
        index,
        text: null,
      });
      continue;
    }
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
        ...(spec.caption === undefined ? {} : { caption: spec.caption }),
      },
      index,
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
  const flushed = await ctx.flushPending();
  if (!flushed.ok) return flushed;

  // Text is read BEFORE the metadata is saved so a read failure leaves everything intact.
  const captured: CapturedBlock[] = [];
  for (const { block, index } of targets) {
    // An image block has no text file; its asset stays where it is (it may still be used
    // by other blocks, and undo needs it).
    if (!isTextBlockType(block.blockType)) {
      captured.push({ block, index, text: null });
      continue;
    }
    const text = await ctx.gateway.readBlockContent(
      ctx.projectId,
      ctx.documentId,
      block.contentPath,
    );
    if (text.ok) {
      captured.push({ block, index, text: text.value });
    } else if (text.error.kind === MISSING_CONTENT_KIND) {
      captured.push({ block, index, text: null });
    } else {
      return failWith(text.error);
    }
  }

  const saved = await ctx.gateway.saveSheet(
    ctx.projectId,
    ctx.documentId,
    removed.value,
  );
  if (!saved.ok) return failWith(saved.error);

  // From here the command has succeeded: the metadata no longer references the files.
  // Only text files are deleted (`text !== null`); assets are never deleted.
  const failures = await deleteContentFiles(
    ctx,
    captured
      .filter((entry) => entry.text !== null)
      .map((entry) => entry.block.contentPath),
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
    // No text file to bring back: the content was already missing when the block was
    // removed (restoring must not invent a file), or this is an image block (its asset is
    // never touched; if it is gone the block shows its load error).
    if (text === null || !isTextBlockType(block.blockType)) continue;
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
