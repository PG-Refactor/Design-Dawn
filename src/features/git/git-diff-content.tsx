import type { GitDiff } from "../../application/ports/git-gateway";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import { GitDiffTable } from "./git-diff-table";
import { formatByteLimit } from "./git-diff-text";

function DiffText({ diff }: { readonly diff: string }) {
  const messages = useMessages().git;
  const mode = useUiState((ui) => ui.diffViewMode);
  // The region is focusable so a keyboard user can scroll it.
  return (
    <section
      className="git-diff__scroll"
      aria-label={messages.diffTextLabel}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard to scroll it
      tabIndex={0}
    >
      <GitDiffTable diff={diff} mode={mode} />
    </section>
  );
}

// The result of a diff load by outcome (docs/git-development.md §11.10); every outcome is
// an answer, not a failure.
export function GitDiffContent({ diff }: { readonly diff: GitDiff }) {
  const messages = useMessages().git;
  switch (diff.outcome) {
    case "text":
      return <DiffText diff={diff.diff} />;
    case "empty":
      return <p className="git-diff__message">{messages.diffEmpty}</p>;
    case "untracked":
      return <p className="git-diff__message">{messages.diffUntracked}</p>;
    case "binary":
      return <p className="git-diff__message">{messages.diffBinary}</p>;
    case "tooLarge":
      return (
        <p className="git-diff__message">
          {messages.diffTooLargeText(formatByteLimit(diff.limitBytes))}
        </p>
      );
    case "notUtf8":
      return <p className="git-diff__message">{messages.diffNotUtf8}</p>;
  }
}
