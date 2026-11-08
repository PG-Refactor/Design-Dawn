// Restores and saves the per-sheet viewport (zoom and position). Framework-free: it watches
// the UI state and application stores, so it needs no component and cannot miss a change.
//
// The viewport stays UI state. This controller only copies it to / from the viewport
// gateway: a sheet that becomes visible without a viewport gets the saved one (or the
// default). A change is kept as unsaved and saved together with its Document: when a save
// of that Document completes (auto-save, a save on close, Ctrl+S), or on an explicit save
// of everything (`flush`, which Ctrl+S and File > Save call even when no content changed).
// A view that was never saved that way is gone when the Document closes or the app quits,
// so the next time the sheet opens with the view saved last, as unsaved content would.
// Nothing here touches Domain values or undo history.

import type { Viewport } from "../../application/local-state/viewport";
import {
  type OperationErrorKind,
  type OperationResult,
  operationErr,
} from "../../application/ports/operation-error";
import type { ViewportGateway } from "../../application/ports/viewport-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
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
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
}

export interface ViewportPersistence {
  // Saves every unsaved viewport now (an explicit save) and resolves when all saves have
  // finished.
  flush(): Promise<void>;
  // Waits for the saves already started (views taken along by a Document save) without
  // saving anything that is still unsaved: what a closing window does.
  waitForSaves(): Promise<void>;
  // Stops watching and forgets what is unsaved WITHOUT saving; call `flush` first when
  // needed.
  dispose(): void;
}

interface SheetLocation {
  readonly projectId: ProjectId;
  readonly documentId: DocumentId;
}

interface PendingSave extends SheetLocation {
  readonly viewport: Viewport;
}

export function createViewportPersistence(
  dependencies: ViewportPersistenceDependencies,
): ViewportPersistence {
  const { gateway, applicationStore, uiStateStore } = dependencies;

  // Viewports already reconciled with the state: a change is anything not in here.
  const seen = new Map<SheetId, Viewport>();
  const pending = new Map<SheetId, PendingSave>();
  const loading = new Set<SheetId>();
  let previousViewports: UiState["viewportBySheet"] | null = null;
  // Documents that had something unsaved (or were saving) at the last look, to see a save
  // of them complete.
  const unsavedDocuments = new Set<DocumentId>();
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
    pending.delete(sheetId);
    enqueueSave(sheetId, entry);
  }

  function flushDocument(documentId: DocumentId): void {
    for (const [sheetId, entry] of [...pending]) {
      if (entry.documentId === documentId) flushSheet(sheetId);
    }
  }

  function keepUnsaved(sheetId: SheetId, viewport: Viewport): void {
    const location = locateSheet(sheetId) ?? pending.get(sheetId);
    if (location === undefined || location === null) return;
    pending.set(sheetId, {
      projectId: location.projectId,
      documentId: location.documentId,
      viewport,
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
      keepUnsaved(sheetId, viewport);
    }
    for (const sheetId of [...seen.keys()]) {
      if (viewports.has(sheetId)) continue;
      seen.delete(sheetId);
      // The sheet or its document was closed or deleted. A save made while closing was
      // seen before (and took the view along); anything still unsaved is dropped.
      pending.delete(sheetId);
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
    if (
      visible !== null &&
      !ui.viewportBySheet.has(visible.sheetId) &&
      !loading.has(visible.sheetId)
    ) {
      const location = locateSheet(visible.sheetId);
      if (location !== null) void load(visible.sheetId, location);
    }
  }

  // A Document whose save just completed (it had something unsaved or was saving, and now
  // has nothing unsaved and no error) takes its sheets' views along.
  function onApplicationChange(): void {
    const { documents } = applicationStore.getState();
    for (const [documentId, session] of documents) {
      const { save } = session;
      const unsaved =
        save.saving ||
        save.documentDirty ||
        save.dirtySheetIds.size > 0 ||
        save.dirtyContentBlockIds.size > 0;
      if (unsaved) {
        unsavedDocuments.add(documentId);
      } else if (
        unsavedDocuments.delete(documentId) &&
        save.lastError === null
      ) {
        flushDocument(documentId);
      }
    }
    for (const documentId of [...unsavedDocuments]) {
      if (!documents.has(documentId)) unsavedDocuments.delete(documentId);
    }
  }

  const unsubscribeUi = uiStateStore.subscribe(onUiStateChange);
  const unsubscribeApplication =
    applicationStore.subscribe(onApplicationChange);
  // Another subscription may already have shown a sheet before this controller existed.
  onUiStateChange();
  onApplicationChange();

  return {
    async flush() {
      for (const sheetId of [...pending.keys()]) flushSheet(sheetId);
      await saveQueue;
    },
    async waitForSaves() {
      await saveQueue;
    },
    dispose() {
      unsubscribeUi();
      unsubscribeApplication();
      pending.clear();
    },
  };
}
