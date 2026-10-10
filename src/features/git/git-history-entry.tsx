import type { GitHistoryEntry as HistoryEntry } from "../../application/ports/git-gateway";
import { useDisplayLanguage, useMessages } from "../workspace/use-messages";
import { formatCommitDate, shortCommitId } from "./git-history-format";

// One commit. Every value is rendered as React text, never as markup. The email address is
// not shown. The short ID carries the full one in its accessible name (screen readers) and in
// `title` (hover); it is not a tab stop, which the a11y lint rule forbids on plain text.
export function GitHistoryEntryRow({
  entry,
}: {
  readonly entry: HistoryEntry;
}) {
  const messages = useMessages().git;
  const language = useDisplayLanguage();
  return (
    <li className="git-history-entry">
      <p className="git-history-entry__summary">{entry.summary}</p>
      <p className="git-history-entry__meta">
        <code
          className="git-history-entry__id"
          role="note"
          title={entry.commitId}
          aria-label={messages.commitIdLabel(entry.commitId)}
        >
          {shortCommitId(entry.commitId)}
        </code>
        <span className="git-history-entry__author">{entry.authorName}</span>
        <time dateTime={entry.authorDate} title={entry.authorDate}>
          {formatCommitDate(entry.authorDate, language)}
        </time>
      </p>
    </li>
  );
}
