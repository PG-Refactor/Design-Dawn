import { type KeyboardEvent, useRef } from "react";
import type { SheetId } from "../../domain/shared/entity-id";
import { sheetPanelId, sheetTabId } from "./tab-ids";
import { tabTargetIndex } from "./view-models/keyboard-navigation";
import { type SheetTabsModel, selectSheetTabs } from "./view-models/tabs-model";
import { useWorkspaceModel } from "./workspace-hooks";
import { deleteSheetTabLabel, MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./tabs.css";

function SheetTabList({ model }: { readonly model: SheetTabsModel }) {
  const { actions } = useWorkspaceServices();
  const tabElements = useRef(new Map<SheetId, HTMLButtonElement>());
  const { tabs, documentId, activeSheetId } = model;

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
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
        return (
          <div
            key={tab.sheetId}
            className={`tab${tab.isActive ? " tab--active" : ""}`}
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
              className="tab__select"
              onClick={() => void actions.selectSheet(documentId, tab.sheetId)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="tab__name">{tab.name}</span>
            </button>
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
