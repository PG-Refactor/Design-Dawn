import {
  type FocusEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import {
  BLOCK_BODY_ATTRIBUTE,
  BLOCK_EDITOR_ATTRIBUTE,
} from "../canvas/block-dom";
import { stopEditing } from "../workspace/ui-state/ui-state";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import {
  editorLabel,
  MARKDOWN_MESSAGES,
  previewLabel,
  sourceLabel,
} from "./markdown-messages";
import { MarkdownPreview } from "./markdown-preview";
import { renderMarkdown } from "./render-markdown";

export interface MarkdownEditorProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  // The text when editing started; the draft is local from then on.
  readonly initialText: string;
}

// Split view: source on the left, live preview on the right.
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
export function MarkdownEditor({
  documentId,
  sheetId,
  blockId,
  initialText,
}: MarkdownEditorProps) {
  const services = useWorkspaceServices();
  const { canvasActions, uiStateStore } = services;
  const [draft, setDraft] = useState(initialText);
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
  const html = useMemo(() => renderMarkdown(draft), [draft]);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

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

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    // Focus moving inside the editor (source -> preview -> 完了) is not leaving it. The
    // container itself is focusable, so a click on non-focusable preview content lands
    // on it instead of on the page body.
    if (next instanceof Node && event.currentTarget.contains(next)) return;
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
      aria-label={editorLabel(blockId)}
      // Programmatic / click focus only (see onBlur).
      tabIndex={-1}
      className="markdown-editor"
      {...{ [BLOCK_EDITOR_ATTRIBUTE]: "" }}
      onBlur={onBlur}
    >
      <textarea
        ref={textareaRef}
        className="markdown-editor__source"
        aria-label={sourceLabel(blockId)}
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
        }}
      />
      <div className="markdown-editor__bar">
        <button
          type="button"
          className="button"
          onClick={() => void finish(true)}
        >
          {MARKDOWN_MESSAGES.done}
        </button>
      </div>
      <div className="markdown-editor__preview">
        <MarkdownPreview html={html} label={previewLabel(blockId)} scrollable />
      </div>
    </div>
  );
}
