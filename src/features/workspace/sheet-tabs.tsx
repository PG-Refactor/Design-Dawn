import { type KeyboardEvent, type MouseEvent, useRef } from "react";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { useContextMenu } from "../../shared/menu/context-menu";
import type { PopupMenuEntry } from "../../shared/menu/menu-list";
import {
  DESIGN_TEMPLATE_IDS,
  DESIGN_TEMPLATES,
} from "../templates/design-templates";
import { createSheetFromTemplate } from "../templates/template-actions";
import { askSaveTemplate } from "../templates/template-dialogs";
import { createSheetFromCustomTemplate } from "../templates/template-flows";
import { customTemplateEntries } from "../templates/template-menu";
import { restoreFocus } from "./focus-utils";
import { sheetPanelId, sheetTabId } from "./tab-ids";
import { SheetIcon } from "./tree-icons";
import { TreeRenameInput } from "./tree-rename-input";
import { sameRenamingTarget } from "./ui-state/ui-state";
import { useDisplayLanguage, useMessages } from "./use-messages";
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
import { useTabStripScroll } from "./use-tab-strip-scroll";

const RENAME_KEY = "F2";

// "New Sheet", the Default Templates and the Custom Templates: what the tab menu and the
// empty part of the tab bar offer for making a sheet.
function useSheetCreationEntries(): (
  documentId: DocumentId,
) => PopupMenuEntry[] {
  const messages = useMessages().workspace;
  const templateMessages = useMessages().templates;
  const { actions, canvasActions, uiStateStore, templates } =
    useWorkspaceServices();
  const language = useDisplayLanguage();
  return (documentId) => {
    const custom = customTemplateEntries(
      templates.store.getState().templates,
      ["sheet"],
      templateMessages,
      (template) =>
        void createSheetFromCustomTemplate(templates, template, documentId),
    );
    return [
      {
        id: "createSheet",
        label: messages.tabs.createSheet,
        onSelect: () => void actions.requestCreateSheet(documentId),
      },
      {
        id: "createSheetFromTemplate",
        label: messages.tabs.createSheetFromTemplate,
        entries: DESIGN_TEMPLATE_IDS.map((templateId) => ({
          id: `template-${templateId}`,
          label: DESIGN_TEMPLATES[templateId].name[language],
          onSelect: () =>
            void createSheetFromTemplate(
              { actions, canvasActions, uiStateStore },
              documentId,
              templateId,
              language,
            ),
        })),
      },
      {
        id: "createSheetFromCustomTemplate",
        label: templateMessages.sheetFromTemplate,
        entries:
          custom.length > 0
            ? custom
            : [
                {
                  id: "noCustomTemplates",
                  label: templateMessages.noTemplates,
                  disabled: true,
                  onSelect: () => {},
                },
              ],
      },
    ];
  };
}

function SheetTabList({ model }: { readonly model: SheetTabsModel }) {
  const messages = useMessages().workspace;
  const templateMessages = useMessages().templates;
  const { actions, templates } = useWorkspaceServices();
  const creationEntries = useSheetCreationEntries();

  async function saveSheetAsTemplate(sheetId: SheetId, name: string) {
    const answer = await askSaveTemplate({ kind: "sheet", name });
    if (answer === null) return;
    await templates.saveSheet(documentId, sheetId, answer.scope, answer.name);
  }
  const tabElements = useRef(new Map<SheetId, HTMLButtonElement>());
  const renaming = useUiState((ui) => ui.renaming);
  const { tabs, documentId, activeSheetId } = model;
  const strip = useTabStripScroll(`${activeSheetId ?? ""}/${tabs.length}`);
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
      ...creationEntries(documentId),
      {
        id: "saveSheetAsTemplate",
        label: templateMessages.saveAsTemplate,
        onSelect: () => void saveSheetAsTemplate(sheetId, name),
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
      ref={strip}
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
              <span className="tab__icon" aria-hidden="true">
                <SheetIcon />
              </span>
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
  const contextMenu = useContextMenu();
  const creationEntries = useSheetCreationEntries();
  if (model === null) return null;
  const { documentId } = model;
  // The bar outside the tabs (the "+" and the space after it) offers making a sheet; a tab
  // has its own menu.
  function onBarContextMenu(event: MouseEvent<HTMLDivElement>): void {
    if (
      event.target instanceof Element &&
      event.target.closest('[role="tab"]') !== null
    ) {
      return;
    }
    contextMenu.openFromEvent(
      event,
      messages.tabs.sheetTabsLabel,
      creationEntries(documentId),
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the right-click only offers what the "+" button and the tab menus also offer.
    <div className="sheet-tabs" onContextMenu={onBarContextMenu}>
      <SheetTabList model={model} />
      {/* A small "+" after the last tab, as in spreadsheets; the name says what it does. */}
      <button
        type="button"
        className="icon-button sheet-tabs__add"
        aria-label={messages.tabs.createSheet}
        title={messages.tabs.createSheet}
        onClick={() => void actions.requestCreateSheet(model.documentId)}
      >
        <span aria-hidden="true">{messages.tabs.createSheetButtonText}</span>
      </button>
      {contextMenu.element}
    </div>
  );
}
