// View model of the Project Tree: project -> folders / documents (folders nest). Sheets
// are not tree rows: they are chosen in the Sheet Tabs. Pure; derived from the application
// and UI state, never stored.

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
} from "../../../domain/shared/entity-id";
import type { UiState } from "../ui-state/ui-state";
import { canMoveOneStep, MOVE_DIRECTIONS } from "./reorder";

export interface DocumentNode {
  readonly kind: "document";
  readonly documentId: DocumentId;
  // null = the name could not be loaded; the text for it is chosen at render time.
  readonly name: string | null;
  readonly state: EntityState;
  readonly isOpen: boolean;
  readonly isActive: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

export interface FolderNode {
  readonly kind: "folder";
  readonly folderId: FolderId;
  // null = the name could not be loaded; the text for it is chosen at render time.
  readonly name: string | null;
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
  "activeDocumentId" | "collapsedFolderIds"
>;

function selectDocumentNode(
  entry: OpenProjectState["documents"][number],
  order: readonly EntryId[],
  application: TreeStateInput,
  ui: TreeUiInput,
): DocumentNode {
  const isOpen = application.documents.has(entry.documentId);
  const isActive = isOpen && ui.activeDocumentId === entry.documentId;
  return {
    kind: "document",
    documentId: entry.documentId,
    // The open document's current name follows rename commands.
    name: entry.name,
    state: entry.state,
    isOpen,
    isActive,
    canMoveUp:
      entry.state === "loaded" &&
      canMoveOneStep(order, entry.documentId, MOVE_DIRECTIONS.up),
    canMoveDown:
      entry.state === "loaded" &&
      canMoveOneStep(order, entry.documentId, MOVE_DIRECTIONS.down),
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
    name: entry.name,
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
