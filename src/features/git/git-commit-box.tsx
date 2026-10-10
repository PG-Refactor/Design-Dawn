import {
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GitStatus } from "../../application/ports/git-gateway";
import type { ApplicationState } from "../../application/state/application-state";
import { hasUnsavedProjectChanges } from "../../application/state/unsaved-changes";
import { setGitCommitMessage } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { NAVIGATION_KEYS } from "../workspace/view-models/keyboard-navigation";
import {
  useGitState,
  useUiState,
  useWorkspaceModel,
} from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { deriveGitChangeSections } from "./git-change-sections";
import { runGitCommit } from "./git-commit-flow";
import { CheckIcon } from "./git-icons";

// Module-level so `useWorkspaceModel` recomputes only when a state changes. The draft
// registry is not observable, so uncommitted Markdown text is not part of this; the note
// is a reminder, and the commit itself never touches the documents.
function selectHasUnsaved(application: ApplicationState): boolean {
  return hasUnsavedProjectChanges(application);
}

// The commit form of a ready repository. It commits what is staged, nothing else: it never
// saves the workspace and never touches documents or Undo (docs/ui-design.md §13.4).
export function GitCommitBox({ status }: { readonly status: GitStatus }) {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const { uiStateStore } = services;
  const message = useUiState((ui) => ui.gitCommitMessage);
  const operating = useGitState((git) => git.operating);
  const refreshing = useGitState((git) => git.refreshing);
  const hasUnsaved = useWorkspaceModel(selectHasUnsaved);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous, because two clicks can arrive before `operating` is rendered.
  const inFlight = useRef(false);
  const messageId = useId();
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const noteId = useId();
  const hasStaged = useMemo(
    () =>
      deriveGitChangeSections(status).some(
        (section) => section.id === "staged",
      ),
    [status],
  );
  const branchName = status.branch?.head ?? null;
  const placeholder =
    branchName === null
      ? messages.commitPlaceholderGeneric
      : messages.commitPlaceholder(branchName);
  const busy = submitting || operating || refreshing;
  const canCommit =
    !busy &&
    status.repositoryState === "ready" &&
    hasStaged &&
    message.trim() !== "";

  // Grows with the content; the stylesheet caps the height (then the field scrolls).
  // Measured after every layout (draft changes, restores, language switches) so the size is
  // never stale; it is cheap for one small field.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  });

  async function submit(): Promise<void> {
    if (!canCommit || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      await runGitCommit(services, {
        amend: false,
        stageAll: false,
        followUp: "none",
        remote: null,
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === NAVIGATION_KEYS.enter &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="git-commit-box">
      <label htmlFor={messageId} className="git-visually-hidden">
        {messages.commitMessageLabel}
      </label>
      <textarea
        id={messageId}
        ref={textarea}
        rows={1}
        placeholder={placeholder}
        className="git-commit-box__message"
        value={message}
        // Read-only while committing so the sent message and the draft cannot diverge.
        readOnly={submitting || operating}
        aria-describedby={noteId}
        onChange={(event) => {
          const next = event.target.value;
          uiStateStore.setState((state) => setGitCommitMessage(state, next));
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="git-commit-box__actions">
        <button
          type="button"
          className="git-primary-button"
          disabled={!canCommit}
          aria-describedby={noteId}
          onClick={() => void submit()}
        >
          <CheckIcon />
          {submitting ? messages.committing : messages.commit}
        </button>
      </div>
      <p
        id={noteId}
        className={
          hasUnsaved
            ? "git-commit-box__note git-commit-box__note--emphasised"
            : "git-commit-box__note"
        }
      >
        {hasUnsaved ? (
          <span className="git-commit-box__note-prefix">
            {messages.commitUnsavedPrefix}
          </span>
        ) : null}
        {messages.commitUnsavedNote}
      </p>
    </div>
  );
}
