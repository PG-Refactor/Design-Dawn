// Align: moves the selected blocks so one reference line of their bounding box is shared.
// Only the aligned axis changes; sizes, content and z-order are untouched. No grid snap:
// aligning to a box edge at 137 gives 137.

import type { BlockMove } from "../../../application/commands/block-commands";
import { commitPosition } from "../../../application/commit-geometry";
import type { Block } from "../../../domain/block/block";
import { type DomainResult, ok } from "../../../domain/shared/domain-result";
import { boundsOfRects } from "./selection-bounds";
import type { Rect } from "./viewport-math";

export const ALIGN_MODES = [
  "alignLeft",
  "alignHorizontalCenter",
  "alignRight",
  "alignTop",
  "alignVerticalCenter",
  "alignBottom",
] as const;

export type AlignMode = (typeof ALIGN_MODES)[number];

// New x / y of a block of `rect`'s size, relative to the selection `box`. Centres may be
// half-integers; they are rounded by commit-geometry (half toward +infinity), the same
// rule as every other fractional UI value.
const TARGETS: Readonly<
  Record<AlignMode, (rect: Rect, box: Rect) => { x?: number; y?: number }>
> = {
  alignLeft: (_rect, box) => ({ x: box.x }),
  alignHorizontalCenter: (rect, box) => ({
    x: box.x + (box.width - rect.width) / 2,
  }),
  alignRight: (rect, box) => ({ x: box.x + box.width - rect.width }),
  alignTop: (_rect, box) => ({ y: box.y }),
  alignVerticalCenter: (rect, box) => ({
    y: box.y + (box.height - rect.height) / 2,
  }),
  alignBottom: (rect, box) => ({ y: box.y + box.height - rect.height }),
};

// Moves for the blocks whose (rounded) position actually changes, in the given order.
// Fewer than two blocks have nothing to align to: no moves.
export function alignedMoves(
  blocks: readonly Block[],
  mode: AlignMode,
): DomainResult<readonly BlockMove[]> {
  if (blocks.length < 2) return ok([]);
  const rects = blocks.map(
    (block): Rect => ({
      x: block.position.x,
      y: block.position.y,
      width: block.size.width,
      height: block.size.height,
    }),
  );
  const box = boundsOfRects(rects);
  if (box === null) return ok([]);
  const moves: BlockMove[] = [];
  for (const [index, block] of blocks.entries()) {
    const rect = rects[index];
    if (rect === undefined) continue;
    const target = TARGETS[mode](rect, box);
    const position = commitPosition({
      x: target.x ?? block.position.x,
      y: target.y ?? block.position.y,
    });
    if (!position.ok) return position;
    if (
      position.value.x !== block.position.x ||
      position.value.y !== block.position.y
    ) {
      moves.push({ blockId: block.blockId, position: position.value });
    }
  }
  return ok(moves);
}
