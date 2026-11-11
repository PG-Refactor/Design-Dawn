// Marks the found text on the canvas with the CSS Custom Highlight API: no element is
// added to the rendered Blocks (React owns them), the browser only paints ranges. The
// matches are found in the sources, while this marks the drawn text, so a match the
// rendering hides (a link's address) has no mark. Engines without the API show none.

import {
  findMatches,
  type TextQuery,
} from "../../domain/text-search/text-search";
import { BLOCK_ID_ATTRIBUTE } from "../canvas/block-dom";

const ALL_MATCHES = "design-dawn-find";
const WORLD_SELECTOR = ".canvas__world";
// Just below 1: invisible, but a change WebKit must paint again.
const REPAINT_OPACITY = "0.9999";
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

// Ranges of every occurrence inside one text node, in order (a match across elements, such
// as bold inside a word, is not marked).
function rangesIn(node: Text, query: TextQuery): Range[] {
  return findMatches(node.data, query).flatMap((match) => {
    // A text node holds no line break that matters here; offsets are in code points.
    const before = [...match.lineText].slice(0, match.start).join("");
    const lineStart = lineStartOf(node.data, match.line);
    const start = lineStart + before.length;
    const length = [...match.lineText]
      .slice(match.start, match.start + match.length)
      .join("").length;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + length);
    return [range];
  });
}

// Where line `line` (1-based) starts in `text`, in UTF-16 units.
function lineStartOf(text: string, line: number): number {
  let start = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", start);
    if (next === -1) return start;
    start = next + 1;
  }
  return start;
}

// WebKitGTK does not repaint text whose highlight was removed, so old marks would stay: the
// world layer (already a layer of its own, being transformed) is made to paint again by
// switching its opacity between 1 and just below.
function repaint(root: Element | null): void {
  const world = root?.querySelector<HTMLElement>(WORLD_SELECTOR);
  if (world === null || world === undefined) return;
  world.style.opacity =
    world.style.opacity === REPAINT_OPACITY ? "" : REPAINT_OPACITY;
}

export function paintFindHighlights(
  root: Element | null,
  query: TextQuery,
  current: CurrentHighlight | null,
): void {
  const highlights = registry();
  if (highlights === null) return;
  clearFindHighlights();
  repaint(root);
  if (root === null || query.text.length === 0) return;
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
      if (node instanceof Text) inBlock.push(...rangesIn(node, query));
    }
    all.push(...inBlock);
    if (current?.blockId === frame.getAttribute(BLOCK_ID_ATTRIBUTE)) {
      const range = inBlock[current.indexInBlock];
      if (range !== undefined) currentRanges.push(range);
    }
  }
  // An empty highlight is not registered: WebKitGTK does not repaint for one, so the
  // previous marks would stay.
  if (all.length > 0) highlights.set(ALL_MATCHES, new Highlight(...all));
  if (currentRanges.length > 0) {
    highlights.set(CURRENT_MATCH, new Highlight(...currentRanges));
  }
}

export function clearFindHighlights(): void {
  const highlights = registry();
  highlights?.delete(ALL_MATCHES);
  highlights?.delete(CURRENT_MATCH);
}
