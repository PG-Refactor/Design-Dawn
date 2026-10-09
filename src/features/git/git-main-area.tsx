import { useGitState, useUiState } from "../workspace/workspace-hooks";
import { GitDiffView } from "./git-diff-view";
import { GIT_MESSAGES } from "./git-messages";
import "./git-panel.css";

// Takes the place of the document area while the Git panel is shown: the diff of the
// selected file, or what to do until one is selected.
export function GitMainArea() {
  const selection = useUiState((ui) => ui.gitSelection);
  const status = useGitState((git) => git.status);
  return (
    <section className="git-main-area" aria-label={GIT_MESSAGES.mainAreaLabel}>
      {selection === null ? (
        <p className="git-main-area__placeholder">
          {GIT_MESSAGES.mainAreaPlaceholder}
        </p>
      ) : (
        <GitDiffView selection={selection} status={status} />
      )}
    </section>
  );
}
