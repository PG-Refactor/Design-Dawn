// View model of the Project Tree: project -> documents -> sheets (sheets only for open
// documents, because unopened documents have not been read yet). Pure; derived from the
// application and UI state, never stored.

import type { EntityState } from "../../../application/ports/persistence-types";
import type { ApplicationState } from "../../../application/state/application-state";
import type { DocumentId, SheetId } from "../../../domain/shared/entity-id";
import type { UiState } from "../ui-state/ui-state";
import { MESSAGES } from "../workspace-messages";
import { canMoveOneStep, MOVE_DIRECTIONS } from "./reorder";

export interface SheetNode {
  readonly sheetId: SheetId;
  readonly name: string;
  readonly state: EntityState;
  readonly isActive: boolean;
  // Moving by one place is possible: not at the boundary, and the sheet loaded.
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

export interface DocumentNode {
  readonly documentId: DocumentId;
  readonly name: string;
  readonly state: EntityState;
  readonly isOpen: boolean;
  readonly isActive: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  // Empty unless the document is open.
  readonly sheets: readonly SheetNode[];
}

export interface ProjectTreeModel {
  readonly projectName: string;
  readonly documents: readonly DocumentNode[];
}

export type TreeStateInput = Pick<
  ApplicationState,
  "project" | "documents" | "documentDetails"
>;
export type TreeUiInput = Pick<
  UiState,
  "activeDocumentId" | "activeSheetIdByDocument"
>;

export function selectProjectTree(
  application: TreeStateInput,
  ui: TreeUiInput,
): ProjectTreeModel | null {
  const project = application.project;
  if (project === null) return null;
  const order = project.project.childOrder;
  // Entries the order does not list stay behind the listed ones (stable sort).
  const position = (documentId: DocumentId): number => {
    const index = order.indexOf(documentId);
    return index < 0 ? order.length : index;
  };
  // Documents inside Folders are not shown until the Tree can show Folders; only the
  // Project's direct Documents are listed, ordered by the order that also lists Folders.
  const rootDocuments = project.documents.filter(
    (entry) => entry.parentFolderId === null,
  );
  const entries = [...rootDocuments].sort(
    (first, second) => position(first.documentId) - position(second.documentId),
  );
  return {
    projectName: project.project.name,
    documents: entries.map((entry): DocumentNode => {
      const isOpen = application.documents.has(entry.documentId);
      const isActive = isOpen && ui.activeDocumentId === entry.documentId;
      const activeSheetId = ui.activeSheetIdByDocument.get(entry.documentId);
      const sheetOrder =
        application.documents.get(entry.documentId)?.document.sheetOrder ?? [];
      const sheetEntries = isOpen
        ? (application.documentDetails.get(entry.documentId)?.sheetEntries ??
          [])
        : [];
      return {
        documentId: entry.documentId,
        // The open document's current name follows rename commands.
        name: entry.name ?? MESSAGES.tree.unnamedEntity,
        state: entry.state,
        isOpen,
        isActive,
        canMoveUp:
          entry.state === "loaded" &&
          canMoveOneStep(order, entry.documentId, MOVE_DIRECTIONS.up),
        canMoveDown:
          entry.state === "loaded" &&
          canMoveOneStep(order, entry.documentId, MOVE_DIRECTIONS.down),
        sheets: sheetEntries.map(
          (sheet): SheetNode => ({
            sheetId: sheet.sheetId,
            name: sheet.name ?? MESSAGES.tree.unnamedEntity,
            state: sheet.state,
            isActive: isActive && activeSheetId === sheet.sheetId,
            canMoveUp:
              sheet.state === "loaded" &&
              canMoveOneStep(sheetOrder, sheet.sheetId, MOVE_DIRECTIONS.up),
            canMoveDown:
              sheet.state === "loaded" &&
              canMoveOneStep(sheetOrder, sheet.sheetId, MOVE_DIRECTIONS.down),
          }),
        ),
      };
    }),
  };
}
