import { type FormEvent, useState } from "react";
import type {
  SearchMatch,
  SearchResult,
} from "../../application/ports/search-types";
import type { ApplicationState } from "../../application/state/application-state";
import type { BlockId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./search-panel.css";

// What Rust stops at; shown in the "only the first N" note.
const SEARCH_RESULT_LIMIT = 500;

type SearchStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | {
      readonly kind: "done";
      readonly query: string;
      readonly matchCase: boolean;
      readonly result: SearchResult;
    };

interface BlockGroup {
  readonly key: BlockId;
  readonly documentName: string;
  readonly sheetName: string;
  readonly matches: readonly SearchMatch[];
}

// Matches of one Block together, in the order Rust (and the overlay) returned them.
function groupByBlock(matches: readonly SearchMatch[]): BlockGroup[] {
  const groups = new Map<BlockId, SearchMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.blockId);
    if (group === undefined) groups.set(match.blockId, [match]);
    else group.push(match);
  }
  return [...groups.entries()].map(([key, grouped]) => ({
    key,
    documentName: grouped[0]?.documentName ?? "",
    sheetName: grouped[0]?.sheetName ?? "",
    matches: grouped,
  }));
}

function Excerpt({ match }: { readonly match: SearchMatch }) {
  const characters = [...match.excerpt];
  const before = characters.slice(0, match.matchStart).join("");
  const found = characters
    .slice(match.matchStart, match.matchStart + match.matchLength)
    .join("");
  const after = characters.slice(match.matchStart + match.matchLength).join("");
  return (
    <span className="search-panel__excerpt">
      {before}
      <mark className="search-panel__mark">{found}</mark>
      {after}
    </span>
  );
}

const selectHasProject = (application: ApplicationState) =>
  application.project !== null;

// The Search tab of the sidebar: find text in every Block and caption of the Project, show
// a match on its sheet, and replace text in Blocks.
export function SearchPanel() {
  const messages = useMessages().search;
  const { searchActions, applicationStore } = useWorkspaceServices();
  const hasProject = useStoreSelector(applicationStore, selectHasProject);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [status, setStatus] = useState<SearchStatus>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);

  async function runSearch(text: string, caseSensitive: boolean) {
    if (text.length === 0) return;
    setStatus({ kind: "searching" });
    const found = await searchActions.search({
      text,
      matchCase: caseSensitive,
    });
    setStatus(
      found.ok
        ? {
            kind: "done",
            query: text,
            matchCase: caseSensitive,
            result: found.value,
          }
        : { kind: "idle" },
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    void runSearch(query, matchCase);
  }

  async function replaceIn(groups: readonly BlockGroup[]) {
    if (status.kind !== "done") return;
    const blocks = groups
      .map((group) => group.matches.find((match) => match.place === "text"))
      .filter((match): match is SearchMatch => match !== undefined)
      .map(({ documentId, sheetId, blockId }) => ({
        documentId,
        sheetId,
        blockId,
      }));
    const replaced = await searchActions.replaceInBlocks({
      text: status.query,
      matchCase: status.matchCase,
      replacement,
      blocks,
    });
    if (replaced.ok) setNotice(messages.replaced(replaced.value));
    await runSearch(status.query, status.matchCase);
  }

  if (!hasProject) {
    return <p className="search-panel__empty">{messages.noProject}</p>;
  }

  const groups =
    status.kind === "done" ? groupByBlock(status.result.matches) : [];
  const replaceable = groups.filter((group) =>
    group.matches.some((match) => match.place === "text"),
  );

  return (
    <section className="search-panel" aria-label={messages.title}>
      <form className="search-panel__form" onSubmit={onSubmit}>
        <input
          type="search"
          className="search-panel__input"
          aria-label={messages.queryLabel}
          placeholder={messages.queryLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="search-panel__option">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(event) => setMatchCase(event.target.checked)}
          />
          {messages.matchCase}
        </label>
        <button
          type="submit"
          className="button"
          disabled={query.length === 0 || status.kind === "searching"}
        >
          {messages.search}
        </button>
        <input
          type="text"
          className="search-panel__input"
          aria-label={messages.replacementLabel}
          placeholder={messages.replacementLabel}
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
        <button
          type="button"
          className="button"
          disabled={replaceable.length === 0}
          title={messages.replaceNote}
          onClick={() => void replaceIn(replaceable)}
        >
          {messages.replaceAll}
        </button>
      </form>
      <div className="search-panel__status" role="status">
        {status.kind === "searching" && messages.searching}
        {status.kind === "done" &&
          (status.result.matches.length === 0
            ? messages.noMatches
            : messages.matchCount(status.result.matches.length))}
        {notice !== null && <p>{notice}</p>}
        {status.kind === "done" && status.result.truncated && (
          <p>{messages.truncated(SEARCH_RESULT_LIMIT)}</p>
        )}
        {status.kind === "done" && status.result.unreadableBlocks > 0 && (
          <p>{messages.unreadable(status.result.unreadableBlocks)}</p>
        )}
      </div>
      <ul className="search-panel__results">
        {groups.map((group) => {
          const where = `${group.documentName} / ${group.sheetName}`;
          const hasText = group.matches.some((match) => match.place === "text");
          return (
            <li key={group.key} className="search-panel__group">
              <div className="search-panel__group-header">
                <span className="search-panel__where">{where}</span>
                {hasText && (
                  <button
                    type="button"
                    className="button search-panel__replace"
                    aria-label={messages.replaceBlockLabel(where)}
                    onClick={() => void replaceIn([group])}
                  >
                    {messages.replaceBlock}
                  </button>
                )}
              </div>
              <ul className="search-panel__matches">
                {group.matches.map((match, index) => (
                  <li
                    // A Block's matches never change order within one result.
                    // biome-ignore lint/suspicious/noArrayIndexKey: matches of one block have no id of their own.
                    key={index}
                  >
                    <button
                      type="button"
                      className="search-panel__match"
                      onClick={() =>
                        void searchActions.revealBlock({
                          documentId: match.documentId,
                          sheetId: match.sheetId,
                          blockId: match.blockId,
                        })
                      }
                    >
                      <span className="search-panel__line">
                        {match.place === "caption"
                          ? messages.caption
                          : messages.line(match.line)}
                      </span>
                      <Excerpt match={match} />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
