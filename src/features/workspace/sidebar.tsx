import { type KeyboardEvent, useRef } from "react";
import { GitPanel } from "../git/git-panel";
import { ProjectTree } from "./project-tree";
import { LEFT_PANEL_PANEL_ID, leftPanelTabId } from "./tab-ids";
import {
  LEFT_PANEL_MODES,
  type LeftPanelMode,
  type UiState,
} from "./ui-state/ui-state";
import { tabTargetIndex } from "./view-models/keyboard-navigation";
import { useUiState } from "./workspace-hooks";
import { MESSAGES } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./tabs.css";

const selectLeftPanelMode = (ui: UiState) => ui.leftPanelMode;

const MODE_LABELS: Record<LeftPanelMode, string> = {
  project: MESSAGES.leftPanel.project,
  git: MESSAGES.leftPanel.git,
};

// The sidebar content: a Project | Git switch above the Project Tree or the Git panel
// (docs/ui-design.md §13.1). The mode is window-local UI state.
export function Sidebar() {
  const { actions } = useWorkspaceServices();
  const mode = useUiState(selectLeftPanelMode);
  const tabElements = useRef(new Map<LeftPanelMode, HTMLButtonElement>());

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const target = tabTargetIndex(event.key, index, LEFT_PANEL_MODES.length);
    const targetMode = target === null ? undefined : LEFT_PANEL_MODES[target];
    if (targetMode === undefined) return;
    event.preventDefault();
    // Automatic activation, like the other tab lists.
    actions.setLeftPanelMode(targetMode);
    tabElements.current.get(targetMode)?.focus();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label={MESSAGES.leftPanel.tabsLabel}
        className="tab-list left-panel-tabs"
      >
        {LEFT_PANEL_MODES.map((tabMode, index) => {
          const isActive = tabMode === mode;
          return (
            <div key={tabMode} className={isActive ? "tab tab--active" : "tab"}>
              <button
                ref={(element) => {
                  if (element === null) tabElements.current.delete(tabMode);
                  else tabElements.current.set(tabMode, element);
                }}
                type="button"
                role="tab"
                id={leftPanelTabId(tabMode)}
                aria-selected={isActive}
                aria-controls={isActive ? LEFT_PANEL_PANEL_ID : undefined}
                tabIndex={isActive ? 0 : -1}
                className="tab__select"
                onClick={() => actions.setLeftPanelMode(tabMode)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <span className="tab__name">{MODE_LABELS[tabMode]}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={LEFT_PANEL_PANEL_ID}
        aria-labelledby={leftPanelTabId(mode)}
      >
        {mode === "git" ? <GitPanel /> : <ProjectTree />}
      </div>
    </>
  );
}
