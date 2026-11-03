import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DocumentWindowTarget } from "../../application/ports/document-window-gateway";
import type { DocumentId } from "../../domain/shared/entity-id";
import { useContextMenu } from "../../shared/menu/context-menu";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import { ExternalCompareTabItem } from "../external-change/external-compare-tab";
import { activateDiff, closeDiff, pinDiff } from "../git/git-diff-session";
import { GitDiffTabItem } from "../git/git-diff-tab";
import { focusFallbackElement } from "./focus-utils";
import { documentPanelId, documentTabId } from "./tab-ids";
import { DocumentIcon } from "./tree-icons";
import { activateCompareTab, closeCompareTab } from "./ui-state/diff-tabs";
import type { CompareTab, DiffTab, GitSelection } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import { useProjectWindows } from "./use-project-windows";
import { useTabDrag } from "./use-tab-drag";
import {
  NAVIGATION_KEYS,
  tabTargetIndex,
} from "./view-models/keyboard-navigation";
import { MOVE_DIRECTIONS, oneStepMove } from "./view-models/reorder";
import { dropMarker, tabClassName, ZERO_RECT } from "./view-models/tab-drag";
import { type DocumentTab, selectDocumentTabs } from "./view-models/tabs-model";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import { useWorkspaceServices } from "./workspace-services-context";
import "./tabs.css";

const SAVE_STATUS_ICON = {
  saved: "",
  unsaved: "●",
  saving: "…",
  error: "⚠",
} as const;

function SaveStatusIndicator({ tab }: { readonly tab: DocumentTab }) {
  const messages = useMessages().workspace;
  if (tab.saveStatus === "saved") return null;
  const label = messages.saveStatus[tab.saveStatus];
  // The icon is decoration; the text carries the meaning (never colour alone).
  return (
    <span className={`save-status save-status--${tab.saveStatus}`}>
      <span aria-hidden="true">{SAVE_STATUS_ICON[tab.saveStatus]}</span>
      {label}
    </span>
  );
}

// Element keys of the strip: Document tabs first, then the diff tabs.
function documentKey(documentId: DocumentId): string {
  return `document:${documentId}`;
}

function diffKey(target: GitSelection): string {
  return `diff:${target.side}:${target.path}`;
}

const COMPARE_KEY = "compare";

type StripEntry =
  | { readonly kind: "document"; readonly tab: DocumentTab }
  | { readonly kind: "diff"; readonly tab: DiffTab }
  | { readonly kind: "compare"; readonly tab: CompareTab };

function keyOf(entry: StripEntry): string {
  if (entry.kind === "compare") return COMPARE_KEY;
  return entry.kind === "document"
    ? documentKey(entry.tab.documentId)
    : diffKey(entry.tab);
}

// The main tab strip: the Document tabs (reorderable, closed with confirmation) followed by
// the diff tabs (UI state only). Arrow keys move through all of
// them; Ctrl/Cmd+Arrow reorders Document tabs only.
export function DocumentTabs() {
  const messages = useMessages().workspace;
  const services = useWorkspaceServices();
  const { actions, uiStateStore } = services;
  const tabs = useWorkspaceModel(selectDocumentTabs);
  const diffTabs = useUiState((ui) => ui.diffTabs);
  const activeMainTab = useUiState((ui) => ui.activeMainTab);
  const compareTab = useUiState((ui) => ui.compareTab);
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  // Set after a tab was closed (the neighbour that became active gets focus, because the
  // focused close button no longer exists) or moved (it keeps focus).
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const contextMenu = useContextMenu();
  const projectWindows = useProjectWindows();
  const documentsOnly = useWorkspaceModel(
    (application) => application.windowRole === "document",
  );
  const projectDocuments = useWorkspaceModel(
    (application) => application.project?.documents ?? [],
  );

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
    setFocusRequest(documentKey(documentId));
  }

  const drag = useTabDrag({
    tabIds,
    getRects: () =>
      tabIds.map(
        (documentId) =>
          tabElements.current
            .get(documentKey(documentId))
            ?.parentElement?.getBoundingClientRect() ?? ZERO_RECT,
      ),
    onDrop: moveTab,
    // Let go outside the window: the Document goes to the window there, or a new one.
    onDropOutside: (documentId, screenX, screenY) =>
      void actions.moveDocumentOutTo(documentId, screenX, screenY),
  });

  const entries: readonly StripEntry[] = [
    ...tabs.map((tab): StripEntry => ({ kind: "document", tab })),
    ...diffTabs.map((tab): StripEntry => ({ kind: "diff", tab })),
    ...(compareTab === null
      ? []
      : [{ kind: "compare", tab: compareTab } satisfies StripEntry]),
  ];
  if (entries.length === 0) return null;

  const activeIndex = entries.findIndex((entry) =>
    entry.kind === "compare"
      ? activeMainTab.kind === "compare"
      : entry.kind === "document"
        ? entry.tab.isActive
        : activeMainTab.kind === "diff" &&
          activeMainTab.path === entry.tab.path &&
          activeMainTab.side === entry.tab.side,
  );

  function activate(entry: StripEntry): void {
    if (entry.kind === "document")
      void actions.openDocument(entry.tab.documentId);
    else if (entry.kind === "compare")
      uiStateStore.setState((state) => activateCompareTab(state));
    else activateDiff(services, entry.tab);
  }

  function registerElement(key: string) {
    return (element: HTMLButtonElement | null): void => {
      if (element === null) tabElements.current.delete(key);
      else tabElements.current.set(key, element);
    };
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    const entry = entries[index];
    if (entry === undefined) return;
    // Ctrl/Cmd+Arrow moves a Document tab by one place; plain arrows keep moving focus.
    // Nothing happens at the ends, nor on a diff tab (they are not reorderable).
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === NAVIGATION_KEYS.arrowLeft ||
        event.key === NAVIGATION_KEYS.arrowRight)
    ) {
      event.preventDefault();
      if (entry.kind !== "document") return;
      const step = oneStepMove(
        tabIds,
        entry.tab.documentId,
        event.key === NAVIGATION_KEYS.arrowLeft
          ? MOVE_DIRECTIONS.up
          : MOVE_DIRECTIONS.down,
      );
      if (step !== null) moveTab(entry.tab.documentId, step.before);
      return;
    }
    const target = tabTargetIndex(event.key, index, entries.length);
    const targetEntry = target === null ? undefined : entries[target];
    if (targetEntry === undefined) return;
    event.preventDefault();
    // Automatic activation: moving focus along the tabs also selects the tab.
    activate(targetEntry);
    tabElements.current.get(keyOf(targetEntry))?.focus();
  }

  // Focus goes to whichever tab is active once the closed one is gone.
  function focusActiveTabOrFallback(): void {
    const state = uiStateStore.getState();
    if (state.activeMainTab.kind === "diff") {
      setFocusRequest(diffKey(state.activeMainTab));
    } else if (state.activeMainTab.kind === "compare") {
      setFocusRequest(COMPARE_KEY);
    } else if (state.activeDocumentId !== null) {
      setFocusRequest(documentKey(state.activeDocumentId));
    } else {
      focusFallbackElement();
    }
  }

  async function handleClose(tab: DocumentTab): Promise<void> {
    const result = await actions.closeDocument(tab.documentId);
    if (!result.ok) return;
    focusActiveTabOrFallback();
  }

  // "Move to …" entries: a new window, and every other window of the Project (the
  // Project window by its role, a Document window by the first Document it holds).
  function moveEntries(tab: DocumentTab): PopupMenuEntry[] {
    const move = (target: DocumentWindowTarget) =>
      void actions.moveDocumentToWindow(tab.documentId, target);
    const nameOf = (documentId: DocumentId) =>
      projectDocuments.find((entry) => entry.documentId === documentId)?.name ??
      null;
    return [
      { id: "moveSeparator", separator: true },
      {
        id: "moveToNewWindow",
        label: messages.tabs.moveToNewWindow,
        onSelect: () =>
          move({ kind: "newWindow", screenX: null, screenY: null }),
      },
      ...projectWindows
        .filter((window) => !window.isSelf)
        .map((window): PopupMenuEntry => {
          const firstName =
            window.documentIds.length === 0
              ? null
              : nameOf(window.documentIds[0] as DocumentId);
          return {
            id: `moveTo-${window.label}`,
            label:
              window.role === "project"
                ? messages.tabs.moveToProjectWindow
                : firstName === null
                  ? messages.tabs.moveToOtherWindow
                  : messages.tabs.moveToWindowOf(firstName),
            onSelect: () => move({ kind: "window", label: window.label }),
          };
        }),
    ];
  }

  function openTabMenu(event: MouseEvent, tab: DocumentTab): void {
    contextMenu.openFromEvent(event, messages.tabMenuLabel(tab.name), [
      // Renaming happens in the tree, which a Document window does not have.
      ...(documentsOnly
        ? []
        : [
            {
              id: "rename",
              label: messages.tree.rename,
              onSelect: () => void actions.beginRenameDocument(tab.documentId),
            },
          ]),
      {
        id: "createSheet",
        label: messages.tabs.createSheet,
        onSelect: () => void actions.requestCreateSheet(tab.documentId),
      },
      ...moveEntries(tab),
      { id: "closeSeparator", separator: true },
      {
        id: "close",
        label: messages.tabs.close,
        onSelect: () => void handleClose(tab),
      },
    ]);
  }

  function handleCloseCompare(): void {
    uiStateStore.setState((state) => closeCompareTab(state));
    focusActiveTabOrFallback();
  }

  function handleCloseDiff(tab: DiffTab): void {
    closeDiff(services, tab);
    focusActiveTabOrFallback();
  }

  return (
    <div
      role="tablist"
      aria-label={messages.tabs.documentTabsLabel}
      className="tab-list"
    >
      {entries.map((entry, index) => {
        // Only the active tab (or the first one when none is active) is a tab stop.
        const isTabStop = activeIndex < 0 ? index === 0 : index === activeIndex;
        if (entry.kind === "compare") {
          return (
            <ExternalCompareTabItem
              key={COMPARE_KEY}
              tab={entry.tab}
              isActive={index === activeIndex}
              isTabStop={isTabStop}
              register={registerElement(COMPARE_KEY)}
              onActivate={() => activate(entry)}
              onClose={handleCloseCompare}
              onKeyDown={(event) => handleKeyDown(event, index)}
            />
          );
        }
        if (entry.kind === "diff") {
          const { tab } = entry;
          return (
            <GitDiffTabItem
              key={keyOf(entry)}
              tab={tab}
              isActive={index === activeIndex}
              isTabStop={isTabStop}
              register={registerElement(keyOf(entry))}
              onActivate={() => activate(entry)}
              onPin={() => pinDiff(services, tab)}
              onClose={() => handleCloseDiff(tab)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            />
          );
        }
        const { tab } = entry;
        const pointerHandlers = drag.handlersFor(tab.documentId);
        const dragState = drag.dragState;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats what the tab's own controls, the tree and the keyboard already offer.
          <div
            key={tab.documentId}
            className={[
              tabClassName(
                tab.isActive,
                dragState?.tabId === tab.documentId,
                dropMarker(dragState?.slot ?? null, index, tabs.length),
              ),
              // Outside the window: letting go takes the Document to its own window.
              dragState?.tabId === tab.documentId && dragState.outside
                ? "tab--detaching"
                : "",
            ]
              .filter((name) => name !== "")
              .join(" ")}
            onContextMenu={(event) => openTabMenu(event, tab)}
          >
            <button
              ref={registerElement(documentKey(tab.documentId))}
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
              <span className="tab__icon" aria-hidden="true">
                <DocumentIcon />
              </span>
              <span className="tab__name">{tab.name}</span>
              <SaveStatusIndicator tab={tab} />
            </button>
            {tab.saveStatus === "error" ? (
              <button
                type="button"
                className="tab__control"
                tabIndex={isTabStop ? 0 : -1}
                aria-label={messages.retrySaveLabel(tab.name)}
                onClick={() => void actions.retryDocumentSave(tab.documentId)}
              >
                {messages.tabs.retrySave}
              </button>
            ) : null}
            <button
              type="button"
              className="tab__control"
              tabIndex={isTabStop ? 0 : -1}
              aria-label={messages.closeTabLabel(tab.name)}
              onClick={() => void handleClose(tab)}
            >
              <span aria-hidden="true">{messages.tabs.closeButtonText}</span>
            </button>
          </div>
        );
      })}
      {contextMenu.element}
    </div>
  );
}
