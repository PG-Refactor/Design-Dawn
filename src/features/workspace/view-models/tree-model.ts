// View model of the Project Tree: project -> folders / documents (folders nest) -> sheets
// (sheets only for open documents, because unopened documents have not been read yet). Pure; derived from the
// application and UI state, never stored.

import type { EntityState } from "../../../application/ports/persistence-types";
import type {
  ApplicationState,
  OpenProjectState,
} from "../../../application/state/application-state";
import type { ParentId } from "../../../application/workspace/project-entries";
import type {
  DocumentId,
  EntryId,
  FolderId,
  SheetId,
} from "../../../domain/shared/entity-id";
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
  readonly kind: "document";
  readonly documentId: DocumentId;
  readonly name: string;
  readonly state: EntityState;
  readonly isOpen: boolean;
  readonly isActive: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  // Sheets of an open document; empty otherwise.
  readonly sheets: readonly SheetNode[];
}

export interface FolderNode {
  readonly kind: "folder";
  readonly folderId: FolderId;
  readonly name: string;
  readonly state: EntityState;
  readonly isExpanded: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly children: readonly TreeEntryNode[];
}

export type TreeEntryNode = FolderNode | DocumentNode;

export interface ProjectTreeModel {
  readonly projectName: string;
  // The Project's direct children, in the order of `project.childOrder`.
  readonly entries: readonly TreeEntryNode[];
}

export type TreeStateInput = Pick<
  ApplicationState,
  "project" | "documents" | "documentDetails"
>;
export type TreeUiInput = Pick<
  UiState,
  "activeDocumentId" | "activeSheetIdByDocument" | "collapsedFolderIds"
>;

function selectDocumentNode(
  entry: OpenProjectState["documents"][number],
  order: readonly EntryId[],
  application: TreeStateInput,
  ui: TreeUiInput,
): DocumentNode {
  const isOpen = application.documents.has(entry.documentId);
  const isActive = isOpen && ui.activeDocumentId === entry.documentId;
  const activeSheetId = ui.activeSheetIdByDocument.get(entry.documentId);
  const sheetOrder =
    application.documents.get(entry.documentId)?.document.sheetOrder ?? [];
  const sheetEntries = isOpen
    ? (application.documentDetails.get(entry.documentId)?.sheetEntries ?? [])
    : [];
  return {
    kind: "document",
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
}

// The children of one parent (the Project or a Folder), Folders and Documents mixed in the
// order of the parent's `childOrder`. Entries the order does not list stay behind the
// listed ones (stable sort). The folder tree is a forest (checked when the project is
// opened), so the recursion ends.
function selectChildren(
  project: OpenProjectState,
  parentId: ParentId,
  order: readonly EntryId[],
  application: TreeStateInput,
  ui: TreeUiInput,
): readonly TreeEntryNode[] {
  const position = (id: EntryId): number => {
    const index = order.indexOf(id);
    return index < 0 ? order.length : index;
  };
  const children: { readonly id: EntryId; readonly node: TreeEntryNode }[] = [
    ...project.folders
      .filter((entry) => entry.parentFolderId === parentId)
      .map((entry) => ({
        id: entry.folderId as EntryId,
        node: selectFolderNode(project, entry, order, application, ui),
      })),
    ...project.documents
      .filter((entry) => entry.parentFolderId === parentId)
      .map((entry) => ({
        id: entry.documentId as EntryId,
        node: selectDocumentNode(entry, order, application, ui),
      })),
  ];
  return children
    .sort((first, second) => position(first.id) - position(second.id))
    .map((child) => child.node);
}

function selectFolderNode(
  project: OpenProjectState,
  entry: OpenProjectState["folders"][number],
  siblingOrder: readonly EntryId[],
  application: TreeStateInput,
  ui: TreeUiInput,
): FolderNode {
  const loaded = entry.state === "loaded";
  return {
    kind: "folder",
    folderId: entry.folderId,
    name: entry.name ?? MESSAGES.tree.unnamedEntity,
    state: entry.state,
    isExpanded: !ui.collapsedFolderIds.has(entry.folderId),
    canMoveUp:
      loaded &&
      canMoveOneStep(siblingOrder, entry.folderId, MOVE_DIRECTIONS.up),
    canMoveDown:
      loaded &&
      canMoveOneStep(siblingOrder, entry.folderId, MOVE_DIRECTIONS.down),
    children: selectChildren(
      project,
      entry.folderId,
      entry.childOrder,
      application,
      ui,
    ),
  };
}

export function selectProjectTree(
  application: TreeStateInput,
  ui: TreeUiInput,
): ProjectTreeModel | null {
  const project = application.project;
  if (project === null) return null;
  return {
    projectName: project.project.name,
    entries: selectChildren(
      project,
      null,
      project.project.childOrder,
      application,
      ui,
    ),
  };
}
