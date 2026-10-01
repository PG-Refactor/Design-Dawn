// Tracks what is dirty and persists it (docs/architecture.md §10). Metadata-only changes
// mark things dirty; saving happens after a quiet period (debounce), on `saveDirty`, or
// before a file-backed sequence. It never runs concurrently with commands: the timer
// goes through `runExclusive`, the session's serial queue.

import type { Document } from "../../domain/document/document";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import type { DocumentData } from "../commands/document-data";
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
}

export interface SaveCoordinatorOptions {
  readonly projectId: ProjectId;
  readonly documentId: DocumentId;
  readonly gateway: PersistenceGateway;
  readonly scheduler: Scheduler;
  readonly autoSaveDelayMs: number;
  // Read at save time so the LATEST state is saved, not the state at scheduling time.
  readonly getData: () => DocumentData;
  readonly runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
  readonly onChange: () => void;
}

export interface SaveCoordinator {
  getState(): SaveState;
  // Marks dirty, restarts the debounce timer, and notifies.
  markDirty(change: DirtyChange): void;
  // Saves everything dirty now. Must be called from inside the session queue.
  saveDirty(): Promise<OperationResult<void>>;
  dispose(): void;
}

export function createSaveCoordinator(
  options: SaveCoordinatorOptions,
): SaveCoordinator {
  const { projectId, documentId, gateway } = options;
  let dirtySheetIds: ReadonlySet<SheetId> = new Set();
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
    cancelTimer = options.scheduler.schedule(options.autoSaveDelayMs, () => {
      cancelTimer = null;
      void options.runExclusive(saveDirty);
    });
  }

  async function saveSheets(
    data: DocumentData,
  ): Promise<OperationError | null> {
    let firstError: OperationError | null = null;
    for (const sheetId of [...dirtySheetIds]) {
      const sheet: Sheet | undefined = data.sheets.get(sheetId);
      if (sheet === undefined) {
        // The sheet no longer exists; there is nothing left to save for it.
        dirtySheetIds = withoutSheet(dirtySheetIds, sheetId);
        continue;
      }
      const saved = await gateway.saveSheet(projectId, documentId, sheet);
      if (saved.ok) {
        dirtySheetIds = withoutSheet(dirtySheetIds, sheetId);
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
    if (dirtySheetIds.size === 0 && !documentDirty)
      return operationOk(undefined);
    saving = true;
    options.onChange();
    const data = options.getData();
    const sheetError = await saveSheets(data);
    const documentError = await saveDocumentIfDirty(data.document);
    const error = sheetError ?? documentError;
    saving = false;
    // Dirty flags of failed parts stay set, so the next change or flush retries them.
    lastError = error;
    options.onChange();
    return error === null ? operationOk(undefined) : { ok: false, error };
  }

  return {
    getState: () => ({ dirtySheetIds, documentDirty, saving, lastError }),
    markDirty(change) {
      if (disposed) return;
      if (change.changedSheetIds.length > 0) {
        dirtySheetIds = new Set([...dirtySheetIds, ...change.changedSheetIds]);
      }
      documentDirty = documentDirty || change.documentChanged;
      startTimer();
      options.onChange();
    },
    saveDirty,
    dispose() {
      disposed = true;
      stopTimer();
    },
  };
}

function withoutSheet(
  sheetIds: ReadonlySet<SheetId>,
  sheetId: SheetId,
): ReadonlySet<SheetId> {
  return new Set([...sheetIds].filter((candidate) => candidate !== sheetId));
}
