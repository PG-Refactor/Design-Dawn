import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import type { MatchPlace } from "../../application/ports/search-types";
import type { ApplicationState } from "../../application/state/application-state";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type { Extent } from "../canvas/geometry/viewport-math";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { FindFieldsView } from "./find-fields";
import { clearFindHighlights, paintFindHighlights } from "./find-highlights";
import type { FindFields, FindState, SheetFindState } from "./find-store";
import { type SheetMatch, sheetMatches } from "./sheet-find";
import "./sheet-find-widget.css";

const ESCAPE_KEY = "Escape";

const selectSheetFind = (state: FindState) => state.sheet;
const selectFocusRequest = (state: FindState) => state.focusRequest;

function wrap(index: number, length: number): number {
  return length === 0 ? 0 : ((index % length) + length) % length;
}

// The find box over the canvas (Ctrl+F): finds text in the shown sheet's Blocks and
// captions as it is typed, moves through the matches (Enter / Shift+Enter), shows the
// current one, and replaces it or all of them.
export function SheetFindWidget({
  documentId,
  sheetId,
  canvasRoot,
  measureCanvas,
}: {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  // Where the sheet's Blocks are drawn (for the marks on the found text).
  readonly canvasRoot: () => Element | null;
  readonly measureCanvas: () => Extent;
}) {
  const messages = useMessages().search;
  const { searchActions, applicationStore } = useWorkspaceServices();
  const { findStore } = searchActions;
  const find = useStoreSelector(findStore, selectSheetFind);
  const focusRequest = useStoreSelector(findStore, selectFocusRequest);
  const document = useStoreSelector(
    applicationStore,
    (state: ApplicationState) => state.documents.get(documentId),
  );
  const queryRef = useRef<HTMLInputElement>(null);
  const sheet = document?.sheets.get(sheetId);

  const matches = useMemo(
    () =>
      find.open && sheet !== undefined && document !== undefined
        ? sheetMatches(
            sheet.blocks,
            document.contents,
            find.query,
            find.matchCase,
          )
        : [],
    [find.open, find.query, find.matchCase, sheet, document],
  );
  const currentIndex = wrap(find.current, matches.length);
  const current: SheetMatch | undefined = matches[currentIndex];

  useEffect(() => {
    if (focusRequest.target !== "sheet" || focusRequest.sequence === 0) return;
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [focusRequest]);

  // The marks follow every change of the text, the matches and the drawn Blocks.
  useEffect(() => {
    if (!find.open) {
      clearFindHighlights();
      return;
    }
    paintFindHighlights(
      canvasRoot(),
      find.query,
      find.matchCase,
      current === undefined
        ? null
        : { blockId: current.blockId, indexInBlock: current.indexInBlock },
    );
  });
  useEffect(() => clearFindHighlights, []);

  function update(change: Partial<SheetFindState>): void {
    findStore.setState((state) => ({
      ...state,
      sheet: { ...state.sheet, ...change },
    }));
  }

  function reveal(match: SheetMatch | undefined): void {
    if (match === undefined) return;
    void searchActions.revealBlock(
      { documentId, sheetId, blockId: match.blockId },
      { keepIfVisibleIn: measureCanvas() },
    );
  }

  function go(step: number): void {
    const next = wrap(currentIndex + step, matches.length);
    update({ current: next });
    reveal(matches[next]);
  }

  function close(): void {
    update({ open: false });
  }

  // Escape, as in VS Code: the box closes and the current match is shown in its Block's
  // source editor (selected there), where the work goes on.
  function closeIntoEditor(): void {
    close();
    if (current === undefined) return;
    void searchActions.openMatch({
      text: find.query,
      matchCase: find.matchCase,
      location: { documentId, sheetId, blockId: current.blockId },
      place: current.place,
      at: { line: current.line, ordinal: current.ordinal },
      reveal: { keepIfVisibleIn: measureCanvas() },
    });
  }

  // A new text starts again at the sheet's first match, as it is typed.
  function onFieldsChange(change: Partial<FindFields>): void {
    const searchChanged =
      change.query !== undefined || change.matchCase !== undefined;
    update(searchChanged ? { ...change, current: 0 } : change);
    if (!searchChanged || sheet === undefined || document === undefined) return;
    reveal(
      sheetMatches(
        sheet.blocks,
        document.contents,
        change.query ?? find.query,
        change.matchCase ?? find.matchCase,
      )[0],
    );
  }

  async function replaceCurrent(): Promise<void> {
    if (current === undefined) return;
    // Afterwards the current index names the match after the replaced one.
    await searchActions.replaceMatch({
      text: find.query,
      matchCase: find.matchCase,
      replacement: find.replacement,
      location: { documentId, sheetId, blockId: current.blockId },
      place: current.place,
      at: { line: current.line, ordinal: current.ordinal },
    });
  }

  async function replaceAll(): Promise<void> {
    const places = new Map<BlockId, Set<MatchPlace>>();
    for (const match of matches) {
      places.set(
        match.blockId,
        (places.get(match.blockId) ?? new Set<MatchPlace>()).add(match.place),
      );
    }
    const targets = [...places].map(([blockId, blockPlaces]) => ({
      documentId,
      sheetId,
      blockId,
      places: [...blockPlaces],
    }));
    await searchActions.replaceInBlocks({
      text: find.query,
      matchCase: find.matchCase,
      replacement: find.replacement,
      targets,
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === ESCAPE_KEY) {
      event.preventDefault();
      event.stopPropagation();
      closeIntoEditor();
    }
  }

  if (!find.open) return null;

  const count =
    find.query.length === 0
      ? ""
      : matches.length === 0
        ? messages.noResults
        : messages.position(currentIndex + 1, matches.length);
  return (
    <search className="sheet-find" aria-label={messages.sheetFindLabel}>
      <FindFieldsView
        fields={find}
        labels={messages}
        queryRef={queryRef}
        onKeyDown={onKeyDown}
        onChange={onFieldsChange}
        onQueryEnter={(backwards) => go(backwards ? -1 : 1)}
        onReplacementEnter={() => void replaceCurrent()}
        onReplaceAll={() => void replaceAll()}
        replaceDisabled={matches.length === 0}
        queryTrailing={
          <>
            <span className="sheet-find__count" role="status">
              {count}
            </span>
            <button
              type="button"
              className="find-fields__action"
              aria-label={messages.previousMatch}
              title={messages.previousMatch}
              disabled={matches.length === 0}
              onClick={() => go(-1)}
            >
              <span aria-hidden="true" className="find-fields__icon">
                ↑
              </span>
            </button>
            <button
              type="button"
              className="find-fields__action"
              aria-label={messages.nextMatch}
              title={messages.nextMatch}
              disabled={matches.length === 0}
              onClick={() => go(1)}
            >
              <span aria-hidden="true" className="find-fields__icon">
                ↓
              </span>
            </button>
            <button
              type="button"
              className="find-fields__action"
              aria-label={messages.closeFind}
              title={messages.closeFind}
              onClick={close}
            >
              <span aria-hidden="true" className="find-fields__icon">
                ×
              </span>
            </button>
          </>
        }
        replaceButtons={
          <button
            type="button"
            className="find-fields__action"
            disabled={matches.length === 0}
            onClick={() => void replaceCurrent()}
          >
            {messages.replaceOne}
          </button>
        }
      />
    </search>
  );
}
