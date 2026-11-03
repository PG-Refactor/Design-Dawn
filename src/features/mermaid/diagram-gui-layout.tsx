// The common frame of the diagram GUI editors, laid out so the frequent actions are
// reachable without scrolling the (narrow, tall) panel:
//
//   [+ Node] [+ Edge] ...      add buttons, always at the top
//   (the add form opened)      one at a time, right below them
//   (busy / refusal)
//   (editor of the selection)  above the lists, not below them
//   [Nodes 5] [Edges 6] ...    one list at a time
//   (settings)                 direction, title ...
//
// Add forms and lists that are not shown stay mounted (hidden): an add form keeps what was
// typed into it, and what it reports as pending input still blocks switching to Source.

import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import { useDiagramInteraction } from "./diagram-interaction";
import type { DiagramHit } from "./diagram-shapes";

export interface GuiAddAction {
  readonly id: string;
  // The toggle's visible text and name ("+ Node"), unlike the add button inside the form.
  readonly label: string;
  // The item of the diagram's right-click menu that opens the form ("Add a node").
  readonly menuLabel: string;
  readonly form: ReactNode;
}

export interface GuiListTab {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly content: ReactNode;
}

export interface GuiLayoutState {
  readonly openAddId: string | null;
  readonly activeTabId: string;
  // Opens an add form (null closes it); with `focus`, its first field gets the focus once
  // it is shown.
  readonly openAdd: (id: string | null, focus?: boolean) => void;
  readonly showTab: (id: string) => void;
  // Where focus goes when the focused control is about to disappear (a delete): the first
  // add button, which is always there.
  readonly focusToolbar: () => void;
  readonly focusRequest: string | null;
  readonly clearFocusRequest: () => void;
  readonly toolbarRef: RefObject<HTMLDivElement | null>;
}

export function useGuiLayoutState(initialTabId: string): GuiLayoutState {
  const [openAddId, setOpenAddId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState(initialTabId);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const openAdd = useCallback((id: string | null, focus = false) => {
    setOpenAddId(id);
    setFocusRequest(focus ? id : null);
  }, []);
  const focusToolbar = useCallback(() => {
    toolbarRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  return {
    openAddId,
    activeTabId,
    openAdd,
    showTab: setActiveTabId,
    focusToolbar,
    focusRequest,
    clearFocusRequest: () => setFocusRequest(null),
    toolbarRef,
  };
}

// Busy and refusal messages of the editor, shared by every diagram type.
export function GuiStatus({
  busy,
  busyText,
  refusalHeading,
  refusalDetailLabel,
  message,
  mermaidMessage,
}: {
  readonly busy: boolean;
  readonly busyText: string;
  readonly refusalHeading: string;
  readonly refusalDetailLabel: string;
  // The input error, or the refusal's message; null: nothing to report.
  readonly message: string | null;
  // Mermaid's own message, shown only with a refusal.
  readonly mermaidMessage: string | null;
}) {
  return (
    <>
      {busy && (
        <p role="status" className="diagram-gui__busy">
          {busyText}
        </p>
      )}
      {message !== null && (
        <div role="alert" className="diagram-gui__refusal">
          <p className="diagram-gui__refusal-heading">{refusalHeading}</p>
          <p>{message}</p>
          {mermaidMessage !== null && (
            <>
              <p className="diagram-gui__refusal-label">{refusalDetailLabel}</p>
              <pre className="diagram-gui__refusal-detail">
                {mermaidMessage}
              </pre>
            </>
          )}
        </div>
      )}
    </>
  );
}

const FIELD_SELECTOR = "input, textarea, select";
const TAB_KEYS = { previous: "ArrowLeft", next: "ArrowRight" } as const;

export interface DiagramGuiLayoutProps {
  readonly className: string;
  readonly state: GuiLayoutState;
  readonly toolbarLabel: string;
  readonly tabListLabel: string;
  readonly addActions: readonly GuiAddAction[];
  readonly status: ReactNode;
  readonly editor: ReactNode;
  readonly tabs: readonly GuiListTab[];
  // The lists are folded away until opened (the diagram itself is where elements are
  // picked); the summary names them with their counts ("Lists (Nodes 7 · Edges 6)").
  readonly listsLabel: (counts: string) => string;
  readonly settings?: ReactNode;
  // The settings are folded away too.
  readonly settingsLabel?: string;
  // What can be done with a shape right-clicked in the diagram picture (before the add
  // items), and what clicking it does. Diagram types without shapes leave them out.
  readonly shapeEntries?: (hit: DiagramHit) => readonly PopupMenuEntry[];
  readonly onPickShape?: (hit: DiagramHit) => void;
}

export function DiagramGuiLayout({
  className,
  state,
  toolbarLabel,
  tabListLabel,
  addActions,
  status,
  editor,
  tabs,
  listsLabel,
  settings,
  settingsLabel,
  shapeEntries,
  onPickShape,
}: DiagramGuiLayoutProps) {
  const interaction = useDiagramInteraction();
  // Every render: the latest closures. Gone with the panel (Source view, editor closed).
  useEffect(() => {
    interaction?.register({
      entriesFor(hit) {
        const adds: PopupMenuEntry[] = addActions.map((action) => ({
          id: `add-${action.id}`,
          label: action.menuLabel,
          onSelect: () => state.openAdd(action.id, true),
        }));
        const own = hit === null ? [] : (shapeEntries?.(hit) ?? []);
        return own.length === 0
          ? adds
          : [...own, { id: "shapeSeparator", separator: true }, ...adds];
      },
      pick(hit) {
        onPickShape?.(hit);
      },
    });
    return () => interaction?.register(null);
  });
  const idPrefix = useId();
  const formId = (id: string) => `${idPrefix}-add-${id}`;
  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  const panelId = (id: string) => `${idPrefix}-panel-${id}`;
  const formRefs = useRef(new Map<string, HTMLDivElement>());
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const { focusRequest, clearFocusRequest } = state;

  // The form is shown by the render, so its field can only take focus afterwards.
  useEffect(() => {
    if (focusRequest === null) return;
    formRefs.current
      .get(focusRequest)
      ?.querySelector<HTMLElement>(FIELD_SELECTOR)
      ?.focus();
    clearFocusRequest();
  }, [focusRequest, clearFocusRequest]);

  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const step =
      event.key === TAB_KEYS.next
        ? 1
        : event.key === TAB_KEYS.previous
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next === undefined) return;
    state.showTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <div className={className}>
      <div
        ref={state.toolbarRef}
        role="toolbar"
        aria-label={toolbarLabel}
        className="diagram-gui__toolbar"
      >
        {addActions.map((action) => {
          const open = state.openAddId === action.id;
          return (
            <button
              key={action.id}
              type="button"
              className="button diagram-gui__add-toggle"
              aria-expanded={open}
              aria-controls={formId(action.id)}
              onClick={() => state.openAdd(open ? null : action.id, !open)}
            >
              {action.label}
            </button>
          );
        })}
      </div>
      {addActions.map((action) => (
        <div
          key={action.id}
          id={formId(action.id)}
          ref={(element) => {
            if (element === null) formRefs.current.delete(action.id);
            else formRefs.current.set(action.id, element);
          }}
          className="diagram-gui__add-panel"
          hidden={state.openAddId !== action.id}
        >
          {action.form}
        </div>
      ))}
      {status}
      {editor}
      <GuiDisclosure
        label={listsLabel(
          tabs.map((tab) => `${tab.label} ${tab.count}`).join(" · "),
        )}
        className="diagram-gui__lists"
      >
        <div
          role="tablist"
          aria-label={tabListLabel}
          className="diagram-gui__tabs"
        >
          {tabs.map((tab, index) => {
            const active = tab.id === state.activeTabId;
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  if (element === null) tabRefs.current.delete(tab.id);
                  else tabRefs.current.set(tab.id, element);
                }}
                type="button"
                role="tab"
                id={tabId(tab.id)}
                aria-selected={active}
                aria-controls={panelId(tab.id)}
                tabIndex={active ? 0 : -1}
                className="diagram-gui__tab"
                onClick={() => state.showTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {tab.label}
                <span className="diagram-gui__tab-count">{tab.count}</span>
              </button>
            );
          })}
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={panelId(tab.id)}
            aria-labelledby={tabId(tab.id)}
            className="diagram-gui__tab-panel"
            hidden={tab.id !== state.activeTabId}
          >
            {tab.content}
          </div>
        ))}
      </GuiDisclosure>
      {settings === undefined ? null : (
        <GuiDisclosure
          label={settingsLabel ?? ""}
          className="diagram-gui__settings-group"
        >
          {settings}
        </GuiDisclosure>
      )}
    </div>
  );
}

// A folded part of the editor: a button that shows or hides what is below it.
function GuiDisclosure({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        className="diagram-gui__disclosure"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span aria-hidden="true" className="diagram-gui__disclosure-marker">
          {open ? "▾" : "▸"}
        </span>
        {label}
      </button>
      <div id={bodyId} className="diagram-gui__disclosure-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
