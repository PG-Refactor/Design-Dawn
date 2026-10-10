import { useMessages } from "../workspace/use-messages";
import { useGitState, useUiState } from "../workspace/workspace-hooks";
import { GitDiffView } from "./git-diff-view";
import "./git-panel.css";

// Takes the place of the document area while the Git panel is shown: the diff of the
// selected file, or what to do until one is selected.
export function GitMainArea() {
  const messages = useMessages().git;
  const selection = useUiState((ui) => ui.gitSelection);
  const status = useGitState((git) => git.status);
  return (
    <section className="git-main-area" aria-label={messages.mainAreaLabel}>
      {selection === null ? (
        <p className="git-main-area__placeholder">
          {messages.mainAreaPlaceholder}
        </p>
      ) : (
        <GitDiffView selection={selection} status={status} />
      )}
    </section>
  );
}
