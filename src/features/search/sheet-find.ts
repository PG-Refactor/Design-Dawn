// The matches of the find box over the canvas: every occurrence in the text and caption
// of the shown sheet's Blocks, in the order the sheet reads (Blocks from the top, then
// from the left; in a Block its caption where it is shown, above or below the text).

import type { MatchPlace } from "../../application/ports/search-types";
import type { Block } from "../../domain/block/block";
import type { BlockId } from "../../domain/shared/entity-id";
import { findMatches } from "../../domain/text-search/text-search";

export interface SheetMatch {
  readonly blockId: BlockId;
  readonly place: MatchPlace;
  readonly line: number;
  // Its place among the occurrences of its line (what a single replace names).
  readonly ordinal: number;
  // Its place among the matches of its Block (which highlight on screen is it).
  readonly indexInBlock: number;
}

function inReadingOrder(blocks: readonly Block[]): Block[] {
  return [...blocks].sort(
    (left, right) =>
      left.position.y - right.position.y || left.position.x - right.position.x,
  );
}

function placeMatches(
  blockId: BlockId,
  place: MatchPlace,
  text: string,
  query: string,
  matchCase: boolean,
): Omit<SheetMatch, "indexInBlock">[] {
  const perLine = new Map<number, number>();
  return findMatches(text, query, matchCase).map((match) => {
    const ordinal = perLine.get(match.line) ?? 0;
    perLine.set(match.line, ordinal + 1);
    return { blockId, place, line: match.line, ordinal };
  });
}

export function sheetMatches(
  blocks: readonly Block[],
  contents: ReadonlyMap<BlockId, string>,
  query: string,
  matchCase: boolean,
): SheetMatch[] {
  if (query.length === 0) return [];
  return inReadingOrder(blocks).flatMap((block) => {
    const text = contents.get(block.blockId);
    const inText =
      text === undefined
        ? []
        : placeMatches(block.blockId, "text", text, query, matchCase);
    const inCaption =
      block.caption === undefined
        ? []
        : placeMatches(
            block.blockId,
            "caption",
            block.caption,
            query,
            matchCase,
          );
    const ordered =
      block.captionPosition === "above"
        ? [...inCaption, ...inText]
        : [...inText, ...inCaption];
    return ordered.map((match, indexInBlock) => ({ ...match, indexInBlock }));
  });
}
