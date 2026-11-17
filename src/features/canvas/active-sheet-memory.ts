// Remembers which sheet each Document shows, on this computer (local state, never the
// Project), and shows it again when the Document is opened later. Framework-free: it
// watches the UI state, so it needs no component and cannot miss a change.
//
// A Document that appears (opened) starts on the sheet the open chose (the first one);
// the remembered sheet replaces it once known, unless the user has picked another sheet
// meanwhile. That first sheet is not saved: only a change while the Document is open is.

import type { ViewportGateway } from "../../application/ports/viewport-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import {
  setActiveSheet,
  type UiStateStore,
} from "../workspace/ui-state/ui-state";

export interface ActiveSheetMemoryDependencies {
  readonly gateway: Pick<ViewportGateway, "getActiveSheet" | "saveActiveSheet">;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
}

export interface ActiveSheetMemory {
  dispose(): void;
}

const LOADED = "loaded";
// Failures are reported like the other view settings (the sheet and its view are one
// "where I was looking").
const SAVE_FAILURE_LABEL = "saveViewport";

export function createActiveSheetMemory({
  gateway,
  applicationStore,
  uiStateStore,
}: ActiveSheetMemoryDependencies): ActiveSheetMemory {
  let known: ReadonlyMap<DocumentId, SheetId> = new Map(
    uiStateStore.getState().activeSheetIdByDocument,
  );

  function isLoadedSheet(documentId: DocumentId, sheetId: SheetId): boolean {
    return (
      applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.some(
          (entry) => entry.sheetId === sheetId && entry.state === LOADED,
        ) === true
    );
  }

  async function restore(documentId: DocumentId, opened: SheetId) {
    const projectId = applicationStore.getState().project?.projectId;
    if (projectId === undefined) return;
    const remembered = await gateway.getActiveSheet(projectId, documentId);
    // Nothing remembered (or unreadable): the sheet the open chose is right.
    if (!remembered.ok || remembered.value === null) return;
    const wanted = remembered.value;
    const current = uiStateStore
      .getState()
      .activeSheetIdByDocument.get(documentId);
    if (current !== opened || wanted === opened) return;
    if (!isLoadedSheet(documentId, wanted)) return;
    uiStateStore.setState((state) => setActiveSheet(state, documentId, wanted));
  }

  async function save(documentId: DocumentId, sheetId: SheetId) {
    const projectId = applicationStore.getState().project?.projectId;
    if (projectId === undefined) return;
    const saved = await gateway.saveActiveSheet(projectId, documentId, sheetId);
    if (!saved.ok) {
      uiStateStore.setState((state) =>
        addOperationError(state, SAVE_FAILURE_LABEL, null, saved.error),
      );
    }
  }

  const unsubscribe = uiStateStore.subscribe(() => {
    const current = uiStateStore.getState().activeSheetIdByDocument;
    if (current === known) return;
    const previous = known;
    known = current;
    for (const [documentId, sheetId] of current) {
      const before = previous.get(documentId);
      if (before === sheetId) continue;
      if (before === undefined) {
        void restore(documentId, sheetId);
      } else {
        void save(documentId, sheetId);
      }
    }
  });

  return { dispose: unsubscribe };
}
