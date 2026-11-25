// Tracks what is dirty and persists it. Metadata-only changes
// mark things dirty; saving happens after a quiet period (debounce), on `saveDirty`, or
// before a file-backed sequence. With auto-save off, adding and removing text blocks does
// not touch files either: the files to create (under names reserved in Rust) and to delete
// are planned here and handled by the next save, in the order the file-backed sequences
// use (content files first, then the sheets, then deletions). It never runs concurrently with commands: the timer
// goes through `runExclusive`, the session's serial queue.

import type { BlockType } from "../../domain/block/block-type";
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

// A text block's file the next save creates (auto-save off), with its current text.
export interface PlannedCreate {
  readonly blockId: BlockId;
  readonly sheetId: SheetId;
  readonly blockType: BlockType;
  readonly contentPath: ContentPath;
}

// Files the next save creates and deletes (handed over with a moved Document).
export interface PlannedFiles {
  readonly creates: readonly PlannedCreate[];
  readonly deletes: readonly ContentPath[];
}

export const NO_PLANNED_FILES: PlannedFiles = { creates: [], deletes: [] };

const ALREADY_EXISTS = "alreadyExists";
const FILE_NOT_FOUND = "fileNotFound";

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
  // A reserved name was taken by the time of the save (another program made a file
  // there): the block's file was created under `contentPath` instead.
  readonly relocate: (blockId: BlockId, contentPath: ContentPath) => void;
  // Files planned before this coordinator existed (a moved Document).
  readonly plannedFiles?: PlannedFiles;
}

export interface SaveCoordinator {
  getState(): SaveState;
  // Marks dirty, restarts the debounce timer (only while auto-save is enabled), and notifies.
  markDirty(change: DirtyChange): void;
  // Stops saving while the files changed outside the app: the
  // debounce timer does not run, and `saveDirty` fails with `error` without writing anything
  // while something is dirty. Dirty state is kept; an error is shown only when there is
  // something that cannot be saved. Does notify.
  suspendSaving(error: OperationError): void;
  // Undoes `suspendSaving`: clears its error and starts the timer again if anything is dirty.
  resumeSaving(): void;
  // For when auto-save is switched back on: starts the debounce timer if anything is dirty.
  resumeAutoSave(): void;
  // Forgets dirty texts of blocks that are gone (their file is deleted or the sheet was
  // removed), so no write to a missing file is attempted. Does not notify: the caller
  // publishes with the change that removed the blocks.
  retainContentBlocks(liveBlockIds: ReadonlySet<BlockId>): void;
  // Saves everything dirty now. Must be called from inside the session queue.
  saveDirty(): Promise<OperationResult<void>>;
  // Forgets every dirty flag: the data is back to exactly what the files hold (an undo or
  // redo returned to the last saved state). Stops the timer, clears the last save error
  // (there is nothing left to save) and notifies. Not while saving is stopped.
  markClean(): void;
  // Auto-save off: the next save creates this block's file.
  planCreate(create: PlannedCreate): void;
  // A text block went away before a save: a planned creation is dropped, otherwise its
  // file is deleted by the next save.
  planRemoval(blockId: BlockId, contentPath: ContentPath): void;
  // A text block came back (undo / redo): its file stays when a deletion was planned (and
  // its text is saved again), otherwise the next save creates it.
  planRestore(create: PlannedCreate): void;
  plannedFiles(): PlannedFiles;
  dispose(): void;
}

// Saves every item in turn: a failure does not stop the others, and the first one is
// reported. The items are copied first, since saving one changes the set it came from.
async function firstFailure<Item>(
  items: Iterable<Item>,
  save: (item: Item) => Promise<OperationError | null>,
): Promise<OperationError | null> {
  let first: OperationError | null = null;
  for (const item of [...items]) {
    const error = await save(item);
    first ??= error;
  }
  return first;
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
  // Set while saving is stopped; the error `saveDirty` fails with.
  let suspension: OperationError | null = null;
  const initialPlan = options.plannedFiles ?? NO_PLANNED_FILES;
  let plannedCreates: ReadonlyMap<BlockId, PlannedCreate> = new Map(
    initialPlan.creates.map((create) => [create.blockId, create]),
  );
  let plannedDeletes: ReadonlySet<ContentPath> = new Set(initialPlan.deletes);

  function stopTimer(): void {
    cancelTimer?.();
    cancelTimer = null;
  }

  function startTimer(): void {
    stopTimer();
    if (suspension !== null || !options.autoSavePolicy.isEnabled()) return;
    cancelTimer = options.scheduler.schedule(options.autoSaveDelayMs, () => {
      cancelTimer = null;
      // Checked again because the setting may have been switched off while waiting.
      if (!options.autoSavePolicy.isEnabled()) return;
      void options.runExclusive(saveDirty);
    });
  }

  function hasDirtyState(): boolean {
    return (
      dirtyContentBlockIds.size > 0 ||
      dirtySheetIds.size > 0 ||
      documentDirty ||
      plannedCreates.size > 0 ||
      plannedDeletes.size > 0
    );
  }

  // The planned files, before anything that refers to them is saved. A reserved name that
  // was taken meanwhile is given up for a new one.
  function createPlannedFiles(
    data: DocumentData,
  ): Promise<OperationError | null> {
    return firstFailure(plannedCreates.values(), async (create) => {
      // A planned creation is dropped together with its block, so its text is loaded.
      const text = data.contents.get(create.blockId) as string;
      const created = await gateway.restoreBlockContent(
        projectId,
        documentId,
        create.blockType,
        create.contentPath,
        text,
      );
      if (!created.ok && created.error.kind !== ALREADY_EXISTS) {
        return created.error;
      }
      if (!created.ok) {
        const fresh = await gateway.createBlockContent(
          projectId,
          documentId,
          create.sheetId,
          create.blockType,
          text,
        );
        if (!fresh.ok) return fresh.error;
        options.relocate(create.blockId, fresh.value);
      }
      plannedCreates = new Map(
        [...plannedCreates].filter(([blockId]) => blockId !== create.blockId),
      );
      // The new file already holds the current text.
      dirtyContentBlockIds = withoutId(dirtyContentBlockIds, create.blockId);
      return null;
    });
  }

  // Once no saved sheet refers to them any more. A file that is already gone is fine.
  function deletePlannedFiles(): Promise<OperationError | null> {
    return firstFailure(plannedDeletes, async (contentPath) => {
      const deleted = await gateway.deleteBlockContent(
        projectId,
        documentId,
        contentPath,
      );
      if (!deleted.ok && deleted.error.kind !== FILE_NOT_FOUND) {
        return deleted.error;
      }
      plannedDeletes = withoutId(plannedDeletes, contentPath);
      return null;
    });
  }

  // Content goes first: a sheet never references a text file that is older than the
  // metadata saved with it (content -> metadata, like the file-backed sequences).
  function saveContents(data: DocumentData): Promise<OperationError | null> {
    const contentPaths = new Map<BlockId, ContentPath>();
    for (const sheet of data.sheets.values()) {
      for (const block of sheet.blocks) {
        contentPaths.set(block.blockId, block.contentPath);
      }
    }
    return firstFailure(dirtyContentBlockIds, async (blockId) => {
      const contentPath = contentPaths.get(blockId);
      const text = data.contents.get(blockId);
      if (contentPath !== undefined && text !== undefined) {
        const saved = await gateway.writeBlockContent(
          projectId,
          documentId,
          contentPath,
          text,
        );
        if (!saved.ok) return saved.error;
      }
      // Saved, or the block no longer exists and there is nothing left to save for it.
      dirtyContentBlockIds = withoutId(dirtyContentBlockIds, blockId);
      return null;
    });
  }

  function saveSheets(data: DocumentData): Promise<OperationError | null> {
    return firstFailure(dirtySheetIds, async (sheetId) => {
      const sheet: Sheet | undefined = data.sheets.get(sheetId);
      if (sheet !== undefined) {
        const saved = await gateway.saveSheet(projectId, documentId, sheet);
        if (!saved.ok) return saved.error;
      }
      // Saved, or the sheet no longer exists and there is nothing left to save for it.
      dirtySheetIds = withoutId(dirtySheetIds, sheetId);
      return null;
    });
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
    if (suspension !== null) {
      lastError = suspension;
      options.onChange();
      return { ok: false, error: suspension };
    }
    saving = true;
    options.onChange();
    const createError = await createPlannedFiles(options.getData());
    // Read again: a relocated block has a new path.
    const data = options.getData();
    const contentError = await saveContents(data);
    const sheetError =
      createError === null ? await saveSheets(data) : createError;
    const deleteError = sheetError === null ? await deletePlannedFiles() : null;
    const documentError = await saveDocumentIfDirty(data.document);
    const error = contentError ?? sheetError ?? deleteError ?? documentError;
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
      // Changes made while saving is stopped are the ones that cannot be saved.
      if (suspension !== null) lastError = suspension;
      startTimer();
      options.onChange();
    },
    suspendSaving(error) {
      if (disposed) return;
      suspension = error;
      stopTimer();
      if (hasDirtyState()) lastError = error;
      options.onChange();
    },
    resumeSaving() {
      if (disposed || suspension === null) return;
      if (lastError === suspension) lastError = null;
      suspension = null;
      if (hasDirtyState()) startTimer();
      options.onChange();
    },
    resumeAutoSave() {
      if (disposed || saving || suspension !== null || !hasDirtyState()) return;
      startTimer();
    },
    retainContentBlocks(liveBlockIds) {
      if ([...dirtyContentBlockIds].every((id) => liveBlockIds.has(id))) return;
      dirtyContentBlockIds = new Set(
        [...dirtyContentBlockIds].filter((id) => liveBlockIds.has(id)),
      );
    },
    saveDirty,
    markClean() {
      if (disposed || suspension !== null) return;
      dirtySheetIds = new Set();
      dirtyContentBlockIds = new Set();
      documentDirty = false;
      plannedCreates = new Map();
      plannedDeletes = new Set();
      lastError = null;
      stopTimer();
      options.onChange();
    },
    planCreate(create) {
      plannedCreates = new Map([...plannedCreates, [create.blockId, create]]);
    },
    planRemoval(blockId, contentPath) {
      if (plannedCreates.has(blockId)) {
        plannedCreates = new Map(
          [...plannedCreates].filter(([id]) => id !== blockId),
        );
        return;
      }
      plannedDeletes = new Set([...plannedDeletes, contentPath]);
    },
    planRestore(create) {
      if (plannedDeletes.has(create.contentPath)) {
        plannedDeletes = withoutId(plannedDeletes, create.contentPath);
        dirtyContentBlockIds = new Set([
          ...dirtyContentBlockIds,
          create.blockId,
        ]);
        return;
      }
      plannedCreates = new Map([...plannedCreates, [create.blockId, create]]);
    },
    plannedFiles: () => ({
      creates: [...plannedCreates.values()],
      deletes: [...plannedDeletes],
    }),
    dispose() {
      disposed = true;
      stopTimer();
    },
  };
}

function withoutId<Id>(ids: ReadonlySet<Id>, id: Id): ReadonlySet<Id> {
  return new Set([...ids].filter((candidate) => candidate !== id));
}
