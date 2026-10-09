import type { GitDiff } from "../../application/ports/git-gateway";
import { classifyDiffLines, formatByteLimit } from "./git-diff-text";
import { diffTooLargeText, GIT_MESSAGES } from "./git-messages";

function DiffText({ diff }: { readonly diff: string }) {
  // Repository text: only ever rendered as React text, never as markup. The region is
  // focusable so a keyboard user can scroll it.
  return (
    <section
      className="git-diff__scroll"
      aria-label={GIT_MESSAGES.diffTextLabel}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard to scroll it
      tabIndex={0}
    >
      <pre className="git-diff__text">
        {classifyDiffLines(diff).map((line) => (
          <span
            key={line.number}
            className={`git-diff__line git-diff__line--${line.kind}`}
          >
            {line.text}
          </span>
        ))}
      </pre>
    </section>
  );
}

// The result of a diff load by outcome (docs/git-development.md §11.10); every outcome is
// an answer, not a failure.
export function GitDiffContent({ diff }: { readonly diff: GitDiff }) {
  switch (diff.outcome) {
    case "text":
      return <DiffText diff={diff.diff} />;
    case "empty":
      return <p className="git-diff__message">{GIT_MESSAGES.diffEmpty}</p>;
    case "untracked":
      return <p className="git-diff__message">{GIT_MESSAGES.diffUntracked}</p>;
    case "binary":
      return <p className="git-diff__message">{GIT_MESSAGES.diffBinary}</p>;
    case "tooLarge":
      return (
        <p className="git-diff__message">
          {diffTooLargeText(formatByteLimit(diff.limitBytes))}
        </p>
      );
    case "notUtf8":
      return <p className="git-diff__message">{GIT_MESSAGES.diffNotUtf8}</p>;
  }
}
