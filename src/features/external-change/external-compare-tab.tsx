import { type KeyboardEvent, useId } from "react";
import { COMPARE_PANEL_ID, COMPARE_TAB_ID } from "../workspace/tab-ids";
import type { CompareTab } from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { documentNameOf, useAppState } from "./use-external-change";
import "../git/git-panel.css";

interface ExternalCompareTabItemProps {
  readonly tab: CompareTab;
  readonly isActive: boolean;
  readonly isTabStop: boolean;
  readonly register: (element: HTMLButtonElement | null) => void;
  readonly onActivate: () => void;
  readonly onClose: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

const PATH_SEPARATOR = "/";

// The compare tab of the main tab strip. It is told from Document tabs by the diff mark and
// from diff tabs by its title ("Compare: <file>"); the Document and the full path are its
// accessible description.
export function ExternalCompareTabItem({
  tab,
  isActive,
  isTabStop,
  register,
  onActivate,
  onClose,
  onKeyDown,
}: ExternalCompareTabItemProps) {
  const messages = useMessages();
  const texts = messages.workspace.externalChange;
  const application = useAppState();
  const descriptionId = useId();
  const fileName = tab.path.split(PATH_SEPARATOR).at(-1) ?? tab.path;
  const documentName =
    documentNameOf(application, tab.documentId) ??
    messages.workspace.tree.unnamedEntity;
  const title = texts.compareTabTitle(fileName);
  const description = texts.compareTabDescription(documentName, tab.path);
  const classNames = ["tab", "tab--diff"];
  if (isActive) classNames.push("tab--active");
  return (
    <div className={classNames.join(" ")}>
      <button
        ref={register}
        type="button"
        role="tab"
        id={COMPARE_TAB_ID}
        aria-selected={isActive}
        aria-controls={isActive ? COMPARE_PANEL_ID : undefined}
        aria-describedby={descriptionId}
        title={description}
        tabIndex={isTabStop ? 0 : -1}
        className="tab__select"
        onClick={onActivate}
        onKeyDown={onKeyDown}
      >
        <span className="tab__icon" aria-hidden="true">
          {messages.git.diffTabIcon}
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
        aria-label={texts.compareClose}
        onClick={onClose}
      >
        <span aria-hidden="true">
          {messages.workspace.tabs.closeButtonText}
        </span>
      </button>
    </div>
  );
}
