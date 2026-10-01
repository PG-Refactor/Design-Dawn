// View models of the Document Tabs and Sheet Tabs. Pure; derived from the application
// and UI state.

import type { OperationError } from "../../../application/ports/operation-error";
import type {
  ApplicationState,
  DocumentSessionState,
} from "../../../application/state/application-state";
import type { DocumentId, SheetId } from "../../../domain/shared/entity-id";
import type { UiState } from "../ui-state/ui-state";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface DocumentTab {
  readonly documentId: DocumentId;
  readonly name: string;
  readonly isActive: boolean;
  readonly saveStatus: SaveStatus;
  readonly saveError: OperationError | null;
}

export interface SheetTab {
  readonly sheetId: SheetId;
  readonly name: string;
  readonly isActive: boolean;
}

export interface SheetTabsModel {
  readonly documentId: DocumentId;
  readonly documentName: string;
  readonly tabs: readonly SheetTab[];
  readonly activeSheetId: SheetId | null;
}

type TabsStateInput = Pick<ApplicationState, "documents" | "documentDetails">;
type TabsUiInput = Pick<
  UiState,
  "activeDocumentId" | "activeSheetIdByDocument"
>;

// A failed save stays "error" even while a retry runs or edits continue; saving beats
// merely being unsaved.
export function saveStatusOf(session: DocumentSessionState): SaveStatus {
  const { save } = session;
  if (save.lastError !== null) return "error";
  if (save.saving) return "saving";
  if (save.documentDirty || save.dirtySheetIds.size > 0) return "unsaved";
  return "saved";
}

// Tab order is the order in which the documents were opened: the insertion order of the
// application store's `documents` map (not duplicated anywhere).
export function selectDocumentTabs(
  application: TabsStateInput,
  ui: Pick<UiState, "activeDocumentId">,
): readonly DocumentTab[] {
  return [...application.documents.values()].map((session): DocumentTab => {
    const documentId = session.document.documentId;
    return {
      documentId,
      name: session.document.name,
      isActive: ui.activeDocumentId === documentId,
      saveStatus: saveStatusOf(session),
      saveError: session.save.lastError,
    };
  });
}

// Only sheets that loaded are tabs; sheets that failed to load appear in the tree and
// the notifications (where they can be deleted).
export function selectSheetTabs(
  application: TabsStateInput,
  ui: TabsUiInput,
): SheetTabsModel | null {
  const documentId = ui.activeDocumentId;
  if (documentId === null) return null;
  const session = application.documents.get(documentId);
  if (session === undefined) return null;
  const entries =
    application.documentDetails.get(documentId)?.sheetEntries ?? [];
  const loaded = entries.filter((entry) => entry.state === "loaded");
  const activeId = ui.activeSheetIdByDocument.get(documentId) ?? null;
  const activeSheetId = loaded.some((entry) => entry.sheetId === activeId)
    ? activeId
    : null;
  return {
    documentId,
    documentName: session.document.name,
    activeSheetId,
    tabs: loaded.map(
      (entry): SheetTab => ({
        sheetId: entry.sheetId,
        name: entry.name ?? "",
        isActive: entry.sheetId === activeSheetId,
      }),
    ),
  };
}

// The sheet to show when a document is activated and none is remembered, or when the
// active one disappeared: the first loaded sheet in sheet order.
export function firstLoadedSheetId(
  application: Pick<ApplicationState, "documentDetails">,
  documentId: DocumentId,
): SheetId | null {
  const entries =
    application.documentDetails.get(documentId)?.sheetEntries ?? [];
  return entries.find((entry) => entry.state === "loaded")?.sheetId ?? null;
}
