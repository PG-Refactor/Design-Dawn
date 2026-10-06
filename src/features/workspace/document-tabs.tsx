import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { DocumentId } from "../../domain/shared/entity-id";
import { focusFallbackElement } from "./focus-utils";
import { documentPanelId, documentTabId } from "./tab-ids";
import { useTabDrag } from "./use-tab-drag";
import {
  NAVIGATION_KEYS,
  tabTargetIndex,
} from "./view-models/keyboard-navigation";
import { MOVE_DIRECTIONS, oneStepMove } from "./view-models/reorder";
import { dropMarker, tabClassName, ZERO_RECT } from "./view-models/tab-drag";
import { type DocumentTab, selectDocumentTabs } from "./view-models/tabs-model";
import { useWorkspaceModel } from "./workspace-hooks";
import { closeTabLabel, MESSAGES, retrySaveLabel } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./tabs.css";

const SAVE_STATUS_ICON = {
  saved: "",
  unsaved: "●",
  saving: "…",
  error: "⚠",
} as const;

function SaveStatusIndicator({ tab }: { readonly tab: DocumentTab }) {
  if (tab.saveStatus === "saved") return null;
  const label = MESSAGES.saveStatus[tab.saveStatus];
  // The icon is decoration; the text carries the meaning (never colour alone).
  return (
    <span className={`save-status save-status--${tab.saveStatus}`}>
      <span aria-hidden="true">{SAVE_STATUS_ICON[tab.saveStatus]}</span>
      {label}
    </span>
  );
}

export function DocumentTabs() {
  const { actions, uiStateStore } = useWorkspaceServices();
  const tabs = useWorkspaceModel(selectDocumentTabs);
  const tabElements = useRef(new Map<DocumentId, HTMLButtonElement>());
  // Set after a tab was closed (the neighbour that became active gets focus, because the
  // focused close button no longer exists) or moved (it keeps focus).
  const [focusRequest, setFocusRequest] = useState<DocumentId | null>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    const element = tabElements.current.get(focusRequest);
    if (element !== undefined) {
      element.focus();
      setFocusRequest(null);
    }
  }, [focusRequest]);

  const tabIds = tabs.map((tab) => tab.documentId);

  // Reordering moves DOM nodes, which can drop focus; ask for it back on the moved tab
  // once the new order is rendered.
  function moveTab(documentId: DocumentId, before: DocumentId | null): void {
    actions.moveDocumentTab(documentId, before);
    setFocusRequest(documentId);
  }

  const drag = useTabDrag({
    tabIds,
    getRects: () =>
      tabIds.map(
        (documentId) =>
          tabElements.current
            .get(documentId)
            ?.parentElement?.getBoundingClientRect() ?? ZERO_RECT,
      ),
    onDrop: moveTab,
  });

  if (tabs.length === 0) return null;

  const activeTab = tabs.find((tab) => tab.isActive) ?? null;

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    // Ctrl/Cmd+Arrow moves the tab by one place; plain arrows keep moving focus. Nothing
    // happens at the ends.
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === NAVIGATION_KEYS.arrowLeft ||
        event.key === NAVIGATION_KEYS.arrowRight)
    ) {
      event.preventDefault();
      const tab = tabs[index];
      if (tab === undefined) return;
      const step = oneStepMove(
        tabIds,
        tab.documentId,
        event.key === NAVIGATION_KEYS.arrowLeft
          ? MOVE_DIRECTIONS.up
          : MOVE_DIRECTIONS.down,
      );
      if (step !== null) moveTab(tab.documentId, step.before);
      return;
    }
    const target = tabTargetIndex(event.key, index, tabs.length);
    const targetTab = target === null ? undefined : tabs[target];
    if (targetTab === undefined) return;
    event.preventDefault();
    // Automatic activation: moving focus along the tabs also selects the tab.
    void actions.openDocument(targetTab.documentId);
    tabElements.current.get(targetTab.documentId)?.focus();
  }

  async function handleClose(tab: DocumentTab): Promise<void> {
    const wasActive = tab.isActive;
    const result = await actions.closeDocument(tab.documentId);
    if (!result.ok) return;
    const nextActive = uiStateStore.getState().activeDocumentId;
    if (wasActive && nextActive === null) focusFallbackElement();
    else if (nextActive !== null) setFocusRequest(nextActive);
  }

  return (
    <div
      role="tablist"
      aria-label={MESSAGES.tabs.documentTabsLabel}
      className="tab-list"
    >
      {tabs.map((tab, index) => {
        // Only the active tab (or the first one when none is active) is a tab stop.
        const isTabStop = activeTab === null ? index === 0 : tab.isActive;
        const pointerHandlers = drag.handlersFor(tab.documentId);
        const dragState = drag.dragState;
        return (
          <div
            key={tab.documentId}
            className={tabClassName(
              tab.isActive,
              dragState?.tabId === tab.documentId,
              dropMarker(dragState?.slot ?? null, index, tabs.length),
            )}
          >
            <button
              ref={(element) => {
                if (element === null)
                  tabElements.current.delete(tab.documentId);
                else tabElements.current.set(tab.documentId, element);
              }}
              type="button"
              role="tab"
              id={documentTabId(tab.documentId)}
              aria-selected={tab.isActive}
              aria-controls={
                tab.isActive ? documentPanelId(tab.documentId) : undefined
              }
              tabIndex={isTabStop ? 0 : -1}
              className="tab__select"
              onClick={() => {
                if (drag.consumeClickSuppression()) return;
                void actions.openDocument(tab.documentId);
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              {...pointerHandlers}
            >
              <span className="tab__name">{tab.name}</span>
              <SaveStatusIndicator tab={tab} />
            </button>
            {tab.saveStatus === "error" ? (
              <button
                type="button"
                className="tab__control"
                tabIndex={isTabStop ? 0 : -1}
                aria-label={retrySaveLabel(tab.name)}
                onClick={() => void actions.retryDocumentSave(tab.documentId)}
              >
                {MESSAGES.tabs.retrySave}
              </button>
            ) : null}
            <button
              type="button"
              className="tab__control"
              tabIndex={isTabStop ? 0 : -1}
              aria-label={closeTabLabel(tab.name)}
              onClick={() => void handleClose(tab)}
            >
              <span aria-hidden="true">{MESSAGES.tabs.closeButtonText}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
