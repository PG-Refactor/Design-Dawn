import { type KeyboardEvent, type MouseEvent, useRef } from "react";
import type { SheetId } from "../../domain/shared/entity-id";
import { useContextMenu } from "../../shared/menu/context-menu";
import { restoreFocus } from "./focus-utils";
import { sheetPanelId, sheetTabId } from "./tab-ids";
import { TreeRenameInput } from "./tree-rename-input";
import { sameRenamingTarget } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { useTabDrag } from "./use-tab-drag";
import {
  NAVIGATION_KEYS,
  tabTargetIndex,
} from "./view-models/keyboard-navigation";
import { MOVE_DIRECTIONS, oneStepMove } from "./view-models/reorder";
import { dropMarker, tabClassName, ZERO_RECT } from "./view-models/tab-drag";
import { type SheetTabsModel, selectSheetTabs } from "./view-models/tabs-model";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { useWorkspaceServices } from "./workspace-services-context";
import "./tabs.css";

const RENAME_KEY = "F2";

function SheetTabList({ model }: { readonly model: SheetTabsModel }) {
  const messages = useMessages().workspace;
  const { actions } = useWorkspaceServices();
  const tabElements = useRef(new Map<SheetId, HTMLButtonElement>());
  const renaming = useUiState((ui) => ui.renaming);
  const { tabs, documentId, activeSheetId } = model;
  const tabIds = tabs.map((tab) => tab.sheetId);
  const contextMenu = useContextMenu();

  // Reordering moves DOM nodes, which can drop focus; put it back on the moved tab.
  function moveSheet(sheetId: SheetId, before: SheetId | null): void {
    const previous = document.activeElement;
    void actions.moveSheetTo(documentId, sheetId, before).then(() => {
      if (document.activeElement !== previous) restoreFocus(previous);
    });
  }

  const drag = useTabDrag({
    tabIds,
    getRects: () =>
      tabIds.map(
        (sheetId) =>
          tabElements.current
            .get(sheetId)
            ?.parentElement?.getBoundingClientRect() ?? ZERO_RECT,
      ),
    onDrop: moveSheet,
  });

  function openTabMenu(
    event: MouseEvent,
    sheetId: SheetId,
    name: string,
  ): void {
    const left = oneStepMove(tabIds, sheetId, MOVE_DIRECTIONS.up);
    const right = oneStepMove(tabIds, sheetId, MOVE_DIRECTIONS.down);
    contextMenu.openFromEvent(event, messages.tabMenuLabel(name), [
      {
        id: "rename",
        label: messages.tree.rename,
        onSelect: () => void actions.beginRenameSheet(documentId, sheetId),
      },
      {
        id: "moveLeft",
        label: messages.tabs.moveLeft,
        disabled: left === null,
        onSelect: () => {
          if (left !== null) moveSheet(sheetId, left.before);
        },
      },
      {
        id: "moveRight",
        label: messages.tabs.moveRight,
        disabled: right === null,
        onSelect: () => {
          if (right !== null) moveSheet(sheetId, right.before);
        },
      },
      { id: "createSeparator", separator: true },
      {
        id: "createSheet",
        label: messages.tabs.createSheet,
        onSelect: () => void actions.requestCreateSheet(documentId),
      },
      {
        id: "deleteSheet",
        label: messages.tabs.deleteSheet,
        onSelect: () => actions.requestDeleteSheet(documentId, sheetId),
      },
    ]);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const tab = tabs[index];
    if (tab === undefined) return;
    if (event.key === RENAME_KEY) {
      event.preventDefault();
      void actions.beginRenameSheet(documentId, tab.sheetId);
      return;
    }
    // Ctrl/Cmd+Arrow moves the tab by one place (among the tabs shown); plain arrows
    // keep moving focus. Nothing happens at the ends.
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === NAVIGATION_KEYS.arrowLeft ||
        event.key === NAVIGATION_KEYS.arrowRight)
    ) {
      event.preventDefault();
      const step = oneStepMove(
        tabIds,
        tab.sheetId,
        event.key === NAVIGATION_KEYS.arrowLeft
          ? MOVE_DIRECTIONS.up
          : MOVE_DIRECTIONS.down,
      );
      if (step !== null) moveSheet(tab.sheetId, step.before);
      return;
    }
    const target = tabTargetIndex(event.key, index, tabs.length);
    const targetTab = target === null ? undefined : tabs[target];
    if (targetTab === undefined) return;
    event.preventDefault();
    // Automatic activation: moving focus along the tabs also selects the tab.
    void actions.selectSheet(documentId, targetTab.sheetId);
    tabElements.current.get(targetTab.sheetId)?.focus();
  }

  if (tabs.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label={messages.tabs.sheetTabsLabel}
      className="tab-list"
    >
      {tabs.map((tab, index) => {
        const isTabStop = activeSheetId === null ? index === 0 : tab.isActive;
        const isRenaming = sameRenamingTarget(renaming, {
          kind: "sheet",
          documentId,
          sheetId: tab.sheetId,
        });
        const pointerHandlers = drag.handlersFor(tab.sheetId);
        const dragState = drag.dragState;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats what the tab's own controls and the keyboard already offer.
          <div
            key={tab.sheetId}
            className={tabClassName(
              tab.isActive,
              dragState?.tabId === tab.sheetId,
              dropMarker(dragState?.slot ?? null, index, tabs.length),
            )}
            onContextMenu={(event) => {
              // The rename input keeps the webview's text menu.
              if (isRenaming) return;
              openTabMenu(event, tab.sheetId, tab.name);
            }}
          >
            <button
              ref={(element) => {
                if (element === null) tabElements.current.delete(tab.sheetId);
                else tabElements.current.set(tab.sheetId, element);
              }}
              type="button"
              role="tab"
              id={sheetTabId(tab.sheetId)}
              aria-selected={tab.isActive}
              aria-controls={
                tab.isActive ? sheetPanelId(documentId) : undefined
              }
              tabIndex={isTabStop ? 0 : -1}
              className={
                isRenaming ? "tab__select tab__select--hidden" : "tab__select"
              }
              onClick={() => {
                if (drag.consumeClickSuppression()) return;
                void actions.selectSheet(documentId, tab.sheetId);
              }}
              onDoubleClick={() =>
                void actions.beginRenameSheet(documentId, tab.sheetId)
              }
              onKeyDown={(event) => handleKeyDown(event, index)}
              {...pointerHandlers}
            >
              <span className="tab__name">{tab.name}</span>
            </button>
            {isRenaming ? (
              <TreeRenameInput
                initialName={tab.name}
                label={messages.renameInputLabel(tab.name)}
                onSubmit={(name) => void actions.commitRename(name)}
                onCancel={actions.cancelRename}
                restoreFocus={() =>
                  tabElements.current.get(tab.sheetId)?.focus()
                }
              />
            ) : null}
            <button
              type="button"
              className="tab__control"
              tabIndex={isTabStop ? 0 : -1}
              aria-label={messages.deleteSheetTabLabel(tab.name)}
              onClick={() =>
                actions.requestDeleteSheet(documentId, tab.sheetId)
              }
            >
              <span aria-hidden="true">
                {messages.tabs.deleteSheetButtonText}
              </span>
            </button>
          </div>
        );
      })}
      {contextMenu.element}
    </div>
  );
}

export function SheetTabs() {
  const messages = useMessages().workspace;
  const { actions } = useWorkspaceServices();
  const model = useWorkspaceModel(selectSheetTabs);
  if (model === null) return null;
  return (
    <div className="sheet-tabs">
      <SheetTabList model={model} />
      <button
        type="button"
        className="button"
        onClick={() => void actions.requestCreateSheet(model.documentId)}
      >
        {messages.tabs.createSheet}
      </button>
    </div>
  );
}
