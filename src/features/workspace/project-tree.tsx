import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { CANVAS_KEY_COMMANDS, keyCommandOf } from "../canvas/canvas-keyboard";
import { restoreFocus } from "./focus-utils";
import {
  EntryItems,
  PROJECT_ENTRY_LEVEL,
  type TreeHandlers,
} from "./tree-entries";
import { TreeItem } from "./tree-item";
import { treeNavigation } from "./view-models/keyboard-navigation";
import {
  documentTreeKey,
  flattenProjectTree,
  folderTreeKey,
  PROJECT_TREE_KEY,
} from "./view-models/tree-items";
import {
  type ProjectTreeModel,
  selectProjectTree,
  type TreeEntryNode,
} from "./view-models/tree-model";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./project-tree.css";

// The key of the item that is currently selected, where the tab stop starts. Only the
// items that are visible count: the active document inside a folded folder is not.
function activeKeyOf(entries: readonly TreeEntryNode[]): string | null {
  for (const entry of entries) {
    if (entry.kind === "folder") {
      const inside = entry.isExpanded ? activeKeyOf(entry.children) : null;
      if (inside !== null) return inside;
      continue;
    }
    if (!entry.isActive) continue;
    return documentTreeKey(entry.documentId);
  }
  return null;
}

// Finds the node a navigation key landed on, to act on it.
function findEntryByKey(
  entries: readonly TreeEntryNode[],
  key: string,
): TreeEntryNode | null {
  for (const entry of entries) {
    const entryKey =
      entry.kind === "folder"
        ? folderTreeKey(entry.folderId)
        : documentTreeKey(entry.documentId);
    if (entryKey === key) return entry;
    if (entry.kind === "folder") {
      const inside = findEntryByKey(entry.children, key);
      if (inside !== null) return inside;
    }
  }
  return null;
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
      : (activeKeyOf(model.entries) ?? PROJECT_TREE_KEY);

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
    const entry = findEntryByKey(model.entries, target.key);
    if (entry === null) return;
    if (entry.kind === "folder") {
      actions.setFolderExpanded(entry.folderId, navigation.action === "expand");
    } else {
      void actions.openDocument(entry.documentId);
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
        level={1}
        isRoving={rovingKey === PROJECT_TREE_KEY}
        expanded
        register={register}
        onFocusItem={setFocusedKey}
        onNavigate={handleNavigate}
        menuItems={[
          {
            id: "createFolder",
            label: MESSAGES.tree.createFolder,
            onSelect: () => actions.requestCreateFolder(null),
          },
          {
            id: "createDocument",
            label: MESSAGES.tree.createDocument,
            onSelect: () => actions.requestCreateDocument(null),
          },
        ]}
      >
        {model.entries.length === 0 ? (
          <p className="project-tree__empty">{MESSAGES.tree.emptyProject}</p>
        ) : (
          <EntryItems
            entries={model.entries}
            level={PROJECT_ENTRY_LEVEL}
            handlers={handlers}
          />
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
