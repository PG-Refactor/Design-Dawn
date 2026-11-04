import {
  type FocusEvent,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import type { TextBlockEditorView } from "../../config/mermaid-gui-config";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { isInsideContextMenu } from "../../shared/menu/context-menu";
import { isInsideEditorOverlay } from "../../shared/overlay/editor-overlay";
import {
  BLOCK_BODY_ATTRIBUTE,
  BLOCK_EDITOR_ATTRIBUTE,
} from "../canvas/block-dom";
import { stopEditing } from "../workspace/ui-state/ui-state";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./text-block-editor.css";

export interface TextBlockEditorLabels {
  // aria-label of the editor group, the source textarea and the text of the done button.
  readonly editor: string;
  readonly source: string;
  readonly done: string;
}

// An optional second view next to the Source textarea (the Mermaid diagram GUI). The editor
// owns only the switch and the draft hand-over; what the GUI shows and does is the slot's.
export type GuiLeaveCheck = () => Promise<OperationResult<void>>;

export interface TextBlockGuiView {
  readonly labels: {
    // aria-label of the switch and the text of its two buttons.
    readonly modeGroup: string;
    readonly gui: string;
    readonly source: string;
  };
  readonly initialView: TextBlockEditorView;
  // The block's text in the application state. The GUI works on this, never on the draft.
  readonly committedText: string;
  readonly render: (context: {
    readonly committedText: string;
    readonly showSource: () => void;
    // The GUI fills it with what must succeed before the Source view is shown (applying its
    // own uncommitted input). A failure keeps the GUI. Null: nothing to do.
    readonly leaveRef: MutableRefObject<GuiLeaveCheck | null>;
  }) => ReactNode;
}

export interface TextBlockEditorProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  // The text when editing started; the draft is local from then on.
  readonly initialText: string;
  readonly labels: TextBlockEditorLabels;
  // What the right-hand side shows for the current draft. A slot, so this editor knows
  // nothing about the block type (Markdown renders HTML, Mermaid shows a placeholder).
  readonly renderPreview: (
    text: string,
    view: TextBlockEditorView,
  ) => ReactNode;
  readonly guiView?: TextBlockGuiView;
}

// Split view shared by the text block types: source on the left, live preview on the right.
//
// The draft is component state on purpose: typing changes only this component (and the
// preview), never the application state, the history or the save queue. The draft becomes
// the block's text in ONE command when the edit is committed:
//   - focus leaves the editor to somewhere outside it, or
//   - the "完了" button is used, or
//   - the editor goes away while the draft differs from the last committed text (switching
//     the sheet; a safety net so a draft is not dropped silently).
// There is no discard: Escape does nothing special here, so a draft is never lost to a
// stray key.
export function TextBlockEditor({
  documentId,
  sheetId,
  blockId,
  initialText,
  labels,
  renderPreview,
  guiView,
}: TextBlockEditorProps) {
  const services = useWorkspaceServices();
  const { canvasActions, uiStateStore, applicationStore } = services;
  const [draft, setDraft] = useState(initialText);
  const [view, setView] = useState<TextBlockEditorView>(
    guiView?.initialView ?? "source",
  );
  const guiCommittedText = guiView?.committedText;
  // Latest values for async callbacks and the unmount cleanup, which must not see stale
  // closures.
  const draftRef = useRef(initialText);
  const committedTextRef = useRef(initialText);
  const inFlightRef = useRef<Promise<OperationResult<void>> | null>(null);
  // Set when the user closed the document without saving: the unmount that follows must
  // not turn the draft into a command (it would fail on the closed session and report an
  // error for text the user gave up on).
  const discardedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const guiLeaveRef = useRef<GuiLeaveCheck | null>(null);

  // On mount, and again when the Source view comes back from the GUI.
  useEffect(() => {
    if (view === "source") textareaRef.current?.focus({ preventScroll: true });
  }, [view]);

  // In the GUI view the application state is the only text there is: operations, undo and
  // redo change it, so the draft and the "last committed" text follow it. Without this the
  // draft would still hold the text from before the GUI's edits, and leaving the editor
  // would commit it over them.
  useEffect(() => {
    if (view !== "gui" || guiCommittedText === undefined) return;
    draftRef.current = guiCommittedText;
    committedTextRef.current = guiCommittedText;
    setDraft(guiCommittedText);
  }, [view, guiCommittedText]);

  // Applies the draft as ONE command without ending the edit or touching the textarea.
  // Shared by every commit path (focus out, 完了, unmount, save-all), so two of them never
  // run a command for the same text: a caller that finds a commit in flight waits for it
  // and then re-checks, which finds the text already committed. A failed commit leaves
  // the draft and the edit mode as they are; the action has recorded the error.
  const commitDraft = useCallback(async (): Promise<OperationResult<void>> => {
    while (inFlightRef.current !== null) await inFlightRef.current;
    if (discardedRef.current) return operationOk(undefined);
    const text = draftRef.current;
    // No command for unchanged text, so no empty history entry.
    if (text === committedTextRef.current) return operationOk(undefined);
    const task = (async (): Promise<OperationResult<void>> => {
      try {
        const result = await canvasActions.commitContentEdit({
          documentId,
          sheetId,
          blockId,
          text,
        });
        if (result.ok) committedTextRef.current = text;
        return result;
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = task;
    return task;
  }, [canvasActions, documentId, sheetId, blockId]);

  // Resolves to true when the text was applied (also when it was unchanged).
  const commit = useCallback(
    async (): Promise<boolean> => (await commitDraft()).ok,
    [commitDraft],
  );

  // Lets "save all" commit this draft. commitDraft reads the draft through refs, so the
  // registered committer always sees the latest text even though it is registered once.
  const { draftRegistry } = services;
  useEffect(
    () =>
      draftRegistry.register({
        documentId,
        commitDraft,
        hasPendingDraft: () =>
          !discardedRef.current &&
          draftRef.current !== committedTextRef.current,
        discardDraft: () => {
          discardedRef.current = true;
        },
      }),
    [draftRegistry, documentId, commitDraft],
  );

  const finish = useCallback(
    async (returnFocus: boolean): Promise<void> => {
      const body = containerRef.current?.closest(`[${BLOCK_BODY_ATTRIBUTE}]`);
      if (!(await commit())) return;
      uiStateStore.setState((state) => stopEditing(state, sheetId, blockId));
      if (returnFocus && body instanceof HTMLElement && body.isConnected) {
        body.focus({ preventScroll: true });
      }
    },
    [commit, uiStateStore, sheetId, blockId],
  );

  // Unmount safety net (sheet switch). Commits only when there is something new, so the
  // simulated unmount of React's development StrictMode is a no-op. It does not end the
  // edit mode: the canvas clears that when it leaves the sheet.
  useEffect(
    () => () => {
      if (
        !discardedRef.current &&
        draftRef.current !== committedTextRef.current
      ) {
        void commit();
      }
    },
    [commit],
  );

  // Source -> GUI commits the draft first (one history entry when it changed), so the GUI
  // starts from the text that is really stored. A failed commit stays in Source.
  async function showGui(): Promise<void> {
    if (view === "gui" || !(await commit())) return;
    setView("gui");
  }

  // GUI -> Source asks the GUI to apply its own uncommitted input (only that: it does not
  // commit other drafts of the document, and the GUI decides what is a request to apply and
  // what is not). A refusal stays in the GUI, where the error is shown. Source then starts
  // from the text the store has NOW, read here, because the draft that follows the store
  // while the GUI is shown depends on a render that may not have happened yet.
  async function showSource(): Promise<void> {
    if (view === "source") return;
    if (view === "gui") {
      const left = (await guiLeaveRef.current?.()) ?? operationOk(undefined);
      if (!left.ok) return;
      const latest = applicationStore
        .getState()
        .documents.get(documentId)
        ?.contents.get(blockId);
      if (latest !== undefined) {
        draftRef.current = latest;
        committedTextRef.current = latest;
        setDraft(latest);
      }
    }
    setView("source");
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    // Focus moving inside the editor (source -> preview -> 完了) is not leaving it. The
    // container itself is focusable, so a click on non-focusable preview content lands
    // on it instead of on the page body.
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    // Its own right-click menu (the diagram's) is part of the editor while it is open;
    // choosing an item puts the focus back inside.
    if (isInsideContextMenu(next)) return;
    // So is a dialog it opened on the page (the diagram GUI's add dialog).
    if (isInsideEditorOverlay(next)) return;
    // The whole window lost focus (Alt+Tab): the page has no focus but the element is
    // still the active one, and the user has not left the editor. (A focus move inside the
    // page makes another element, or the body, active before this runs.)
    if (!document.hasFocus() && document.activeElement === event.target) return;
    void finish(false);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to what is a focus-containment boundary.
    <div
      ref={containerRef}
      role="group"
      aria-label={labels.editor}
      // Programmatic / click focus only (see onBlur).
      tabIndex={-1}
      className={
        view === "gui"
          ? "text-block-editor text-block-editor--gui"
          : "text-block-editor"
      }
      {...{ [BLOCK_EDITOR_ATTRIBUTE]: "" }}
      onBlur={onBlur}
    >
      {view === "gui" && guiView !== undefined ? (
        <div className="text-block-editor__body">
          <div className="text-block-editor__gui">
            {guiView.render({
              committedText: guiView.committedText,
              showSource: () => void showSource(),
              leaveRef: guiLeaveRef,
            })}
          </div>
          <div className="text-block-editor__preview">
            {renderPreview(guiView.committedText, view)}
          </div>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="text-block-editor__source"
          aria-label={labels.source}
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
          }}
        />
      )}
      <div className="text-block-editor__bar">
        {guiView !== undefined && (
          <fieldset
            className="text-block-editor__modes"
            aria-label={guiView.labels.modeGroup}
          >
            <button
              type="button"
              className="button"
              aria-pressed={view === "gui"}
              onClick={() => void showGui()}
            >
              {guiView.labels.gui}
            </button>
            <button
              type="button"
              className="button"
              aria-pressed={view === "source"}
              onClick={() => void showSource()}
            >
              {guiView.labels.source}
            </button>
          </fieldset>
        )}
        <button
          type="button"
          className="button"
          onClick={() => void finish(true)}
        >
          {labels.done}
        </button>
      </div>
      {view === "source" && (
        <div className="text-block-editor__preview">
          {renderPreview(draft, view)}
        </div>
      )}
    </div>
  );
}
