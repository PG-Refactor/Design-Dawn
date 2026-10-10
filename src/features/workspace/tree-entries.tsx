// The rows below the Project row: folders (which nest) and documents. Split
// from `project-tree.tsx` so the tree view keeps to focus handling and shortcuts.

import type { KeyboardEvent } from "react";
import type { PopupMenuItem } from "../../shared/menu/popup-menu";
import { TreeItem, type TreeItemRenaming } from "./tree-item";
import { type RenamingTarget, sameRenamingTarget } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { MOVE_DIRECTIONS, type MoveDirection } from "./view-models/reorder";
import { documentTreeKey, folderTreeKey } from "./view-models/tree-items";
import type {
  DocumentNode,
  FolderNode,
  TreeEntryNode,
} from "./view-models/tree-model";
import type { WorkspaceActions } from "./workspace-actions";
import type { WorkspaceMessages } from "./workspace-messages";

export interface TreeHandlers {
  readonly actions: WorkspaceActions;
  readonly renaming: RenamingTarget | null;
  // Runs a move, then puts focus back where it was: reordering moves the DOM node, which
  // can drop focus.
  readonly keepFocus: (move: Promise<unknown>) => void;
  readonly rovingKey: string;
  readonly register: (key: string, element: HTMLLIElement | null) => void;
  readonly onFocusItem: (key: string) => void;
  readonly onNavigate: (
    event: KeyboardEvent<HTMLLIElement>,
    key: string,
  ) => void;
}

// The Project row is level 1; every nesting step adds one.
export const PROJECT_ENTRY_LEVEL = 2;

function renamingProps(
  actions: WorkspaceActions,
  isRenaming: boolean,
): TreeItemRenaming | undefined {
  return isRenaming
    ? {
        onSubmit: (name) => void actions.commitRename(name),
        onCancel: actions.cancelRename,
      }
    : undefined;
}

function moveMenuItems(
  messages: WorkspaceMessages,
  canMoveUp: boolean,
  canMoveDown: boolean,
  move: (direction: MoveDirection) => void,
): PopupMenuItem[] {
  return [
    {
      id: "moveUp",
      label: messages.tree.moveUp,
      disabled: !canMoveUp,
      onSelect: () => move(MOVE_DIRECTIONS.up),
    },
    {
      id: "moveDown",
      label: messages.tree.moveDown,
      disabled: !canMoveDown,
      onSelect: () => move(MOVE_DIRECTIONS.down),
    },
  ];
}

function DocumentTreeItem({
  documentNode,
  level,
  handlers,
}: {
  readonly documentNode: DocumentNode;
  readonly level: number;
  readonly handlers: TreeHandlers;
}) {
  const messages = useMessages().workspace;
  const { actions, keepFocus } = handlers;
  const { documentId } = documentNode;
  const itemKey = documentTreeKey(documentId);
  const failed = documentNode.state === "loadFailed";
  const move = (direction: MoveDirection) =>
    keepFocus(actions.moveDocumentBy(documentId, direction));
  const rename = () => void actions.beginRenameDocument(documentId);
  const isRenaming = sameRenamingTarget(handlers.renaming, {
    kind: "document",
    documentId,
  });
  const menuItems: PopupMenuItem[] = [
    {
      id: "rename",
      label: messages.tree.rename,
      disabled: failed,
      onSelect: rename,
    },
    ...moveMenuItems(
      messages,
      documentNode.canMoveUp,
      documentNode.canMoveDown,
      move,
    ),
    {
      id: "moveTo",
      label: messages.tree.moveTo,
      disabled: failed,
      onSelect: () => actions.requestMoveEntry(documentId),
    },
    {
      id: "createSheet",
      label: messages.tree.createSheet,
      // A document that failed to load has no sheets to add to.
      disabled: failed,
      onSelect: () => void actions.requestCreateSheet(documentId),
    },
    {
      id: "delete",
      label: messages.tree.deleteDocument,
      onSelect: () => actions.requestDeleteDocument(documentId),
    },
  ];
  return (
    <TreeItem
      itemKey={itemKey}
      label={documentNode.name ?? messages.tree.unnamedEntity}
      level={level}
      isRoving={handlers.rovingKey === itemKey}
      selected={documentNode.isActive}
      failed={failed}
      register={handlers.register}
      onFocusItem={handlers.onFocusItem}
      onNavigate={handlers.onNavigate}
      onActivate={
        failed ? undefined : () => void actions.openDocument(documentId)
      }
      onRename={failed ? undefined : rename}
      onMove={failed ? undefined : move}
      renaming={renamingProps(actions, isRenaming)}
      menuItems={menuItems}
    />
  );
}

function FolderTreeItem({
  folderNode,
  level,
  handlers,
}: {
  readonly folderNode: FolderNode;
  readonly level: number;
  readonly handlers: TreeHandlers;
}) {
  const messages = useMessages().workspace;
  const { actions, keepFocus } = handlers;
  const { folderId } = folderNode;
  const itemKey = folderTreeKey(folderId);
  const failed = folderNode.state === "loadFailed";
  const move = (direction: MoveDirection) =>
    keepFocus(actions.moveFolderBy(folderId, direction));
  const rename = () => void actions.beginRenameFolder(folderId);
  const isRenaming = sameRenamingTarget(handlers.renaming, {
    kind: "folder",
    folderId,
  });
  const isEmpty = folderNode.children.length === 0;
  const menuItems: PopupMenuItem[] = [
    {
      id: "createFolder",
      label: messages.tree.createFolder,
      disabled: failed,
      onSelect: () => actions.requestCreateFolder(folderId),
    },
    {
      id: "createDocument",
      label: messages.tree.createDocument,
      disabled: failed,
      onSelect: () => actions.requestCreateDocument(folderId),
    },
    {
      id: "rename",
      label: messages.tree.rename,
      disabled: failed,
      onSelect: rename,
    },
    ...moveMenuItems(
      messages,
      folderNode.canMoveUp,
      folderNode.canMoveDown,
      move,
    ),
    {
      id: "moveTo",
      label: messages.tree.moveTo,
      disabled: failed,
      onSelect: () => actions.requestMoveEntry(folderId),
    },
    {
      id: "delete",
      label: messages.tree.deleteFolder,
      disabled: !isEmpty,
      hint: isEmpty ? undefined : messages.tree.deleteFolderNotEmptyHint,
      onSelect: () => actions.requestDeleteFolder(folderId),
    },
  ];
  return (
    <TreeItem
      itemKey={itemKey}
      label={folderNode.name ?? messages.tree.unnamedEntity}
      level={level}
      isRoving={handlers.rovingKey === itemKey}
      expanded={folderNode.isExpanded}
      leadingMarker={
        folderNode.isExpanded
          ? messages.tree.folderExpandedMarker
          : messages.tree.folderCollapsedMarker
      }
      failed={failed}
      register={handlers.register}
      onFocusItem={handlers.onFocusItem}
      onNavigate={handlers.onNavigate}
      // A folder has nothing to open: choosing its row folds or unfolds it.
      onActivate={() => actions.toggleFolder(folderId)}
      onRename={failed ? undefined : rename}
      onMove={failed ? undefined : move}
      renaming={renamingProps(actions, isRenaming)}
      menuItems={menuItems}
    >
      {!folderNode.isExpanded ? null : isEmpty ? (
        <p className="project-tree__empty">{messages.tree.emptyFolder}</p>
      ) : (
        <EntryItems
          entries={folderNode.children}
          level={level + 1}
          handlers={handlers}
        />
      )}
    </TreeItem>
  );
}

export function EntryItems({
  entries,
  level,
  handlers,
}: {
  readonly entries: readonly TreeEntryNode[];
  readonly level: number;
  readonly handlers: TreeHandlers;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the ARIA tree pattern nests items in a role="group" list.
    <ul role="group" className="project-tree__group">
      {entries.map((entry) =>
        entry.kind === "folder" ? (
          <FolderTreeItem
            key={entry.folderId}
            folderNode={entry}
            level={level}
            handlers={handlers}
          />
        ) : (
          <DocumentTreeItem
            key={entry.documentId}
            documentNode={entry}
            level={level}
            handlers={handlers}
          />
        ),
      )}
    </ul>
  );
}
