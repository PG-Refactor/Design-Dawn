// View model of the Project Tree: project -> documents -> sheets (sheets only for open
// documents, because unopened documents have not been read yet). Pure; derived from the
// application and UI state, never stored.

import type { EntityState } from "../../../application/ports/persistence-types";
import type { ApplicationState } from "../../../application/state/application-state";
import type { DocumentId, SheetId } from "../../../domain/shared/entity-id";
import type { UiState } from "../ui-state/ui-state";
import { MESSAGES } from "../workspace-messages";

export interface SheetNode {
  readonly sheetId: SheetId;
  readonly name: string;
  readonly state: EntityState;
  readonly isActive: boolean;
}

export interface DocumentNode {
  readonly documentId: DocumentId;
  readonly name: string;
  readonly state: EntityState;
  readonly isOpen: boolean;
  readonly isActive: boolean;
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
  const order = project.project.documentOrder;
  // Entries the order does not list stay behind the listed ones (stable sort).
  const position = (documentId: DocumentId): number => {
    const index = order.indexOf(documentId);
    return index < 0 ? order.length : index;
  };
  const entries = [...project.documents].sort(
    (first, second) => position(first.documentId) - position(second.documentId),
  );
  return {
    projectName: project.project.name,
    documents: entries.map((entry): DocumentNode => {
      const isOpen = application.documents.has(entry.documentId);
      const isActive = isOpen && ui.activeDocumentId === entry.documentId;
      const activeSheetId = ui.activeSheetIdByDocument.get(entry.documentId);
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
        sheets: sheetEntries.map(
          (sheet): SheetNode => ({
            sheetId: sheet.sheetId,
            name: sheet.name ?? MESSAGES.tree.unnamedEntity,
            state: sheet.state,
            isActive: isActive && activeSheetId === sheet.sheetId,
          }),
        ),
      };
    }),
  };
}
