import { type KeyboardEvent, useRef } from "react";
import type { SheetId } from "../../domain/shared/entity-id";
import { restoreFocus } from "./focus-utils";
import { sheetPanelId, sheetTabId } from "./tab-ids";
import { TreeRenameInput } from "./tree-rename-input";
import { sameRenamingTarget } from "./ui-state/ui-state";
import { useTabDrag } from "./use-tab-drag";
import {
  NAVIGATION_KEYS,
  tabTargetIndex,
} from "./view-models/keyboard-navigation";
import { MOVE_DIRECTIONS, oneStepMove } from "./view-models/reorder";
import { dropMarker, tabClassName, ZERO_RECT } from "./view-models/tab-drag";
import { type SheetTabsModel, selectSheetTabs } from "./view-models/tabs-model";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import {
  deleteSheetTabLabel,
  MESSAGES,
  renameInputLabel,
} from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./tabs.css";

const RENAME_KEY = "F2";

function SheetTabList({ model }: { readonly model: SheetTabsModel }) {
  const { actions } = useWorkspaceServices();
  const tabElements = useRef(new Map<SheetId, HTMLButtonElement>());
  const renaming = useUiState((ui) => ui.renaming);
  const { tabs, documentId, activeSheetId } = model;
  const tabIds = tabs.map((tab) => tab.sheetId);

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
      aria-label={MESSAGES.tabs.sheetTabsLabel}
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
          <div
            key={tab.sheetId}
            className={tabClassName(
              tab.isActive,
              dragState?.tabId === tab.sheetId,
              dropMarker(dragState?.slot ?? null, index, tabs.length),
            )}
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
                label={renameInputLabel(tab.name)}
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
              aria-label={deleteSheetTabLabel(tab.name)}
              onClick={() =>
                actions.requestDeleteSheet(documentId, tab.sheetId)
              }
            >
              <span aria-hidden="true">
                {MESSAGES.tabs.deleteSheetButtonText}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function SheetTabs() {
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
        {MESSAGES.tabs.createSheet}
      </button>
    </div>
  );
}
