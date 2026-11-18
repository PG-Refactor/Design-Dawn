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
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { previewDiagramOperation } from "../../application/diagram/preview-diagram-operation";
import { fromDomainResult } from "../../application/ports/operation-error";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import type { PopupMenuEntry } from "../../shared/menu/popup-menu";
import { EDITOR_OVERLAY_ATTRIBUTE } from "../../shared/overlay/editor-overlay";
import { BLOCK_EDITOR_ATTRIBUTE } from "../canvas/block-dom";
import { focusableElements } from "../workspace/focus-utils";
import { useMessages } from "../workspace/use-messages";
import {
  AddDialogFormContext,
  type AddDialogFormLink,
} from "./add-dialog-form";
import { DiagramAddPreview } from "./diagram-add-preview";
import { describeRefusal, refusalCode } from "./diagram-gui-text";
import { useDiagramInteraction } from "./diagram-interaction";
import type { DiagramHit } from "./diagram-shapes";
import "./diagram-add-dialog.css";

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
  // How many times each add dialog was cancelled; a new count clears its form.
  readonly resetSignals: Readonly<Record<string, number>>;
  // Closes the open add dialog after clearing its form.
  readonly cancelAdd: () => void;
}

export function useGuiLayoutState(initialTabId: string): GuiLayoutState {
  const [openAddId, setOpenAddId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState(initialTabId);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [resetSignals, setResetSignals] = useState<
    Readonly<Record<string, number>>
  >({});
  const openAdd = useCallback((id: string | null, focus = false) => {
    setOpenAddId(id);
    setFocusRequest(focus ? id : null);
  }, []);
  const cancelAdd = useCallback(() => {
    setOpenAddId((open) => {
      if (open !== null) {
        setResetSignals((signals) => ({
          ...signals,
          [open]: (signals[open] ?? 0) + 1,
        }));
      }
      return null;
    });
    setFocusRequest(null);
  }, []);
  const focusToolbar = useCallback(() => {
    const toolbar = toolbarRef.current;
    // Folded away (hidden), the toolbar cannot take the focus: the editor does.
    if (toolbar !== null && toolbar.closest("[hidden]") !== null) {
      toolbar.closest<HTMLElement>(`[${BLOCK_EDITOR_ATTRIBUTE}]`)?.focus();
      return;
    }
    toolbar?.querySelector<HTMLElement>("button")?.focus();
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
    resetSignals,
    cancelAdd,
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
// Refusals of text that is only half typed (a blank before the next word).
const TYPING_REFUSALS: ReadonlySet<string> = new Set([
  "labelNotTrimmed",
  "titleNotNormalized",
]);
const TAB_KEYS = { previous: "ArrowLeft", next: "ArrowRight" } as const;
const DIALOG_KEYS = { escape: "Escape", tab: "Tab" } as const;

// The add dialog is drawn on the page (outside the canvas, whose transform would move and
// scale it), but React still bubbles its events to the canvas and the editor. They stop
// at the dialog.
function stop(event: SyntheticEvent): void {
  event.stopPropagation();
}

export interface DiagramGuiLayoutProps {
  readonly className: string;
  readonly state: GuiLayoutState;
  // The block's committed text: what the add dialog previews its add against.
  readonly source: string;
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
  source,
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
  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  const panelId = (id: string) => `${idPrefix}-panel-${id}`;
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

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
      <DiagramAddDialogs
        state={state}
        source={source}
        toolbarLabel={toolbarLabel}
        addActions={addActions}
        status={status}
      />
      {state.openAddId === null && status}
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

// The add buttons ("+ Node" ...) and the add dialog they open: the form, and a preview of
// the diagram after the add. Shared by every diagram editor.
export function DiagramAddDialogs({
  state,
  source,
  toolbarLabel,
  addActions,
  status,
}: {
  readonly state: GuiLayoutState;
  readonly source: string;
  readonly toolbarLabel: string;
  readonly addActions: readonly GuiAddAction[];
  // The editor's busy / refusal line: shown in the dialog while one is open (the editor
  // behind it is covered), so the reason an add was refused is seen where it was made.
  // The caller shows it itself while no dialog is open.
  readonly status?: ReactNode;
}) {
  const idPrefix = useId();
  const formId = (id: string) => `${idPrefix}-add-${id}`;
  const formRefs = useRef(new Map<string, HTMLDivElement>());
  const dialogRef = useRef<HTMLDivElement>(null);
  const { focusRequest, clearFocusRequest } = state;
  const gui = useMessages().mermaid.gui;
  const [pendingById, setPendingById] = useState<
    Readonly<Record<string, DiagramOperation | null>>
  >({});
  const openAction = addActions.find((action) => action.id === state.openAddId);

  // The toggle of the open dialog takes the focus back before the dialog goes away, so
  // the focus never falls out of the editor (which would end editing).
  // With the controls folded away (hidden) the toggle cannot take the focus: the editor
  // itself does, which keeps editing going.
  function focusToggle(id: string): void {
    const toggle = state.toolbarRef.current?.querySelector<HTMLElement>(
      `[aria-controls="${formId(id)}"]`,
    );
    if (toggle != null && toggle.closest("[hidden]") === null) {
      toggle.focus();
      return;
    }
    state.toolbarRef.current
      ?.closest<HTMLElement>(`[${BLOCK_EDITOR_ATTRIBUTE}]`)
      ?.focus();
  }

  function cancel(): void {
    if (state.openAddId !== null) focusToggle(state.openAddId);
    state.cancelAdd();
  }

  // One link per form; a new one only when its reset count changes.
  const resetKey = JSON.stringify(state.resetSignals);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey stands for the counts.
  const links = useMemo(() => {
    const byId = new Map<string, AddDialogFormLink>();
    for (const action of addActions) {
      byId.set(action.id, {
        reportPending: (operation) =>
          setPendingById((current) =>
            JSON.stringify(current[action.id] ?? null) ===
            JSON.stringify(operation)
              ? current
              : { ...current, [action.id]: operation },
          ),
        resetSignal: state.resetSignals[action.id] ?? 0,
        added: () => {
          focusToggle(action.id);
          state.openAdd(null);
        },
      });
    }
    return byId;
  }, [resetKey, addActions.map((action) => action.id).join()]);

  // What the preview shows: the diagram after the described add, or the current one with
  // the reason when the add cannot be made (or nothing is described yet).
  const pending =
    openAction === undefined ? null : (pendingById[openAction.id] ?? null);
  const preview = useMemo(() => {
    if (pending === null) return { source, refusal: null };
    const result = fromDomainResult(previewDiagramOperation(source, pending));
    if (result.ok) return { source: result.value, refusal: null };
    // A blank at the end is what typing the next word passes through: not worth an error
    // while typing (the add itself still refuses it).
    if (TYPING_REFUSALS.has(refusalCode(result.error.detail))) {
      return { source, refusal: null };
    }
    return { source, refusal: describeRefusal(gui, result.error).message };
  }, [pending, source, gui]);

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (event.key === DIALOG_KEYS.escape) {
      event.preventDefault();
      cancel();
      return;
    }
    // The focus stays in the dialog: anywhere else on the page would end editing.
    if (event.key !== DIALOG_KEYS.tab || dialogRef.current === null) return;
    const focusable = focusableElements(dialogRef.current).filter(
      (element) => element.closest("[hidden]") === null,
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // The form is shown by the render, so its field can only take focus afterwards.
  useEffect(() => {
    if (focusRequest === null) return;
    formRefs.current
      .get(focusRequest)
      ?.querySelector<HTMLElement>(FIELD_SELECTOR)
      ?.focus();
    clearFocusRequest();
  }, [focusRequest, clearFocusRequest]);

  return (
    <>
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
      {createPortal(
        // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the dialog's events from reaching the canvas and the editor.
        <div
          className="diagram-add-dialog__layer"
          hidden={openAction === undefined}
          {...{ [EDITOR_OVERLAY_ATTRIBUTE]: "" }}
          onKeyDown={onDialogKeyDown}
          onPointerDown={stop}
          onMouseDown={stop}
          onClick={stop}
          onDoubleClick={stop}
          onWheel={stop}
          onContextMenu={stop}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={openAction?.menuLabel}
            className="diagram-add-dialog"
          >
            <div className="diagram-add-dialog__form">
              {/* Every form stays mounted (hidden), so it keeps what was typed while
                  another one is shown. */}
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
                  <AddDialogFormContext.Provider
                    value={links.get(action.id) ?? null}
                  >
                    {action.form}
                  </AddDialogFormContext.Provider>
                </div>
              ))}
              {openAction !== undefined && status}
              <div className="diagram-add-dialog__actions">
                <button type="button" className="button" onClick={cancel}>
                  {gui.addCancel}
                </button>
              </div>
            </div>
            {openAction === undefined ? null : (
              <DiagramAddPreview
                source={preview.source}
                refusal={preview.refusal}
              />
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
