// Tracks what is dirty and persists it (docs/architecture.md §10). Metadata-only changes
// mark things dirty; saving happens after a quiet period (debounce), on `saveDirty`, or
// before a file-backed sequence. It never runs concurrently with commands: the timer
// goes through `runExclusive`, the session's serial queue.

import type { ContentPath } from "../../domain/block/content-path";
import type { Document } from "../../domain/document/document";
import type {
  BlockId,
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import type { DocumentData } from "../commands/document-data";
import type { AutoSavePolicy } from "../ports/auto-save-policy";
import {
  type OperationError,
  type OperationResult,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { Scheduler } from "../ports/scheduler";
import type { SaveState } from "../state/application-state";

export interface DirtyChange {
  readonly documentChanged: boolean;
  readonly changedSheetIds: readonly SheetId[];
  readonly changedContentBlockIds: readonly BlockId[];
}

export interface SaveCoordinatorOptions {
  readonly projectId: ProjectId;
  readonly documentId: DocumentId;
  readonly gateway: PersistenceGateway;
  readonly scheduler: Scheduler;
  readonly autoSaveDelayMs: number;
  // When disabled, changes only stay dirty: they are saved by an explicit save or a flush.
  readonly autoSavePolicy: AutoSavePolicy;
  // Read at save time so the LATEST state is saved, not the state at scheduling time.
  readonly getData: () => DocumentData;
  readonly runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
  readonly onChange: () => void;
}

export interface SaveCoordinator {
  getState(): SaveState;
  // Marks dirty, restarts the debounce timer (only while auto-save is enabled), and notifies.
  markDirty(change: DirtyChange): void;
  // For when auto-save is switched back on: starts the debounce timer if anything is dirty.
  resumeAutoSave(): void;
  // Forgets dirty texts of blocks that are gone (their file is deleted or the sheet was
  // removed), so no write to a missing file is attempted. Does not notify: the caller
  // publishes with the change that removed the blocks.
  retainContentBlocks(liveBlockIds: ReadonlySet<BlockId>): void;
  // Saves everything dirty now. Must be called from inside the session queue.
  saveDirty(): Promise<OperationResult<void>>;
  dispose(): void;
}

export function createSaveCoordinator(
  options: SaveCoordinatorOptions,
): SaveCoordinator {
  const { projectId, documentId, gateway } = options;
  let dirtySheetIds: ReadonlySet<SheetId> = new Set();
  let dirtyContentBlockIds: ReadonlySet<BlockId> = new Set();
  let documentDirty = false;
  let saving = false;
  let lastError: OperationError | null = null;
  let cancelTimer: (() => void) | null = null;
  let disposed = false;

  function stopTimer(): void {
    cancelTimer?.();
    cancelTimer = null;
  }

  function startTimer(): void {
    stopTimer();
    if (!options.autoSavePolicy.isEnabled()) return;
    cancelTimer = options.scheduler.schedule(options.autoSaveDelayMs, () => {
      cancelTimer = null;
      // Checked again because the setting may have been switched off while waiting.
      if (!options.autoSavePolicy.isEnabled()) return;
      void options.runExclusive(saveDirty);
    });
  }

  function hasDirtyState(): boolean {
    return (
      dirtyContentBlockIds.size > 0 || dirtySheetIds.size > 0 || documentDirty
    );
  }

  // Content goes first: a sheet never references a text file that is older than the
  // metadata saved with it (content -> metadata, like the file-backed sequences).
  async function saveContents(
    data: DocumentData,
  ): Promise<OperationError | null> {
    if (dirtyContentBlockIds.size === 0) return null;
    const contentPaths = new Map<BlockId, ContentPath>();
    for (const sheet of data.sheets.values()) {
      for (const block of sheet.blocks) {
        contentPaths.set(block.blockId, block.contentPath);
      }
    }
    let firstError: OperationError | null = null;
    for (const blockId of [...dirtyContentBlockIds]) {
      const contentPath = contentPaths.get(blockId);
      const text = data.contents.get(blockId);
      if (contentPath === undefined || text === undefined) {
        // The block no longer exists; there is nothing left to save for it.
        dirtyContentBlockIds = withoutId(dirtyContentBlockIds, blockId);
        continue;
      }
      const saved = await gateway.writeBlockContent(
        projectId,
        documentId,
        contentPath,
        text,
      );
      if (saved.ok) {
        dirtyContentBlockIds = withoutId(dirtyContentBlockIds, blockId);
      } else {
        firstError ??= saved.error;
      }
    }
    return firstError;
  }

  async function saveSheets(
    data: DocumentData,
  ): Promise<OperationError | null> {
    let firstError: OperationError | null = null;
    for (const sheetId of [...dirtySheetIds]) {
      const sheet: Sheet | undefined = data.sheets.get(sheetId);
      if (sheet === undefined) {
        // The sheet no longer exists; there is nothing left to save for it.
        dirtySheetIds = withoutId(dirtySheetIds, sheetId);
        continue;
      }
      const saved = await gateway.saveSheet(projectId, documentId, sheet);
      if (saved.ok) {
        dirtySheetIds = withoutId(dirtySheetIds, sheetId);
      } else {
        firstError ??= saved.error;
      }
    }
    return firstError;
  }

  async function saveDocumentIfDirty(
    document: Document,
  ): Promise<OperationError | null> {
    if (!documentDirty) return null;
    const saved = await gateway.saveDocument(projectId, document);
    if (saved.ok) {
      documentDirty = false;
      return null;
    }
    return saved.error;
  }

  async function saveDirty(): Promise<OperationResult<void>> {
    stopTimer();
    // A timer callback that was already queued when the session was discarded must not
    // write into a document that is being deleted.
    if (disposed) return operationOk(undefined);
    if (!hasDirtyState()) return operationOk(undefined);
    saving = true;
    options.onChange();
    const data = options.getData();
    const contentError = await saveContents(data);
    const sheetError = await saveSheets(data);
    const documentError = await saveDocumentIfDirty(data.document);
    const error = contentError ?? sheetError ?? documentError;
    saving = false;
    // Dirty flags of failed parts stay set, so the next change or flush retries them.
    lastError = error;
    options.onChange();
    return error === null ? operationOk(undefined) : { ok: false, error };
  }

  return {
    getState: () => ({
      dirtySheetIds,
      dirtyContentBlockIds,
      documentDirty,
      saving,
      lastError,
    }),
    markDirty(change) {
      if (disposed) return;
      if (change.changedSheetIds.length > 0) {
        dirtySheetIds = new Set([...dirtySheetIds, ...change.changedSheetIds]);
      }
      if (change.changedContentBlockIds.length > 0) {
        dirtyContentBlockIds = new Set([
          ...dirtyContentBlockIds,
          ...change.changedContentBlockIds,
        ]);
      }
      documentDirty = documentDirty || change.documentChanged;
      startTimer();
      options.onChange();
    },
    resumeAutoSave() {
      if (disposed || saving || !hasDirtyState()) return;
      startTimer();
    },
    retainContentBlocks(liveBlockIds) {
      if ([...dirtyContentBlockIds].every((id) => liveBlockIds.has(id))) return;
      dirtyContentBlockIds = new Set(
        [...dirtyContentBlockIds].filter((id) => liveBlockIds.has(id)),
      );
    },
    saveDirty,
    dispose() {
      disposed = true;
      stopTimer();
    },
  };
}

function withoutId<Id>(ids: ReadonlySet<Id>, id: Id): ReadonlySet<Id> {
  return new Set([...ids].filter((candidate) => candidate !== id));
}
