import { useEffect, useRef, useState } from "react";
import type {
  MatchPlace,
  SearchMatch,
  SearchResult,
} from "../../application/ports/search-types";
import type { ApplicationState } from "../../application/state/application-state";
import { SEARCH_CONFIG } from "../../config/search-config";
import type { BlockId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { FindFieldsView } from "./find-fields";
import type { FindFields, FindState } from "./find-store";
import type { ReplaceOutcome } from "./search-actions";
import type { SearchMessages } from "./search-messages";
import "./search-panel.css";

type SearchStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | {
      readonly kind: "done";
      readonly query: string;
      readonly matchCase: boolean;
      readonly result: SearchResult;
    };

// A match with its place among the occurrences of its line (what a single replace names).
interface NumberedMatch {
  readonly match: SearchMatch;
  readonly ordinal: number;
}

interface BlockGroup {
  readonly key: BlockId;
  readonly documentName: string;
  readonly sheetName: string;
  readonly matches: readonly NumberedMatch[];
}

// Matches of one Block together, in the order Rust (and the overlay) returned them: every
// occurrence of a line in order, so counting them per line gives each one's ordinal.
function groupByBlock(matches: readonly SearchMatch[]): BlockGroup[] {
  const groups = new Map<BlockId, NumberedMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.blockId) ?? [];
    const ordinal = group.filter(
      ({ match: other }) =>
        other.place === match.place && other.line === match.line,
    ).length;
    group.push({ match, ordinal });
    groups.set(match.blockId, group);
  }
  return [...groups.entries()].map(([key, grouped]) => ({
    key,
    documentName: grouped[0]?.match.documentName ?? "",
    sheetName: grouped[0]?.match.sheetName ?? "",
    matches: grouped,
  }));
}

function placesOf(group: BlockGroup): MatchPlace[] {
  const places = new Set(group.matches.map(({ match }) => match.place));
  return [...places];
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

function outcomeNotice(
  messages: SearchMessages,
  outcome: ReplaceOutcome,
): string {
  const replaced = messages.replaced(outcome.replaced);
  return outcome.captionsSkipped === 0
    ? replaced
    : `${replaced} ${messages.captionsSkipped(outcome.captionsSkipped)}`;
}

const selectHasProject = (application: ApplicationState) =>
  application.project !== null;
const selectFields = (state: FindState) => state.project;
const selectFocusRequest = (state: FindState) => state.focusRequest;

// The Search tab of the sidebar: finds text in every Block and caption of the Project as
// it is typed, shows a match on its sheet, and replaces one match, one Block or all.
export function SearchPanel() {
  const messages = useMessages().search;
  const { searchActions, applicationStore } = useWorkspaceServices();
  const { findStore } = searchActions;
  const hasProject = useStoreSelector(applicationStore, selectHasProject);
  const fields = useStoreSelector(findStore, selectFields);
  const focusRequest = useStoreSelector(findStore, selectFocusRequest);
  const [status, setStatus] = useState<SearchStatus>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  // Only the latest search may show its result (an earlier one can finish later).
  const latestSearch = useRef(0);

  async function runSearch(text: string, matchCase: boolean): Promise<void> {
    latestSearch.current += 1;
    const searchNumber = latestSearch.current;
    if (text.length === 0) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "searching" });
    const found = await searchActions.search({ text, matchCase });
    if (searchNumber !== latestSearch.current) return;
    setStatus(
      found.ok
        ? { kind: "done", query: text, matchCase, result: found.value }
        : { kind: "idle" },
    );
  }
  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;

  // Searches a moment after the text or the case option last changed (also when the tab
  // opens again with text in the box).
  useEffect(() => {
    if (!hasProject) return;
    const timer = setTimeout(
      () => void runSearchRef.current(fields.query, fields.matchCase),
      SEARCH_CONFIG.projectTypingDelayMs,
    );
    return () => clearTimeout(timer);
  }, [fields.query, fields.matchCase, hasProject]);

  useEffect(() => {
    if (focusRequest.target !== "project" || focusRequest.sequence === 0) {
      return;
    }
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [focusRequest]);

  function change(next: Partial<FindFields>): void {
    setNotice(null);
    findStore.setState((state) => ({
      ...state,
      project: { ...state.project, ...next },
    }));
  }

  async function afterReplace(
    replaced: Awaited<ReturnType<typeof searchActions.replaceMatch>>,
  ): Promise<void> {
    if (status.kind !== "done") return;
    if (replaced.ok) setNotice(outcomeNotice(messages, replaced.value));
    await runSearch(status.query, status.matchCase);
  }

  async function replaceGroups(groups: readonly BlockGroup[]): Promise<void> {
    if (status.kind !== "done") return;
    const targets = groups.flatMap((group) => {
      const first = group.matches[0]?.match;
      if (first === undefined) return [];
      return [
        {
          documentId: first.documentId,
          sheetId: first.sheetId,
          blockId: first.blockId,
          places: placesOf(group),
        },
      ];
    });
    await afterReplace(
      await searchActions.replaceInBlocks({
        text: status.query,
        matchCase: status.matchCase,
        replacement: fields.replacement,
        targets,
      }),
    );
  }

  async function replaceOne({ match, ordinal }: NumberedMatch): Promise<void> {
    if (status.kind !== "done") return;
    await afterReplace(
      await searchActions.replaceMatch({
        text: status.query,
        matchCase: status.matchCase,
        replacement: fields.replacement,
        location: {
          documentId: match.documentId,
          sheetId: match.sheetId,
          blockId: match.blockId,
        },
        place: match.place,
        at: { line: match.line, ordinal },
      }),
    );
  }

  if (!hasProject) {
    return <p className="search-panel__empty">{messages.noProject}</p>;
  }

  const groups =
    status.kind === "done" ? groupByBlock(status.result.matches) : [];

  return (
    <section className="search-panel" aria-label={messages.title}>
      <FindFieldsView
        fields={fields}
        labels={messages}
        queryRef={queryRef}
        onChange={change}
        onQueryEnter={() => void runSearch(fields.query, fields.matchCase)}
        onReplacementEnter={() => void replaceGroups(groups)}
        onReplaceAll={() => void replaceGroups(groups)}
        replaceDisabled={groups.length === 0}
      />
      <div className="search-panel__status" role="status">
        {status.kind === "searching" && messages.searching}
        {status.kind === "done" &&
          (status.result.matches.length === 0
            ? messages.noMatches
            : messages.matchSummary(
                status.result.matches.length,
                groups.length,
              ))}
        {notice !== null && <p>{notice}</p>}
        {status.kind === "done" && status.result.truncated && (
          <p>{messages.truncated(SEARCH_CONFIG.projectResultLimit)}</p>
        )}
        {status.kind === "done" && status.result.unreadableBlocks > 0 && (
          <p>{messages.unreadable(status.result.unreadableBlocks)}</p>
        )}
        {fields.replaceShown && groups.length > 0 && (
          <p>{messages.replaceNote}</p>
        )}
      </div>
      <ul className="search-panel__results">
        {groups.map((group) => {
          const where = `${group.documentName} / ${group.sheetName}`;
          return (
            <li key={group.key} className="search-panel__group">
              <div className="search-panel__group-header">
                <span className="search-panel__where" title={where}>
                  {where}
                </span>
                <span className="search-panel__count">
                  {group.matches.length}
                </span>
                {fields.replaceShown && (
                  <button
                    type="button"
                    className="search-panel__replace"
                    aria-label={messages.replaceBlockLabel(where)}
                    title={messages.replaceBlockLabel(where)}
                    onClick={() => void replaceGroups([group])}
                  >
                    <span aria-hidden="true">⇄</span>
                  </button>
                )}
              </div>
              <ul className="search-panel__matches">
                {group.matches.map((numbered) => {
                  const { match } = numbered;
                  const lineLabel =
                    match.place === "caption"
                      ? messages.caption
                      : messages.line(match.line);
                  return (
                    <li
                      key={`${match.place}-${match.line}-${numbered.ordinal}`}
                      className="search-panel__match-row"
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
                        <span className="search-panel__line">{lineLabel}</span>
                        <Excerpt match={match} />
                      </button>
                      {fields.replaceShown && (
                        <button
                          type="button"
                          className="search-panel__replace"
                          aria-label={messages.replaceMatchLabel(
                            `${where} ${lineLabel}`,
                          )}
                          title={messages.replaceMatchLabel(lineLabel)}
                          onClick={() => void replaceOne(numbered)}
                        >
                          <span aria-hidden="true">⇄</span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
