import { DIFF_PANEL_ID, diffTabId } from "../workspace/tab-ids";
import { useGitState, useUiState } from "../workspace/workspace-hooks";
import { GitDiffView } from "./git-diff-view";
import "./git-panel.css";

// The tab panel of the active diff tab. Only the active diff is shown, so the view is
// remounted per tab and never shows another file's diff.
export function GitDiffPanel() {
  const mainTab = useUiState((ui) => ui.activeMainTab);
  const status = useGitState((git) => git.status);
  if (mainTab.kind !== "diff") return null;
  const selection = { path: mainTab.path, side: mainTab.side };
  return (
    <section
      role="tabpanel"
      id={DIFF_PANEL_ID}
      aria-labelledby={diffTabId(selection.path, selection.side)}
      className="git-main-area"
    >
      <GitDiffView
        key={`${selection.side}:${selection.path}`}
        selection={selection}
        status={status}
      />
    </section>
  );
}
