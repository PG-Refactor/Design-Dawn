import {
  type ClipboardEvent,
  type CSSProperties,
  type FocusEvent,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import type { TextBlockEditorView } from "../../config/mermaid-gui-config";
import type { ContentPath } from "../../domain/block/content-path";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { occurrenceRange } from "../../domain/text-search/text-search";
import { isInsideContextMenu } from "../../shared/menu/context-menu";
import { isInsideEditorOverlay } from "../../shared/overlay/editor-overlay";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import {
  BLOCK_BODY_ATTRIBUTE,
  BLOCK_EDITOR_ATTRIBUTE,
} from "../canvas/block-dom";
import { FIND_BOX_ATTRIBUTE, type FindState } from "../search/find-store";
import { stopEditing } from "../workspace/ui-state/ui-state";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { CLIPBOARD_TEXT_TYPE, pastedImage } from "./pasted-image-types";
import { SourcePreviewDivider } from "./source-preview-divider";
import "./text-block-editor.css";

export interface TextBlockEditorLabels {
  // aria-label of the editor group, the source textarea and the text of the done button.
  readonly editor: string;
  readonly source: string;
  readonly done: string;
  // The switch that hides / shows the preview next to the source, and the divider between.
  readonly hidePreview: string;
  readonly showPreview: string;
  readonly divider: string;
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
    // The switch that folds the GUI's controls away (and back).
    readonly hideControls: string;
    readonly showControls: string;
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

// The custom properties that carry the Source | Preview split to the CSS.
type SplitStyle = CSSProperties & Record<`--${string}`, string>;

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
  // Set when the source can refer to images (Markdown): images dropped on the window or
  // pasted while the Source view is shown are stored in the Document's assets, and the
  // text this returns for them is inserted at the cursor.
  readonly imageReferences?: (contentPaths: readonly ContentPath[]) => string;
  // Text a paste becomes instead of itself (a spreadsheet's cells become a Markdown
  // table); null keeps the browser's own paste.
  readonly pastedTextInsertion?: (
    pasted: string,
    source: string,
    caret: number,
  ) => string | null;
  // Extra controls in the bar while the Source view is shown (the table tools). They see
  // the draft and the caret and may replace the draft.
  readonly renderSourceTools?: (context: SourceToolsContext) => ReactNode;
}

export interface SourceToolsContext {
  readonly text: string;
  readonly caret: number;
  // Replaces the whole draft and puts the caret at `caret`.
  readonly replaceText: (text: string, caret: number) => void;
}

const selectEditorReveal = (state: FindState) => state.editorReveal;
const selectSheetFindOpen = (state: FindState) => state.sheet.open;
// How far down the textarea a revealed match is put (a share of its height).
const REVEAL_POSITION = 1 / 3;

// Puts the line holding `offset` about a third down the textarea (a selection made by
// script is not scrolled into view everywhere). Proportional to the lines before it, which
// is close enough with wrapped lines.
function scrollToOffset(textarea: HTMLTextAreaElement, offset: number): void {
  const lines = textarea.value.split("\n").length;
  const before = textarea.value.slice(0, offset).split("\n").length - 1;
  textarea.scrollTop = Math.max(
    0,
    (before / lines) * textarea.scrollHeight -
      textarea.clientHeight * REVEAL_POSITION,
  );
}

// Split view shared by the text block types: source on the left, live preview on the right.
//
// The draft is component state on purpose: typing changes only this component (and the
// preview), never the application state, the history or the save queue. The draft becomes
// the block's text in ONE command when the edit is committed:
//   - focus leaves the editor to somewhere outside it, or
//   - the "Done" button is used, or
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
  imageReferences,
  pastedTextInsertion,
  renderSourceTools,
}: TextBlockEditorProps) {
  const services = useWorkspaceServices();
  const { actions } = services;
  const sourceLayout = useUiState((ui) => ui.sourceEditorLayout);
  const { canvasActions, uiStateStore, applicationStore } = services;
  const [draft, setDraft] = useState(initialText);
  // A search that opened this editor to show a match (see `openMatch`): the source view,
  // with the match selected.
  const { findStore } = services.searchActions;
  const editorReveal = useStoreSelector(findStore, selectEditorReveal);
  // Opened by the sheet's find box, whose input keeps the focus: until the focus comes in,
  // the editor neither takes it nor relies on losing it to end (see `onPointerDownOutside`).
  const shownByFindRef = useRef(
    findStore.getState().editorReveal?.blockId === blockId &&
      findStore.getState().editorReveal?.keepFocus === true,
  );
  const findOpen = useStoreSelector(findStore, selectSheetFindOpen);
  // A match to show opens Source; an editor whose GUI can be used opens in the view last
  // chosen with the switch.
  const [view, setView] = useState<TextBlockEditorView>(() =>
    findStore.getState().editorReveal?.blockId === blockId
      ? "source"
      : guiView?.initialView === "gui"
        ? sourceLayout.preferredView
        : (guiView?.initialView ?? "source"),
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
  // Where the caret goes after text is inserted; applied once the textarea shows the text.
  const pendingCaretRef = useRef<number | null>(null);
  const [caret, setCaret] = useState(initialText.length);

  const replaceText = useCallback((text: string, nextCaret: number) => {
    draftRef.current = text;
    pendingCaretRef.current = nextCaret;
    setCaret(nextCaret);
    setDraft(text);
  }, []);

  // Inserts at the caret (replacing a selection) of the CURRENT draft: an image import may
  // finish after more typing, and the reference then goes where the caret is now.
  const insertAtCaret = useCallback(
    (text: string) => {
      const current = draftRef.current;
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? current.length;
      const end = textarea?.selectionEnd ?? current.length;
      const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
      replaceText(next, start + text.length);
    },
    [replaceText],
  );

  useLayoutEffect(() => {
    const pendingCaret = pendingCaretRef.current;
    const textarea = textareaRef.current;
    if (pendingCaret === null || textarea === null || textarea.value !== draft)
      return;
    pendingCaretRef.current = null;
    // Back into the source after a tool button took the focus (still inside the editor).
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(pendingCaret, pendingCaret);
  }, [draft]);

  // On mount and on every switch of view, focus goes into the editor: the textarea in the
  // Source view, the editor itself in the GUI view (unless a GUI control already took it).
  // Editing ends when focus leaves the editor, so without this a GUI editor that was never
  // clicked would stay open after a click elsewhere: focus was never inside to leave.
  useEffect(() => {
    if (view === "source") {
      if (!shownByFindRef.current) {
        textareaRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const container = containerRef.current;
    if (container !== null && !container.contains(document.activeElement)) {
      container.focus({ preventScroll: true });
    }
  }, [view]);

  // After the focus effect above, so the selection is made in the focused textarea.
  useEffect(() => {
    if (editorReveal === null || editorReveal.blockId !== blockId) return;
    findStore.setState((state) => ({ ...state, editorReveal: null }));
    const textarea = textareaRef.current;
    if (view !== "source" || textarea === null) return;
    const range = occurrenceRange(
      textarea.value,
      editorReveal.query,
      editorReveal.at,
    );
    if (range === null) return;
    if (!editorReveal.keepFocus) textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(range.start, range.end);
    scrollToOffset(textarea, range.start);
  }, [editorReveal, blockId, findStore, view]);

  // An editor the find box opened ends like any other once the focus has been inside;
  // before that, on a click outside it and outside the find box, or when the box closes.
  const finishRef = useRef<(returnFocus: boolean) => Promise<void>>(
    async () => undefined,
  );
  useEffect(() => {
    if (!shownByFindRef.current) return;
    const onPointerDownOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!shownByFindRef.current || !(target instanceof Element)) return;
      if (containerRef.current?.contains(target)) return;
      if (target.closest(`[${FIND_BOX_ATTRIBUTE}]`) !== null) return;
      void finishRef.current(false);
    };
    document.addEventListener("pointerdown", onPointerDownOutside, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
  }, []);
  useEffect(() => {
    if (shownByFindRef.current && !findOpen) void finishRef.current(false);
  }, [findOpen]);

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
  // Shared by every commit path (focus out, Done, unmount, save-all), so two of them never
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
  finishRef.current = finish;

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
  // Only a choice made with the switch is remembered (not the Source a diagram the GUI
  // cannot edit falls back to), and only once the view did change.
  function rememberView(chosen: TextBlockEditorView): void {
    const layout = uiStateStore.getState().sourceEditorLayout;
    actions.setSourceEditorLayout({ ...layout, preferredView: chosen });
  }

  async function showGui(remember = false): Promise<void> {
    if (view === "gui" || !(await commit())) return;
    setView("gui");
    // A diagram the GUI cannot edit shows only why: choosing it there is not a preference.
    if (remember && guiView?.initialView === "gui") rememberView("gui");
  }

  // GUI -> Source asks the GUI to apply its own uncommitted input (only that: it does not
  // commit other drafts of the document, and the GUI decides what is a request to apply and
  // what is not). A refusal stays in the GUI, where the error is shown. Source then starts
  // from the text the store has NOW, read here, because the draft that follows the store
  // while the GUI is shown depends on a render that may not have happened yet.
  async function showSource(remember = false): Promise<void> {
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
    if (remember) rememberView("source");
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    // Focus moving inside the editor (source -> preview -> Done) is not leaving it. The
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

  const sourceView = view === "source";

  // Only the Source view takes images: the GUI does not edit the text directly.
  useEffect(() => {
    if (!sourceView || imageReferences === undefined) return;
    return canvasActions.registerTextImageTarget({
      documentId,
      insertImages: (contentPaths) =>
        insertAtCaret(imageReferences(contentPaths)),
    });
  }, [sourceView, imageReferences, canvasActions, documentId, insertAtCaret]);

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (pastedTextInsertion !== undefined) {
      const textarea = event.currentTarget;
      const insertion = pastedTextInsertion(
        event.clipboardData.getData(CLIPBOARD_TEXT_TYPE),
        draftRef.current,
        textarea.selectionStart,
      );
      if (insertion !== null) {
        event.preventDefault();
        insertAtCaret(insertion);
        return;
      }
    }
    if (imageReferences === undefined) return;
    const image = pastedImage(event.clipboardData);
    if (image === null) return;
    event.preventDefault();
    void (async () => {
      const bytes = new Uint8Array(await image.file.arrayBuffer());
      // A failure is reported by the action (shown in the notifications).
      const imported = await canvasActions.importPastedImage({
        documentId,
        bytes,
        extension: image.extension,
      });
      if (imported.ok) insertAtCaret(imageReferences([imported.value]));
    })();
  }
  const showsPreview = !sourceView || !sourceLayout.previewHidden;
  const setSourceShare = (sourceShare: number) =>
    actions.setSourceEditorLayout({ ...sourceLayout, sourceShare });
  // The split is drawn with fr units: the source's share and the rest for the preview.
  const splitStyle: SplitStyle | undefined =
    sourceView && showsPreview
      ? {
          "--source-fr": `${sourceLayout.sourceShare}fr`,
          "--preview-fr": `${1 - sourceLayout.sourceShare}fr`,
        }
      : undefined;

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
          : showsPreview
            ? "text-block-editor"
            : "text-block-editor text-block-editor--preview-hidden"
      }
      style={splitStyle}
      {...{ [BLOCK_EDITOR_ATTRIBUTE]: "" }}
      onFocus={() => {
        shownByFindRef.current = false;
      }}
      onBlur={onBlur}
    >
      {view === "gui" && guiView !== undefined ? (
        // The diagram first (left), its controls beside it (right). Folded controls stay
        // mounted: the diagram's right-click menu and an open add dialog live in them, and
        // so does whatever was typed into a form.
        <div
          className={
            sourceLayout.guiControlsHidden
              ? "text-block-editor__body text-block-editor__body--controls-hidden"
              : "text-block-editor__body"
          }
        >
          <div className="text-block-editor__preview">
            {renderPreview(guiView.committedText, view)}
          </div>
          <div
            className="text-block-editor__gui"
            hidden={sourceLayout.guiControlsHidden}
          >
            {guiView.render({
              committedText: guiView.committedText,
              showSource: () => void showSource(),
              leaveRef: guiLeaveRef,
            })}
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
          onPaste={onPaste}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
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
              onClick={() => void showGui(true)}
            >
              {guiView.labels.gui}
            </button>
            <button
              type="button"
              className="button"
              aria-pressed={view === "source"}
              onClick={() => void showSource(true)}
            >
              {guiView.labels.source}
            </button>
          </fieldset>
        )}
        {view === "gui" && guiView !== undefined && (
          <button
            type="button"
            className="button text-block-editor__preview-toggle"
            aria-pressed={sourceLayout.guiControlsHidden}
            onClick={() =>
              actions.setSourceEditorLayout({
                ...sourceLayout,
                guiControlsHidden: !sourceLayout.guiControlsHidden,
              })
            }
          >
            {sourceLayout.guiControlsHidden
              ? guiView.labels.showControls
              : guiView.labels.hideControls}
          </button>
        )}
        {sourceView && renderSourceTools?.({ text: draft, caret, replaceText })}
        {sourceView && (
          <button
            type="button"
            className="button text-block-editor__preview-toggle"
            aria-pressed={sourceLayout.previewHidden}
            onClick={() =>
              actions.setSourceEditorLayout({
                ...sourceLayout,
                previewHidden: !sourceLayout.previewHidden,
              })
            }
          >
            {sourceLayout.previewHidden
              ? labels.showPreview
              : labels.hidePreview}
          </button>
        )}
        <button
          type="button"
          className="button"
          onClick={() => void finish(true)}
        >
          {labels.done}
        </button>
      </div>
      {sourceView && showsPreview && (
        <>
          <SourcePreviewDivider
            label={labels.divider}
            sourceShare={sourceLayout.sourceShare}
            containerRef={containerRef}
            onChange={setSourceShare}
          />
          <div className="text-block-editor__preview">
            {renderPreview(draft, view)}
          </div>
        </>
      )}
    </div>
  );
}
