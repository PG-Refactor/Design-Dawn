import { type KeyboardEvent, useId } from "react";
import { DIFF_PANEL_ID, diffTabId } from "../workspace/tab-ids";
import type { DiffTab } from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { useGitState } from "../workspace/workspace-hooks";
import { splitGitPath } from "./git-change-path";
import { changeSidesOf } from "./git-change-sections";
import "./git-panel.css";

interface GitDiffTabItemProps {
  readonly tab: DiffTab;
  readonly isActive: boolean;
  readonly isTabStop: boolean;
  readonly register: (element: HTMLButtonElement | null) => void;
  readonly onActivate: () => void;
  readonly onPin: () => void;
  readonly onClose: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

// One diff tab of the main tab strip: title "<name> (Working Tree|Index)", a diff mark
// (the tab is told from a Document tab by it, not by colour), italic while it is the
// preview tab. The full path (and "old -> new" for a rename) and the preview state are the
// tab's accessible description and tooltip.
export function GitDiffTabItem({
  tab,
  isActive,
  isTabStop,
  register,
  onActivate,
  onPin,
  onClose,
  onKeyDown,
}: GitDiffTabItemProps) {
  const messages = useMessages().git;
  const workspaceMessages = useMessages().workspace;
  const status = useGitState((git) => git.status);
  const descriptionId = useId();
  const originalPath =
    status === null || tab.side !== "staged"
      ? null
      : (changeSidesOf(status, tab.path).staged?.originalPath ?? null);
  const pathText =
    originalPath === null
      ? tab.path
      : messages.renamedPathText(originalPath, tab.path);
  const description = messages.diffTabDescription(pathText, tab.preview);
  const title = messages.diffTabTitle(splitGitPath(tab.path).name, tab.side);
  const classNames = ["tab", "tab--diff"];
  if (isActive) classNames.push("tab--active");
  if (tab.preview) classNames.push("tab--preview");

  return (
    <div className={classNames.join(" ")}>
      <button
        ref={register}
        type="button"
        role="tab"
        id={diffTabId(tab.path, tab.side)}
        aria-selected={isActive}
        aria-controls={isActive ? DIFF_PANEL_ID : undefined}
        aria-describedby={descriptionId}
        title={description}
        tabIndex={isTabStop ? 0 : -1}
        className="tab__select"
        onClick={onActivate}
        onDoubleClick={onPin}
        onKeyDown={onKeyDown}
      >
        <span className="tab__icon" aria-hidden="true">
          {messages.diffTabIcon}
        </span>
        <span className="tab__name">{title}</span>
      </button>
      <span id={descriptionId} className="git-visually-hidden">
        {description}
      </span>
      <button
        type="button"
        className="tab__control"
        tabIndex={isTabStop ? 0 : -1}
        aria-label={workspaceMessages.closeTabLabel(title)}
        onClick={onClose}
      >
        <span aria-hidden="true">{workspaceMessages.tabs.closeButtonText}</span>
      </button>
    </div>
  );
}
