import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { EntryId } from "../../domain/shared/entity-id";
import { useContextMenu } from "../../shared/menu/context-menu";
import { CANVAS_KEY_COMMANDS, keyCommandOf } from "../canvas/canvas-keyboard";
import { restoreFocus } from "./focus-utils";
import {
  EntryItems,
  PROJECT_ENTRY_LEVEL,
  type TreeHandlers,
  type TreeRowDrag,
} from "./tree-entries";
import { NewDocumentIcon, NewFolderIcon, ProjectIcon } from "./tree-icons";
import { type TreeChooseMode, TreeItem } from "./tree-item";
import { useMessages } from "./use-messages";
import { type TreeRowKind, useTreeDrag } from "./use-tree-drag";
import { treeNavigation } from "./view-models/keyboard-navigation";
import {
  movableKeys,
  type TreeDropRow,
  treeMoveTargetOf,
} from "./view-models/tree-drag";
import {
  creationTargetOf,
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
import {
  EMPTY_TREE_SELECTION,
  selectOnly,
  selectRange,
  toggleSelected,
  visibleSelection,
} from "./view-models/tree-selection";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { useWorkspaceServices } from "./workspace-services-context";
import "./project-tree.css";

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

function entryIdOf(entry: TreeEntryNode): EntryId {
  return entry.kind === "folder" ? entry.folderId : entry.documentId;
}

// Whether a pointer event happened on a row (or inside one) rather than on the empty part
// of the tree.
function isOnRow(target: EventTarget): boolean {
  return (
    target instanceof Element && target.closest('[role="treeitem"]') !== null
  );
}

function ProjectTreeView({ model }: { readonly model: ProjectTreeModel }) {
  const messages = useMessages().workspace;
  const { actions, canvasActions, uiStateStore } = useWorkspaceServices();
  const renaming = useUiState((ui) => ui.renaming);
  const storedSelection = useUiState((ui) => ui.treeSelection);
  const activeDocumentId = useUiState((ui) => ui.activeDocumentId);
  const items = useMemo(() => flattenProjectTree(model), [model]);
  const itemElements = useRef(new Map<string, HTMLLIElement>());
  const areaElement = useRef<HTMLDivElement | null>(null);
  const contextMenu = useContextMenu();
  const visibleKeys = useMemo(() => items.map((item) => item.key), [items]);
  // A row that is gone (deleted, or inside a folded folder) is not chosen any more.
  const selection = visibleSelection(storedSelection, visibleKeys);
  const rovingKey = selection.activeKey ?? PROJECT_TREE_KEY;

  // The choice follows the active Document (a tab chosen, a Document opened), as the
  // Explorer of VS Code does. Choosing another row or the empty space changes it again.
  useEffect(() => {
    if (activeDocumentId !== null)
      actions.revealDocumentInTree(activeDocumentId);
  }, [activeDocumentId, actions]);

  // How a click, a right-click or a key chooses rows.
  function choose(key: string, mode: TreeChooseMode): void {
    switch (mode) {
      case "replace":
        actions.setTreeSelection(selectOnly(key));
        return;
      case "toggle":
        actions.setTreeSelection(toggleSelected(selection, key));
        return;
      case "range":
        actions.setTreeSelection(selectRange(selection, key, visibleKeys));
        return;
      case "context":
        // A right-click inside the choice keeps it; elsewhere it chooses that row.
        if (!selection.keys.includes(key)) {
          actions.setTreeSelection(selectOnly(key));
        }
        return;
    }
  }

  // Dragging one of several chosen rows moves them all; any other row moves alone.
  function draggedKeysFor(key: string): readonly string[] {
    return selection.keys.length > 1 && selection.keys.includes(key)
      ? movableKeys(model, selection.keys)
      : [key];
  }

  const rowKinds = useMemo(() => {
    const kinds = new Map<string, TreeRowKind>();
    for (const item of items) {
      kinds.set(
        item.key,
        item.key === PROJECT_TREE_KEY
          ? "project"
          : item.folderState === "expanded"
            ? "folder"
            : item.folderState === "collapsed"
              ? "folderCollapsed"
              : "document",
      );
    }
    return kinds;
  }, [items]);

  const treeDrag = useTreeDrag({
    getRows: () =>
      items.flatMap((item): TreeDropRow[] => {
        const row = itemElements.current
          .get(item.key)
          ?.querySelector(":scope > .tree-item__row");
        if (row === null || row === undefined) return [];
        const rect = row.getBoundingClientRect();
        return [{ key: item.key, top: rect.top, bottom: rect.bottom }];
      }),
    rowKind: (key) => rowKinds.get(key) ?? "document",
    resolveTarget: (key, hit) =>
      treeMoveTargetOf(model, draggedKeysFor(key), hit),
    onDrop: (key, target) => {
      const entryIds = draggedKeysFor(key).flatMap((draggedKey) => {
        const entry = findEntryByKey(model.entries, draggedKey);
        return entry === null ? [] : [entryIdOf(entry)];
      });
      keepFocus(
        actions.placeEntries(
          entryIds,
          target.parentFolderId,
          target.beforeEntryId,
        ),
      );
    },
  });
  const { dragState } = treeDrag;
  const draggedKeys = dragState === null ? [] : draggedKeysFor(dragState.key);
  const drag: TreeRowDrag = {
    handlersFor: treeDrag.handlersFor,
    isDragged: (key) => draggedKeys.includes(key),
    markerFor: (key) => {
      const hit = dragState?.hit ?? null;
      if (hit === null) return null;
      // The empty space below the rows means the Project's top level.
      if (hit.key === null) return key === PROJECT_TREE_KEY ? "inside" : null;
      return hit.key === key ? hit.position : null;
    },
    consumeClickSuppression: treeDrag.consumeClickSuppression,
  };

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
      // Moving with the arrow keys chooses the row; with Shift it extends the range.
      choose(target.key, event.shiftKey ? "range" : "replace");
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
    selection,
    register,
    onChoose: choose,
    onNavigate: handleNavigate,
    onContextMenu: contextMenu.openFromEvent,
    drag,
  };

  const createAtTopLevel = [
    {
      id: "createFolder",
      label: messages.tree.createFolder,
      onSelect: () => actions.requestCreateFolder(null),
    },
    {
      id: "createDocument",
      label: messages.tree.createDocument,
      onSelect: () => actions.requestCreateDocument(null),
    },
  ];

  // A click on the empty part of the tree clears the selection (new entries then go to the
  // top level); the tree area keeps focus so the keyboard still works from the top.
  function handleAreaClick(event: MouseEvent<HTMLDivElement>): void {
    if (isOnRow(event.target)) return;
    actions.setTreeSelection(EMPTY_TREE_SELECTION);
    areaElement.current?.focus({ preventScroll: true });
  }

  // The empty part of the tree offers what the Project row does for its top level.
  function handleAreaContextMenu(event: MouseEvent<HTMLDivElement>): void {
    if (isOnRow(event.target)) return;
    contextMenu.openFromEvent(
      event,
      messages.treeMenuLabel(model.projectName),
      createAtTopLevel,
    );
  }

  const creationTarget = creationTargetOf(model, rovingKey);
  const creationLocation =
    creationTarget.parentFolderId === null
      ? model.projectName
      : (creationTarget.folderName ?? messages.tree.unnamedEntity);
  const createFolderLabel = messages.tree.createFolderIn(creationLocation);
  const createDocumentLabel = messages.tree.createDocumentIn(creationLocation);

  return (
    <>
      <div
        role="toolbar"
        aria-label={messages.tree.toolbarLabel}
        className="project-tree__toolbar"
      >
        <button
          type="button"
          className="icon-button"
          aria-label={createFolderLabel}
          title={createFolderLabel}
          disabled={!creationTarget.available}
          onClick={() =>
            actions.requestCreateFolder(creationTarget.parentFolderId)
          }
        >
          <NewFolderIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={createDocumentLabel}
          title={createDocumentLabel}
          disabled={!creationTarget.available}
          onClick={() =>
            actions.requestCreateDocument(creationTarget.parentFolderId)
          }
        >
          <NewDocumentIcon />
        </button>
      </div>
      {/* The empty space around the rows: a click clears the selection, a right-click
          creates at the top level, a drop moves to the top level. The rows (and their
          keyboard handling) are the tree inside it. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only conveniences; the same actions are on the Project row and in the toolbar. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above. */}
      <div
        ref={areaElement}
        className="project-tree-area"
        tabIndex={-1}
        onClick={handleAreaClick}
        onContextMenu={handleAreaContextMenu}
      >
        <ul
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA tree pattern puts role="tree" on a list.
          role="tree"
          aria-label={messages.appRegionTreeLabel}
          className="project-tree"
          onKeyDown={handleHistoryKey}
        >
          <TreeItem
            itemKey={PROJECT_TREE_KEY}
            label={model.projectName}
            level={1}
            isRoving={rovingKey === PROJECT_TREE_KEY}
            selected={selection.keys.includes(PROJECT_TREE_KEY)}
            dropMarker={drag.markerFor(PROJECT_TREE_KEY)}
            ignoreClick={drag.consumeClickSuppression}
            expanded
            icon={<ProjectIcon />}
            register={register}
            onChoose={(mode) => choose(PROJECT_TREE_KEY, mode)}
            onNavigate={handleNavigate}
            onContextMenu={contextMenu.openFromEvent}
            menuItems={[
              ...createAtTopLevel,
              {
                id: "openProjectInNewWindow",
                label: messages.tree.openProjectInNewWindow,
                onSelect: () => void actions.openProjectInNewWindowViaDialog(),
              },
            ]}
          >
            {model.entries.length === 0 ? (
              <p className="project-tree__empty">
                {messages.tree.emptyProject}
              </p>
            ) : (
              <EntryItems
                entries={model.entries}
                parentFolderId={null}
                level={PROJECT_ENTRY_LEVEL}
                handlers={handlers}
              />
            )}
          </TreeItem>
        </ul>
      </div>
      {contextMenu.element}
    </>
  );
}

// Without a Project, the tree area offers to make or open one (as the File menu does).
function NoProjectTree() {
  const messages = useMessages().workspace;
  const { actions } = useWorkspaceServices();
  const busy = useUiState((ui) => ui.busy);
  const contextMenu = useContextMenu();
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer convenience; the same actions are in the File menu and on the main panel. */}
      <div
        className="project-tree-area"
        onContextMenu={(event) =>
          contextMenu.openFromEvent(event, messages.tree.noProjectMenuLabel, [
            {
              id: "createProject",
              label: messages.topBar.createProject,
              disabled: busy,
              onSelect: actions.requestCreateProject,
            },
            {
              id: "openProject",
              label: messages.topBar.openProject,
              disabled: busy,
              onSelect: () => void actions.openProjectViaDialog(),
            },
          ])
        }
      >
        <p className="project-tree__empty">{messages.tree.noProject}</p>
      </div>
      {contextMenu.element}
    </>
  );
}

export function ProjectTree() {
  const model = useWorkspaceModel(selectProjectTree);
  return model === null ? <NoProjectTree /> : <ProjectTreeView model={model} />;
}
