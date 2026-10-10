import { setDiffViewMode } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { InlineViewIcon } from "./git-icons";

// Pressed = inline layout; the name stays the same (a toggle button's state is aria-pressed).
// The choice is shared by all diff tabs of this window.
export function DiffViewToggle() {
  const messages = useMessages().git;
  const { uiStateStore } = useWorkspaceServices();
  const inline = useUiState((ui) => ui.diffViewMode === "inline");
  return (
    <button
      type="button"
      className="git-icon-button git-diff__toggle"
      aria-label={messages.diffViewToggle}
      title={messages.diffViewToggle}
      aria-pressed={inline}
      onClick={() =>
        uiStateStore.setState((state) =>
          setDiffViewMode(state, inline ? "split" : "inline"),
        )
      }
    >
      <InlineViewIcon />
    </button>
  );
}
