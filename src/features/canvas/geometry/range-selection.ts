// Pure geometry of the range (rubber band) selection, in world coordinates.

import type { Block } from "../../../domain/block/block";
import type { BlockId } from "../../../domain/shared/entity-id";
import type { RangeSelectionMode } from "../../workspace/ui-state/ui-state";
import type { Point, Rect } from "./viewport-math";

// The rectangle spanned by two corners, whichever direction the pointer was dragged in.
export function normalizeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

// Closed intervals: rectangles that only touch along an edge or a corner intersect, and a
// rectangle inside another one does too.
export function rectsIntersect(first: Rect, second: Rect): boolean {
  return (
    first.x <= second.x + second.width &&
    second.x <= first.x + first.width &&
    first.y <= second.y + second.height &&
    second.y <= first.y + first.height
  );
}

// Back-to-front, like the sheet's blocks.
export function blocksHitByRect(
  blocks: readonly Block[],
  rect: Rect,
): readonly BlockId[] {
  return blocks
    .filter((block) =>
      rectsIntersect(rect, {
        x: block.position.x,
        y: block.position.y,
        width: block.size.width,
        height: block.size.height,
      }),
    )
    .map((block) => block.blockId);
}

// `replace`: the hit blocks become the selection (none hit = empty selection).
// `toggle`: each hit block flips its membership in the current selection.
export function applyRangeHit(
  current: ReadonlySet<BlockId>,
  hit: readonly BlockId[],
  mode: RangeSelectionMode,
): readonly BlockId[] {
  if (mode === "replace") return hit;
  const next = new Set(current);
  for (const blockId of hit) {
    if (!next.delete(blockId)) next.add(blockId);
  }
  return [...next];
}
