// The rows below the Project row: folders (which nest), documents and their sheets. Split
// from `project-tree.tsx` so the tree view keeps to focus handling and shortcuts.

import type { KeyboardEvent } from "react";
import type { PopupMenuItem } from "../../shared/menu/popup-menu";
import { TreeItem, type TreeItemRenaming } from "./tree-item";
import { type RenamingTarget, sameRenamingTarget } from "./ui-state/ui-state";
import { MOVE_DIRECTIONS, type MoveDirection } from "./view-models/reorder";
import {
  documentTreeKey,
  folderTreeKey,
  sheetTreeKey,
} from "./view-models/tree-items";
import type {
  DocumentNode,
  FolderNode,
  SheetNode,
  TreeEntryNode,
} from "./view-models/tree-model";
import type { WorkspaceActions } from "./workspace-actions";
import { MESSAGES } from "./workspace-messages";

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
  canMoveUp: boolean,
  canMoveDown: boolean,
  move: (direction: MoveDirection) => void,
): PopupMenuItem[] {
  return [
    {
      id: "moveUp",
      label: MESSAGES.tree.moveUp,
      disabled: !canMoveUp,
      onSelect: () => move(MOVE_DIRECTIONS.up),
    },
    {
      id: "moveDown",
      label: MESSAGES.tree.moveDown,
      disabled: !canMoveDown,
      onSelect: () => move(MOVE_DIRECTIONS.down),
    },
  ];
}

function SheetTreeItem({
  documentNode,
  sheetNode,
  level,
  handlers,
}: {
  readonly documentNode: DocumentNode;
  readonly sheetNode: SheetNode;
  readonly level: number;
  readonly handlers: TreeHandlers;
}) {
  const { actions, keepFocus } = handlers;
  const { documentId } = documentNode;
  const { sheetId } = sheetNode;
  const itemKey = sheetTreeKey(documentId, sheetId);
  const failed = sheetNode.state === "loadFailed";
  const move = (direction: MoveDirection) =>
    keepFocus(actions.moveSheetBy(documentId, sheetId, direction));
  const rename = () => void actions.beginRenameSheet(documentId, sheetId);
  const isRenaming = sameRenamingTarget(handlers.renaming, {
    kind: "sheet",
    documentId,
    sheetId,
  });
  return (
    <TreeItem
      itemKey={itemKey}
      label={sheetNode.name}
      level={level}
      isRoving={handlers.rovingKey === itemKey}
      selected={failed ? false : sheetNode.isActive}
      failed={failed}
      register={handlers.register}
      onFocusItem={handlers.onFocusItem}
      onNavigate={handlers.onNavigate}
      onActivate={
        failed ? undefined : () => void actions.selectSheet(documentId, sheetId)
      }
      onRename={failed ? undefined : rename}
      onMove={failed ? undefined : move}
      renaming={renamingProps(actions, isRenaming)}
      menuItems={[
        {
          id: "rename",
          label: MESSAGES.tree.rename,
          disabled: failed,
          onSelect: rename,
        },
        ...moveMenuItems(sheetNode.canMoveUp, sheetNode.canMoveDown, move),
        {
          id: "delete",
          label: MESSAGES.tree.deleteSheet,
          onSelect: () => actions.requestDeleteSheet(documentId, sheetId),
        },
      ]}
    />
  );
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
  // An open document is held by its session and its tab, so it is closed before it moves.
  const moveBlockedByOpen = !failed && documentNode.isOpen;
  const menuItems: PopupMenuItem[] = [
    {
      id: "rename",
      label: MESSAGES.tree.rename,
      disabled: failed,
      onSelect: rename,
    },
    ...moveMenuItems(documentNode.canMoveUp, documentNode.canMoveDown, move),
    {
      id: "moveTo",
      label: MESSAGES.tree.moveTo,
      disabled: failed || moveBlockedByOpen,
      hint: moveBlockedByOpen ? MESSAGES.tree.moveOpenHint : undefined,
      onSelect: () => actions.requestMoveEntry(documentId),
    },
    {
      id: "createSheet",
      label: MESSAGES.tree.createSheet,
      // A document that failed to load has no sheets to add to.
      disabled: failed,
      onSelect: () => void actions.requestCreateSheet(documentId),
    },
    {
      id: "delete",
      label: MESSAGES.tree.deleteDocument,
      onSelect: () => actions.requestDeleteDocument(documentId),
    },
  ];
  return (
    <TreeItem
      itemKey={itemKey}
      label={documentNode.name}
      level={level}
      isRoving={handlers.rovingKey === itemKey}
      selected={documentNode.isActive}
      expanded={failed ? undefined : documentNode.isOpen}
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
    >
      {documentNode.sheets.length > 0 ? (
        // biome-ignore lint/a11y/useSemanticElements: the ARIA tree pattern nests items in a role="group" list.
        <ul role="group" className="project-tree__group">
          {documentNode.sheets.map((sheetNode) => (
            <SheetTreeItem
              key={sheetNode.sheetId}
              documentNode={documentNode}
              sheetNode={sheetNode}
              level={level + 1}
              handlers={handlers}
            />
          ))}
        </ul>
      ) : null}
    </TreeItem>
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
  const moveBlockedByOpen = !failed && folderNode.holdsOpenDocument;
  const menuItems: PopupMenuItem[] = [
    {
      id: "createFolder",
      label: MESSAGES.tree.createFolder,
      disabled: failed,
      onSelect: () => actions.requestCreateFolder(folderId),
    },
    {
      id: "createDocument",
      label: MESSAGES.tree.createDocument,
      disabled: failed,
      onSelect: () => actions.requestCreateDocument(folderId),
    },
    {
      id: "rename",
      label: MESSAGES.tree.rename,
      disabled: failed,
      onSelect: rename,
    },
    ...moveMenuItems(folderNode.canMoveUp, folderNode.canMoveDown, move),
    {
      id: "moveTo",
      label: MESSAGES.tree.moveTo,
      disabled: failed || moveBlockedByOpen,
      hint: moveBlockedByOpen ? MESSAGES.tree.moveOpenHint : undefined,
      onSelect: () => actions.requestMoveEntry(folderId),
    },
    {
      id: "delete",
      label: MESSAGES.tree.deleteFolder,
      disabled: !isEmpty,
      hint: isEmpty ? undefined : MESSAGES.tree.deleteFolderNotEmptyHint,
      onSelect: () => actions.requestDeleteFolder(folderId),
    },
  ];
  return (
    <TreeItem
      itemKey={itemKey}
      label={folderNode.name}
      level={level}
      isRoving={handlers.rovingKey === itemKey}
      expanded={folderNode.isExpanded}
      leadingMarker={
        folderNode.isExpanded
          ? MESSAGES.tree.folderExpandedMarker
          : MESSAGES.tree.folderCollapsedMarker
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
        <p className="project-tree__empty">{MESSAGES.tree.emptyFolder}</p>
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
