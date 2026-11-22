import { captionFieldsOf } from "../../domain/block/caption";
import { displayStoredFieldsOf } from "../../domain/block/content-scale";
// The ONE place that orders block content files against sheet metadata:
//
//   add     content file(s) first, then sheet metadata
//   remove  sheet metadata first, then content file(s)
//   restore content file(s) first, then sheet metadata
//
// With auto-save off (`ctx.deferred()`), no file is touched: a new text block gets a name
// reserved in Rust, and the files to create and delete are planned for the next save,
// which keeps the same order. The sheet changes in memory only (it is then unsaved).
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
import type { PlannedCreate } from "../document-session/save-coordinator";
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
  // Auto-save off: where the files to create / delete are planned instead. Null when the
  // files are written now.
  deferred(): DeferredFiles | null;
}

export interface DeferredFiles {
  // The text the app holds for a block (also one that has no file yet).
  textOf(blockId: BlockId): string | undefined;
  planCreate(create: PlannedCreate): void;
  planRemoval(blockId: BlockId, contentPath: ContentPath): void;
  planRestore(create: PlannedCreate): void;
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

function blockOfSpec(spec: BlockSpec, contentPath: ContentPath): Block {
  return {
    blockId: spec.blockId,
    blockType: spec.blockType,
    position: spec.position,
    size: spec.size,
    contentPath,
    ...captionFieldsOf(spec),
    ...displayStoredFieldsOf(spec),
  };
}

// `addBlocksWithContent` refused duplicate ids before any file work, and that is all adding
// blocks checks, so the new blocks are always added.
function appendChecked(
  sheet: Sheet,
  captured: readonly CapturedBlock[],
): Sheet {
  const added = addBlocks(
    sheet,
    captured.map((entry) => entry.block),
  ) as { readonly ok: true; readonly value: Sheet };
  return added.value;
}

async function addBlocksLater(
  ctx: SequenceContext,
  deferred: DeferredFiles,
  sheet: Sheet,
  specs: readonly BlockSpec[],
): SequenceResult {
  const captured: CapturedBlock[] = [];
  for (const spec of specs) {
    const index = sheet.blocks.length + captured.length;
    if (isAssetBlockSpec(spec)) {
      captured.push({
        block: blockOfSpec(spec, spec.contentPath),
        index,
        text: null,
      });
      continue;
    }
    const reserved = await ctx.gateway.reserveBlockContent(
      ctx.projectId,
      ctx.documentId,
      sheet.sheetId,
      spec.blockType,
      spec.text,
    );
    if (!reserved.ok) return failWith(reserved.error);
    captured.push({
      block: blockOfSpec(spec, reserved.value),
      index,
      text: spec.text,
    });
  }
  const added = appendChecked(sheet, captured);
  for (const { block, text } of captured) {
    if (text === null) continue;
    deferred.planCreate({
      blockId: block.blockId,
      sheetId: sheet.sheetId,
      blockType: block.blockType,
      contentPath: block.contentPath,
    });
  }
  return operationOk({ sheet: added, captured, warnings: [] });
}

async function removeBlocksLater(
  ctx: SequenceContext,
  deferred: DeferredFiles,
  removedSheet: Sheet,
  targets: readonly { readonly block: Block; readonly index: number }[],
): SequenceResult {
  const captured: CapturedBlock[] = [];
  for (const { block, index } of targets) {
    if (!isTextBlockType(block.blockType)) {
      captured.push({ block, index, text: null });
      continue;
    }
    const held = deferred.textOf(block.blockId);
    if (held !== undefined) {
      captured.push({ block, index, text: held });
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
  for (const { block, text } of captured) {
    if (text !== null) deferred.planRemoval(block.blockId, block.contentPath);
  }
  return operationOk({ sheet: removedSheet, captured, warnings: [] });
}

function restoreBlocksLater(
  deferred: DeferredFiles,
  sheet: Sheet,
  insertedSheet: Sheet,
  captured: readonly CapturedBlock[],
): OperationResult<SequenceSuccess> {
  for (const { block, text } of captured) {
    if (text === null || !isTextBlockType(block.blockType)) continue;
    deferred.planRestore({
      blockId: block.blockId,
      sheetId: sheet.sheetId,
      blockType: block.blockType,
      contentPath: block.contentPath,
    });
  }
  return operationOk({ sheet: insertedSheet, captured, warnings: [] });
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
  const deferred = ctx.deferred();
  if (deferred !== null) return addBlocksLater(ctx, deferred, sheet, specs);
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
        block: blockOfSpec(spec, spec.contentPath),
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
      block: blockOfSpec(spec, content.value),
      index,
      text: spec.text,
    });
  }

  const added = appendChecked(sheet, captured);
  const saved = await ctx.gateway.saveSheet(
    ctx.projectId,
    ctx.documentId,
    added,
  );
  if (!saved.ok) return failAfterRollback(ctx, saved.error, createdPaths);
  return operationOk({ sheet: added, captured, warnings: [] });
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
  const deferred = ctx.deferred();
  if (deferred !== null) {
    return removeBlocksLater(ctx, deferred, removed.value, targets);
  }
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
  const deferred = ctx.deferred();
  if (deferred !== null) {
    return restoreBlocksLater(deferred, sheet, inserted.value, captured);
  }
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
