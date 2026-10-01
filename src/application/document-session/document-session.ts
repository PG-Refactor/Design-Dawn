// One open Document: its immutable Domain values, undo / redo history and save state
// (docs/architecture.md §9, §10). UI-free; state reaches the application store through
// `onStateChange`.
//
// Everything that touches the document (execute, undo, redo, flush, auto-save) runs on
// one serial queue, so persistence calls for the same document never interleave and a
// command always sees the state the previous one left behind.
//
// Failure rule: a failed execute / undo / redo leaves the document data and BOTH history
// stacks exactly as they were. Data and stacks are only assigned after the operation
// succeeded.

import type { Document } from "../../domain/document/document";
import type { ProjectId, SheetId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import {
  addBlocksWithContent,
  removeBlocksWithContent,
  type SequenceContext,
  type SequenceSuccess,
} from "../commands/block-file-sequences";
import type {
  ApplicationCommand,
  FileBackedCommand,
  MetadataCommand,
} from "../commands/command";
import { COMMAND_KINDS } from "../commands/command-kind";
import {
  type DocumentData,
  type DocumentDataChange,
  diffDocumentData,
  findSheet,
  hasChanges,
  replaceSheet,
} from "../commands/document-data";
import {
  entryLabel,
  type FileBackedEntry,
  type HistoryEntry,
  pushWithLimit,
  toggleFileBackedEntry,
} from "../commands/history";
import type { OperationWarning } from "../operation-warning";
import {
  failWith,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { Scheduler } from "../ports/scheduler";
import type { DocumentSessionState } from "../state/application-state";
import { createSaveCoordinator } from "./save-coordinator";

export interface DocumentSessionConfig {
  readonly undoHistoryLimit: number;
  readonly autoSaveDelayMs: number;
}

export interface DocumentSessionOptions {
  readonly projectId: ProjectId;
  readonly document: Document;
  readonly sheets: ReadonlyMap<SheetId, Sheet>;
  readonly gateway: PersistenceGateway;
  readonly scheduler: Scheduler;
  readonly config: DocumentSessionConfig;
  readonly onStateChange: (state: DocumentSessionState) => void;
}

export interface DocumentSession {
  getState(): DocumentSessionState;
  execute(command: ApplicationCommand): Promise<OperationResult<void>>;
  undo(): Promise<OperationResult<void>>;
  redo(): Promise<OperationResult<void>>;
  // Saves pending metadata now (also what Ctrl/Cmd+S calls).
  flush(): Promise<OperationResult<void>>;
  // For when a sheet is deleted: no history entry may reference it any more.
  clearHistory(): void;
  // Flushes, then stops timers. Further operations are rejected.
  dispose(): Promise<OperationResult<void>>;
}

type Direction = "undo" | "redo";

interface StepOutcome {
  readonly data: DocumentData;
  readonly entry: HistoryEntry;
  readonly warnings: readonly OperationWarning[];
  // Metadata changes that still have to be saved; empty for file-backed steps, which
  // save the sheet themselves.
  readonly pending: DocumentDataChange;
}

const NO_PENDING_CHANGE: DocumentDataChange = {
  documentChanged: false,
  changedSheetIds: [],
};

export function createDocumentSession(
  options: DocumentSessionOptions,
): DocumentSession {
  const { projectId, gateway, config } = options;
  const documentId = options.document.documentId;
  let data: DocumentData = {
    document: options.document,
    sheets: options.sheets,
  };
  let undoStack: readonly HistoryEntry[] = [];
  let redoStack: readonly HistoryEntry[] = [];
  let warnings: readonly OperationWarning[] = [];
  let closed = false;
  let queueTail: Promise<void> = Promise.resolve();
  let current: DocumentSessionState;

  function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = queueTail.then(task);
    queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const coordinator = createSaveCoordinator({
    projectId,
    documentId,
    gateway,
    scheduler: options.scheduler,
    autoSaveDelayMs: config.autoSaveDelayMs,
    getData: () => data,
    runExclusive,
    onChange: publish,
  });

  const sequenceContext: SequenceContext = {
    projectId,
    documentId,
    gateway,
    flushPending: () => coordinator.saveDirty(),
  };

  function buildState(): DocumentSessionState {
    const lastUndo = undoStack.at(-1);
    const lastRedo = redoStack.at(-1);
    return {
      document: data.document,
      sheets: data.sheets,
      history: {
        canUndo: lastUndo !== undefined,
        canRedo: lastRedo !== undefined,
        undoLabel: lastUndo === undefined ? null : entryLabel(lastUndo),
        redoLabel: lastRedo === undefined ? null : entryLabel(lastRedo),
      },
      save: coordinator.getState(),
      warnings,
    };
  }

  function publish(): void {
    current = buildState();
    options.onStateChange(current);
  }

  current = buildState();

  function closedError<T>(): OperationResult<T> {
    return operationErr("notWritable", "the document session is closed");
  }

  function clearWarnings(): void {
    if (warnings.length === 0) return;
    warnings = [];
    publish();
  }

  // Assigns the successful outcome and publishes exactly once.
  function commit(
    next: DocumentData,
    stacks: { undo: readonly HistoryEntry[]; redo: readonly HistoryEntry[] },
    operationWarnings: readonly OperationWarning[],
    pending: DocumentDataChange,
  ): void {
    data = next;
    undoStack = stacks.undo;
    redoStack = stacks.redo;
    warnings = operationWarnings;
    if (hasChanges(pending)) {
      coordinator.markDirty(pending);
    } else {
      publish();
    }
  }

  function applyMetadata(
    command: MetadataCommand,
    direction: Direction | "execute",
  ): OperationResult<{ data: DocumentData; pending: DocumentDataChange }> {
    const result =
      direction === "undo" ? command.revert(data) : command.apply(data);
    if (!result.ok) return failWith(result.error);
    return operationOk({
      data: result.value,
      pending: diffDocumentData(data, result.value),
    });
  }

  async function runFileBackedFirstTime(
    command: FileBackedCommand,
  ): Promise<OperationResult<SequenceSuccess>> {
    const sheet = findSheet(data, command.sheetId);
    if (!sheet.ok) return failWith(sheet.error);
    return command.kind === COMMAND_KINDS.createBlocks
      ? addBlocksWithContent(sequenceContext, sheet.value, command.specs)
      : removeBlocksWithContent(sequenceContext, sheet.value, command.blockIds);
  }

  async function executeFileBacked(
    command: FileBackedCommand,
  ): Promise<OperationResult<void>> {
    const outcome = await runFileBackedFirstTime(command);
    if (!outcome.ok) return failWith(outcome.error);
    // Nothing was created or removed (empty request): not a history step.
    if (outcome.value.captured.length === 0) return operationOk(undefined);
    const entry: FileBackedEntry = {
      type: "fileBacked",
      label: command.kind,
      sheetId: command.sheetId,
      blocks: outcome.value.captured,
      present: command.kind === COMMAND_KINDS.createBlocks,
    };
    commit(
      replaceSheet(data, outcome.value.sheet),
      {
        undo: pushWithLimit(undoStack, entry, config.undoHistoryLimit),
        redo: [],
      },
      outcome.value.warnings,
      NO_PENDING_CHANGE,
    );
    return operationOk(undefined);
  }

  async function executeMetadata(
    command: MetadataCommand,
  ): Promise<OperationResult<void>> {
    const applied = applyMetadata(command, "execute");
    if (!applied.ok) return failWith(applied.error);
    if (!hasChanges(applied.value.pending)) return operationOk(undefined);
    commit(
      applied.value.data,
      {
        undo: pushWithLimit(
          undoStack,
          { type: "metadata", command },
          config.undoHistoryLimit,
        ),
        redo: [],
      },
      [],
      applied.value.pending,
    );
    return operationOk(undefined);
  }

  async function stepFileBacked(
    entry: FileBackedEntry,
  ): Promise<OperationResult<StepOutcome>> {
    const sheet = findSheet(data, entry.sheetId);
    if (!sheet.ok) return failWith(sheet.error);
    const toggled = await toggleFileBackedEntry(
      sequenceContext,
      sheet.value,
      entry,
    );
    if (!toggled.ok) return failWith(toggled.error);
    return operationOk({
      data: replaceSheet(data, toggled.value.sheet),
      entry: toggled.value.entry,
      warnings: toggled.value.warnings,
      pending: NO_PENDING_CHANGE,
    });
  }

  async function stepEntry(
    entry: HistoryEntry,
    direction: Direction,
  ): Promise<OperationResult<StepOutcome>> {
    if (entry.type === "fileBacked") return stepFileBacked(entry);
    const applied = applyMetadata(entry.command, direction);
    if (!applied.ok) return failWith(applied.error);
    return operationOk({ ...applied.value, entry, warnings: [] });
  }

  async function step(direction: Direction): Promise<OperationResult<void>> {
    const source = direction === "undo" ? undoStack : redoStack;
    const entry = source.at(-1);
    // Nothing to undo / redo is not an error: UI shortcuts may fire at any time.
    if (entry === undefined) return operationOk(undefined);
    const outcome = await stepEntry(entry, direction);
    if (!outcome.ok) return failWith(outcome.error);
    const {
      data: next,
      entry: updated,
      warnings: stepWarnings,
      pending,
    } = outcome.value;
    const remaining = source.slice(0, -1);
    commit(
      next,
      direction === "undo"
        ? { undo: remaining, redo: [...redoStack, updated] }
        : {
            undo: pushWithLimit(undoStack, updated, config.undoHistoryLimit),
            redo: remaining,
          },
      stepWarnings,
      pending,
    );
    return operationOk(undefined);
  }

  // Wraps an operation: rejects after dispose and resets last operation's warnings.
  function queued<T>(
    operation: () => Promise<OperationResult<T>>,
  ): Promise<OperationResult<T>> {
    return runExclusive(async () => {
      if (closed) return closedError<T>();
      clearWarnings();
      return operation();
    });
  }

  return {
    getState: () => current,
    execute: (command) =>
      queued(() =>
        command.category === "metadata"
          ? executeMetadata(command)
          : executeFileBacked(command),
      ),
    undo: () => queued(() => step("undo")),
    redo: () => queued(() => step("redo")),
    flush: () => queued(() => coordinator.saveDirty()),
    clearHistory() {
      undoStack = [];
      redoStack = [];
      publish();
    },
    dispose: () =>
      runExclusive(async () => {
        if (closed) return operationOk(undefined);
        const saved = await coordinator.saveDirty();
        closed = true;
        coordinator.dispose();
        return saved;
      }),
  };
}
