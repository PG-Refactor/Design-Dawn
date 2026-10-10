import { type KeyboardEvent, useId, useRef } from "react";
import type { GitStatus } from "../../application/ports/git-gateway";
import type {
  GitSelection,
  GitSelectionSide,
} from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { tabTargetIndex } from "../workspace/view-models/keyboard-navigation";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { changeSidesOf } from "./git-change-sections";
import { GitDiffContent } from "./git-diff-content";
import { closeDiff, openDiff } from "./git-diff-session";
import { findChangeListFocusTarget } from "./git-dom";

const DIFF_SIDES: readonly GitSelectionSide[] = ["staged", "unstaged"];
const CLOSE_KEY = "Escape";

interface GitDiffViewProps {
  readonly selection: GitSelection;
  readonly status: GitStatus | null;
}

// The diff of the selected file side: header (path, side switch when both sides have a
// change, close) and the body for what the controller holds. Only a diff of exactly the
// selected path and side is shown; anything else counts as loading.
export function GitDiffView({ selection, status }: GitDiffViewProps) {
  const messages = useMessages().git;
  const services = useWorkspaceServices();
  const diff = useGitState((git) => git.diff);
  const root = useRef<HTMLDivElement | null>(null);
  const tabElements = useRef(new Map<GitSelectionSide, HTMLButtonElement>());
  const panelId = useId();
  const tabIdPrefix = useId();

  const sides = status === null ? null : changeSidesOf(status, selection.path);
  const stagedEntry = sides?.staged ?? null;
  const showSwitch =
    sides !== null && sides.staged !== null && sides.unstaged !== null;
  const pathText =
    stagedEntry?.originalPath != null && selection.side === "staged"
      ? messages.renamedPathText(stagedEntry.originalPath, selection.path)
      : selection.path;

  function close(): void {
    // Found before the selection is cleared, which removes the marker it looks for.
    const target = findChangeListFocusTarget(root.current);
    closeDiff(services);
    target?.focus();
  }

  function switchTo(side: GitSelectionSide): void {
    openDiff(services, { path: selection.path, side });
    tabElements.current.get(side)?.focus();
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    const target = tabTargetIndex(event.key, index, DIFF_SIDES.length);
    const side = target === null ? undefined : DIFF_SIDES[target];
    if (side === undefined) return;
    event.preventDefault();
    switchTo(side);
  }

  function renderBody() {
    if (diff === null) {
      // The controller clears the diff on failure and the failure is already reported.
      return (
        <div className="git-diff__message">
          <p role="status">{messages.diffFailed}</p>
          <button
            type="button"
            className="button"
            onClick={() => openDiff(services, selection)}
          >
            {messages.retry}
          </button>
        </div>
      );
    }
    if (
      diff.path !== selection.path ||
      diff.side !== selection.side ||
      diff.status === "loading"
    ) {
      return (
        <p role="status" aria-busy="true" className="git-diff__message">
          {messages.diffLoading}
        </p>
      );
    }
    return <GitDiffContent diff={diff.result} />;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the view from anywhere inside it
    <div
      ref={root}
      className="git-diff"
      onKeyDown={(event) => {
        if (event.key === CLOSE_KEY) {
          event.preventDefault();
          close();
        }
      }}
    >
      <header className="git-diff__header">
        <h2 className="git-diff__path">{pathText}</h2>
        {showSwitch ? (
          <div
            role="tablist"
            aria-label={messages.diffSideSwitchLabel}
            className="tab-list git-diff__sides"
          >
            {DIFF_SIDES.map((side, index) => {
              const active = side === selection.side;
              return (
                <button
                  key={side}
                  ref={(element) => {
                    if (element === null) tabElements.current.delete(side);
                    else tabElements.current.set(side, element);
                  }}
                  type="button"
                  role="tab"
                  id={`${tabIdPrefix}-${side}`}
                  aria-selected={active}
                  aria-controls={active ? panelId : undefined}
                  tabIndex={active ? 0 : -1}
                  className={active ? "tab tab--active" : "tab"}
                  onClick={() => switchTo(side)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {messages.diffSides[side]}
                </button>
              );
            })}
          </div>
        ) : null}
        <button type="button" className="button" onClick={close}>
          {messages.closeDiff}
        </button>
      </header>
      {showSwitch ? (
        <div
          id={panelId}
          className="git-diff__body"
          role="tabpanel"
          aria-labelledby={`${tabIdPrefix}-${selection.side}`}
        >
          {renderBody()}
        </div>
      ) : (
        <div className="git-diff__body">{renderBody()}</div>
      )}
    </div>
  );
}
