import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { PopupMenuItem } from "../../shared/menu/popup-menu";
import { CANVAS_KEY_COMMANDS, keyCommandOf } from "../canvas/canvas-keyboard";
import { restoreFocus } from "./focus-utils";
import { TreeItem, type TreeItemRenaming } from "./tree-item";
import { type RenamingTarget, sameRenamingTarget } from "./ui-state/ui-state";
import { treeNavigation } from "./view-models/keyboard-navigation";
import { MOVE_DIRECTIONS, type MoveDirection } from "./view-models/reorder";
import {
  documentTreeKey,
  flattenProjectTree,
  PROJECT_TREE_KEY,
  sheetTreeKey,
} from "./view-models/tree-items";
import {
  type DocumentNode,
  type ProjectTreeModel,
  type SheetNode,
  selectProjectTree,
} from "./view-models/tree-model";
import type { WorkspaceActions } from "./workspace-actions";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./project-tree.css";

// The key of the item that is currently selected, where the tab stop starts.
function activeKeyOf(model: ProjectTreeModel): string {
  for (const documentNode of model.documents) {
    if (!documentNode.isActive) continue;
    const activeSheet = documentNode.sheets.find((sheet) => sheet.isActive);
    return activeSheet === undefined
      ? documentTreeKey(documentNode.documentId)
      : sheetTreeKey(documentNode.documentId, activeSheet.sheetId);
  }
  return PROJECT_TREE_KEY;
}

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

interface TreeHandlers {
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

function SheetTreeItem({
  documentNode,
  sheetNode,
  handlers,
}: {
  readonly documentNode: DocumentNode;
  readonly sheetNode: SheetNode;
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
  handlers,
}: {
  readonly documentNode: DocumentNode;
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
  const menuItems: PopupMenuItem[] = [
    {
      id: "rename",
      label: MESSAGES.tree.rename,
      disabled: failed,
      onSelect: rename,
    },
    ...moveMenuItems(documentNode.canMoveUp, documentNode.canMoveDown, move),
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
              handlers={handlers}
            />
          ))}
        </ul>
      ) : null}
    </TreeItem>
  );
}

function ProjectTreeView({ model }: { readonly model: ProjectTreeModel }) {
  const { actions, canvasActions, uiStateStore } = useWorkspaceServices();
  const renaming = useUiState((ui) => ui.renaming);
  const items = useMemo(() => flattenProjectTree(model), [model]);
  const itemElements = useRef(new Map<string, HTMLLIElement>());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const rovingKey =
    focusedKey !== null && items.some((item) => item.key === focusedKey)
      ? focusedKey
      : activeKeyOf(model);

  function register(key: string, element: HTMLLIElement | null): void {
    if (element === null) itemElements.current.delete(key);
    else itemElements.current.set(key, element);
  }

  function handleNavigate(
    event: KeyboardEvent<HTMLLIElement>,
    key: string,
  ): void {
    const navigation = treeNavigation(
      event.key,
      items,
      items.findIndex((item) => item.key === key),
    );
    if (navigation === null) return;
    event.preventDefault();
    const target = items[navigation.index];
    if (target === undefined) return;
    if (navigation.action === "focus") {
      itemElements.current.get(target.key)?.focus();
      return;
    }
    const documentNode = model.documents.find(
      (candidate) => documentTreeKey(candidate.documentId) === target.key,
    );
    if (documentNode !== undefined) {
      void actions.openDocument(documentNode.documentId);
    }
  }

  function keepFocus(move: Promise<unknown>): void {
    const previous = document.activeElement;
    void move.then(() => {
      if (document.activeElement !== previous) restoreFocus(previous);
    });
  }

  // Ctrl/Cmd+Z / Shift+Z / Y with focus in the tree undo / redo the ACTIVE document's
  // history, the same as on the canvas. Typing in the rename input never gets here (the
  // input keeps its key events).
  function handleHistoryKey(event: KeyboardEvent<HTMLUListElement>): void {
    const command = keyCommandOf(event);
    if (
      command !== CANVAS_KEY_COMMANDS.undo &&
      command !== CANVAS_KEY_COMMANDS.redo
    ) {
      return;
    }
    event.preventDefault();
    const documentId = uiStateStore.getState().activeDocumentId;
    if (documentId === null) return;
    void (command === CANVAS_KEY_COMMANDS.undo
      ? canvasActions.undo(documentId)
      : canvasActions.redo(documentId));
  }

  const handlers: TreeHandlers = {
    actions,
    renaming,
    keepFocus,
    rovingKey,
    register,
    onFocusItem: setFocusedKey,
    onNavigate: handleNavigate,
  };

  return (
    <ul
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA tree pattern puts role="tree" on a list.
      role="tree"
      aria-label={MESSAGES.appRegionTreeLabel}
      className="project-tree"
      onKeyDown={handleHistoryKey}
    >
      <TreeItem
        itemKey={PROJECT_TREE_KEY}
        label={model.projectName}
        isRoving={rovingKey === PROJECT_TREE_KEY}
        expanded
        register={register}
        onFocusItem={setFocusedKey}
        onNavigate={handleNavigate}
        menuItems={[
          {
            id: "createDocument",
            label: MESSAGES.tree.createDocument,
            onSelect: actions.requestCreateDocument,
          },
        ]}
      >
        {model.documents.length === 0 ? (
          <p className="project-tree__empty">{MESSAGES.tree.emptyProject}</p>
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA tree pattern nests items in a role="group" list.
          <ul role="group" className="project-tree__group">
            {model.documents.map((documentNode) => (
              <DocumentTreeItem
                key={documentNode.documentId}
                documentNode={documentNode}
                handlers={handlers}
              />
            ))}
          </ul>
        )}
      </TreeItem>
    </ul>
  );
}

export function ProjectTree() {
  const model = useWorkspaceModel(selectProjectTree);
  return model === null ? (
    <p className="project-tree__empty">{MESSAGES.tree.noProject}</p>
  ) : (
    <ProjectTreeView model={model} />
  );
}
