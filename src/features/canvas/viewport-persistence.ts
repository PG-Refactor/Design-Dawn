// Restores and saves the per-sheet viewport (docs/architecture.md §6.2.2). Framework-free:
// it watches the UI state store, so it needs no component and cannot miss a change.
//
// The viewport stays UI state. This controller only copies it to / from the viewport
// gateway: a sheet that becomes visible without a viewport gets the saved one (or the
// default), and changes are saved after a quiet period, latest value only. Saving is never
// triggered per pointer move, and nothing here touches Domain values or undo history.

import type { Viewport } from "../../application/local-state/viewport";
import {
  type OperationErrorKind,
  type OperationResult,
  operationErr,
} from "../../application/ports/operation-error";
import type { Scheduler } from "../../application/ports/scheduler";
import type { ViewportGateway } from "../../application/ports/viewport-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import {
  type OperationLabel,
  setViewport,
  type UiState,
  type UiStateStore,
} from "../workspace/ui-state/ui-state";
import { DEFAULT_VIEWPORT } from "./geometry/viewport-math";

export interface ViewportPersistenceDependencies {
  readonly gateway: ViewportGateway;
  readonly scheduler: Scheduler;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly saveDelayMs?: number;
}

export interface ViewportPersistence {
  // Saves everything pending now and resolves when all saves have finished.
  flush(): Promise<void>;
  // Stops watching and drops timers WITHOUT saving; call `flush` first when needed.
  dispose(): void;
}

interface SheetLocation {
  readonly projectId: ProjectId;
  readonly documentId: DocumentId;
}

interface PendingSave extends SheetLocation {
  readonly viewport: Viewport;
  readonly cancelTimer: () => void;
}

export function createViewportPersistence(
  dependencies: ViewportPersistenceDependencies,
): ViewportPersistence {
  const { gateway, scheduler, applicationStore, uiStateStore } = dependencies;
  const saveDelayMs =
    dependencies.saveDelayMs ?? CANVAS_CONFIG.viewport.saveDelayMs;

  // Viewports already reconciled with the state: a change is anything not in here.
  const seen = new Map<SheetId, Viewport>();
  const pending = new Map<SheetId, PendingSave>();
  const loading = new Set<SheetId>();
  let previousViewports: UiState["viewportBySheet"] | null = null;
  let visibleSheetId: SheetId | null = null;
  // Saves run one after another so an older value can never overwrite a newer one.
  let saveQueue: Promise<void> = Promise.resolve();

  function record(
    operation: OperationLabel,
    kind: OperationErrorKind,
    detail: string,
  ): void {
    uiStateStore.setState((state) =>
      addOperationError(state, operation, null, { kind, detail }),
    );
  }

  function recordFailure(
    operation: OperationLabel,
    result: OperationResult<unknown>,
  ): void {
    if (!result.ok) record(operation, result.error.kind, result.error.detail);
  }

  function locateSheet(sheetId: SheetId): SheetLocation | null {
    const application = applicationStore.getState();
    const projectId = application.project?.projectId;
    if (projectId === undefined) return null;
    for (const [documentId, details] of application.documentDetails) {
      if (details.sheetEntries.some((entry) => entry.sheetId === sheetId)) {
        return { projectId, documentId };
      }
    }
    return null;
  }

  function sheetExists(documentId: DocumentId, sheetId: SheetId): boolean {
    return (
      applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.some((entry) => entry.sheetId === sheetId) === true
    );
  }

  // True when the sheet (or its document) was deleted: its viewport is not worth saving.
  // A closed document or project is not a deletion, so its last viewport is kept.
  function wasDeleted(location: SheetLocation, sheetId: SheetId): boolean {
    const { project, documentDetails } = applicationStore.getState();
    if (project === null || project.projectId !== location.projectId) {
      return false;
    }
    const documentListed = project.documents.some(
      (entry) => entry.documentId === location.documentId,
    );
    if (!documentListed) return true;
    const details = documentDetails.get(location.documentId);
    return (
      details !== undefined &&
      !details.sheetEntries.some((entry) => entry.sheetId === sheetId)
    );
  }

  function enqueueSave(
    sheetId: SheetId,
    { projectId, documentId, viewport }: PendingSave,
  ): void {
    saveQueue = saveQueue.then(async () => {
      try {
        recordFailure(
          "saveViewport",
          await gateway.saveSheetViewport(
            projectId,
            documentId,
            sheetId,
            viewport,
          ),
        );
      } catch (error) {
        // A rejecting gateway breaks the port contract; it is reported, not swallowed.
        record("saveViewport", "unexpectedCommandError", String(error));
      }
    });
  }

  function flushSheet(sheetId: SheetId): void {
    const entry = pending.get(sheetId);
    if (entry === undefined) return;
    entry.cancelTimer();
    pending.delete(sheetId);
    enqueueSave(sheetId, entry);
  }

  function dropSheet(sheetId: SheetId): void {
    pending.get(sheetId)?.cancelTimer();
    pending.delete(sheetId);
  }

  function scheduleSave(sheetId: SheetId, viewport: Viewport): void {
    const location = locateSheet(sheetId) ?? pending.get(sheetId);
    if (location === undefined || location === null) return;
    pending.get(sheetId)?.cancelTimer();
    const cancelTimer = scheduler.schedule(saveDelayMs, () =>
      flushSheet(sheetId),
    );
    pending.set(sheetId, {
      projectId: location.projectId,
      documentId: location.documentId,
      viewport,
      cancelTimer,
    });
  }

  async function load(
    sheetId: SheetId,
    location: SheetLocation,
  ): Promise<void> {
    loading.add(sheetId);
    try {
      await loadInto(sheetId, location);
    } finally {
      // Only now: recording an error changes the UI state, and that notification must not
      // start a second load of the same sheet.
      loading.delete(sheetId);
    }
  }

  async function loadInto(
    sheetId: SheetId,
    location: SheetLocation,
  ): Promise<void> {
    let result: Awaited<ReturnType<ViewportGateway["getSheetViewport"]>>;
    try {
      result = await gateway.getSheetViewport(
        location.projectId,
        location.documentId,
        sheetId,
      );
    } catch (error) {
      result = operationErr("unexpectedCommandError", String(error));
    }
    // The sheet or project may be gone by now; a stale answer must not resurrect state.
    const stillOpen =
      applicationStore.getState().project?.projectId === location.projectId &&
      sheetExists(location.documentId, sheetId);
    if (!stillOpen) return;
    // A load failure never blocks the canvas: it is reported and the default is used.
    const viewport =
      (result.ok ? result.value.viewport : null) ?? DEFAULT_VIEWPORT;
    // The user may have panned while loading; their value wins.
    if (!uiStateStore.getState().viewportBySheet.has(sheetId)) {
      // Registered before it enters the state so it is not mistaken for a user change.
      seen.set(sheetId, viewport);
      uiStateStore.setState((state) => setViewport(state, sheetId, viewport));
    }
    if (!result.ok) {
      recordFailure("loadViewport", result);
    } else if (result.value.loadIssue !== null) {
      const { kind, detail } = result.value.loadIssue;
      record("loadViewport", kind, detail);
    }
  }

  function reconcileViewports(viewports: UiState["viewportBySheet"]): void {
    for (const [sheetId, viewport] of viewports) {
      if (seen.get(sheetId) === viewport) continue;
      seen.set(sheetId, viewport);
      scheduleSave(sheetId, viewport);
    }
    for (const sheetId of [...seen.keys()]) {
      if (viewports.has(sheetId)) continue;
      seen.delete(sheetId);
      // The sheet / document was closed or removed: keep the last value unless the sheet
      // itself was deleted.
      const entry = pending.get(sheetId);
      if (entry === undefined) continue;
      if (wasDeleted(entry, sheetId)) dropSheet(sheetId);
      else flushSheet(sheetId);
    }
  }

  function currentVisibleSheet(
    ui: UiState,
  ): { sheetId: SheetId; documentId: DocumentId } | null {
    const documentId = ui.activeDocumentId;
    if (documentId === null) return null;
    const sheetId = ui.activeSheetIdByDocument.get(documentId);
    return sheetId === undefined ? null : { sheetId, documentId };
  }

  function onUiStateChange(): void {
    const ui = uiStateStore.getState();
    if (ui.viewportBySheet !== previousViewports) {
      previousViewports = ui.viewportBySheet;
      reconcileViewports(ui.viewportBySheet);
    }
    const visible = currentVisibleSheet(ui);
    const nextVisibleId = visible?.sheetId ?? null;
    if (nextVisibleId !== visibleSheetId) {
      // Switching away is a natural point to save instead of waiting for the timer.
      if (visibleSheetId !== null) flushSheet(visibleSheetId);
      visibleSheetId = nextVisibleId;
    }
    if (
      visible !== null &&
      !ui.viewportBySheet.has(visible.sheetId) &&
      !loading.has(visible.sheetId)
    ) {
      const location = locateSheet(visible.sheetId);
      if (location !== null) void load(visible.sheetId, location);
    }
  }

  const unsubscribe = uiStateStore.subscribe(onUiStateChange);
  // Another subscription may already have shown a sheet before this controller existed.
  onUiStateChange();

  return {
    async flush() {
      for (const sheetId of [...pending.keys()]) flushSheet(sheetId);
      await saveQueue;
    },
    dispose() {
      unsubscribe();
      for (const sheetId of [...pending.keys()]) dropSheet(sheetId);
    },
  };
}
