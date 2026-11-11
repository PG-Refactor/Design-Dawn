// Marks the found text on the canvas with the CSS Custom Highlight API: no element is
// added to the rendered Blocks (React owns them), the browser only paints ranges. The
// matches are found in the sources, while this marks the drawn text, so a match the
// rendering hides (a link's address) has no mark. Engines without the API show none.

import { BLOCK_ID_ATTRIBUTE } from "../canvas/block-dom";

const ALL_MATCHES = "design-dawn-find";
const CURRENT_MATCH = "design-dawn-find-current";

export interface CurrentHighlight {
  readonly blockId: string;
  // Its place among the matches of its Block.
  readonly indexInBlock: number;
}

function registry(): HighlightRegistry | null {
  return typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
    ? CSS.highlights
    : null;
}

function fold(text: string, matchCase: boolean): string {
  return matchCase ? text : text.toLowerCase();
}

// Ranges of every occurrence inside one text node, in order. Case folding that changes a
// text's length (rare letters) would shift offsets, so such text is left unmarked.
function rangesIn(node: Text, needle: string, matchCase: boolean): Range[] {
  const text = node.data;
  const folded = fold(text, matchCase);
  if (folded.length !== text.length) return [];
  const ranges: Range[] = [];
  let from = folded.indexOf(needle);
  while (from !== -1) {
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, from + needle.length);
    ranges.push(range);
    from = folded.indexOf(needle, from + needle.length);
  }
  return ranges;
}

export function paintFindHighlights(
  root: Element | null,
  query: string,
  matchCase: boolean,
  current: CurrentHighlight | null,
): void {
  const highlights = registry();
  if (highlights === null) return;
  clearFindHighlights();
  if (root === null || query.length === 0) return;
  const needle = fold(query, matchCase);
  const all: Range[] = [];
  const currentRanges: Range[] = [];
  for (const frame of root.querySelectorAll(`[${BLOCK_ID_ATTRIBUTE}]`)) {
    const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
    const inBlock: Range[] = [];
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      if (node instanceof Text)
        inBlock.push(...rangesIn(node, needle, matchCase));
    }
    all.push(...inBlock);
    if (current?.blockId === frame.getAttribute(BLOCK_ID_ATTRIBUTE)) {
      const range = inBlock[current.indexInBlock];
      if (range !== undefined) currentRanges.push(range);
    }
  }
  highlights.set(ALL_MATCHES, new Highlight(...all));
  highlights.set(CURRENT_MATCH, new Highlight(...currentRanges));
}

export function clearFindHighlights(): void {
  const highlights = registry();
  highlights?.delete(ALL_MATCHES);
  highlights?.delete(CURRENT_MATCH);
}
