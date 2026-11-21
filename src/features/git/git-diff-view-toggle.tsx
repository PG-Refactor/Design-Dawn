import {
  setDiffContentMode,
  setDiffViewMode,
} from "../workspace/ui-state/shell-ui-state";
import {
  DIFF_CONTENT_MODES,
  type DiffContentMode,
} from "../workspace/ui-state/ui-state";
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

// Text or looks, for a diff of a file inside a Sheet: two buttons, the chosen one pressed.
// The choice is shared by all diff tabs of this window, like the layout.
export function DiffContentModeSwitch() {
  const messages = useMessages().git.sheetDiff;
  const { uiStateStore } = useWorkspaceServices();
  const mode = useUiState((ui) => ui.diffContentMode);
  const label: Readonly<Record<DiffContentMode, string>> = {
    text: messages.text,
    visual: messages.visual,
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a small toolbar-like group.
    <div
      role="group"
      aria-label={messages.modeGroup}
      className="git-diff__modes"
    >
      {DIFF_CONTENT_MODES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          className="git-diff__mode"
          aria-pressed={mode === candidate}
          onClick={() =>
            uiStateStore.setState((state) =>
              setDiffContentMode(state, candidate),
            )
          }
        >
          {label[candidate]}
        </button>
      ))}
    </div>
  );
}
