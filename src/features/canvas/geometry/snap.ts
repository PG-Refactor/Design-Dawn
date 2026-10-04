// Grid snap of block move / resize. Everything is in WORLD units, so the result of a
// gesture does not depend on the zoom. `interval` must be > 0 (it comes from
// CANVAS_CONFIG.grid.interval, a constant).

import { CANVAS_CONFIG } from "../../../config/canvas-config";
import type { Extent, Point, Rect } from "./viewport-math";

// Nearest grid line. Exactly half-way values round toward +infinity (12 -> 24, -12 -> 0,
// -36 -> -24): one fixed rule, so the result never depends on the drag direction. The
// `+ 0` turns -0 into 0 so stored values compare equal to literals.
export function snapToGrid(value: number, interval: number): number {
  return Math.floor(value / interval + 0.5) * interval + 0;
}

// The selection moves as ONE box: the box's top-left lands on a grid line and every block
// gets the same delta, so their relative positions are preserved exactly. Snapping blocks
// individually would change the layout of a selection that is not on the grid.
export function snappedMoveDelta(
  selectionBounds: Rect,
  rawWorldDelta: Point,
  interval: number,
): Point {
  return {
    x:
      snapToGrid(selectionBounds.x + rawWorldDelta.x, interval) -
      selectionBounds.x +
      0,
    y:
      snapToGrid(selectionBounds.y + rawWorldDelta.y, interval) -
      selectionBounds.y +
      0,
  };
}

// Which edges of a frame a resize handle moves.
export interface ResizeEdges {
  readonly left?: boolean;
  readonly right?: boolean;
  readonly top?: boolean;
  readonly bottom?: boolean;
}

// The moving edges are snapped in world coordinates, the fixed edges stay exactly where
// they were. A moved axis is then kept at `minSize` by moving the snapped edge back (the
// result may be off-grid: the minimum wins over the grid). When both edges of an axis
// move, the far edge (right / bottom) is the one pulled back.
export function snappedResizeFrame(
  startFrame: Rect,
  rawWorldDelta: Point,
  edges: ResizeEdges,
  interval: number,
  minSize: Extent = CANVAS_CONFIG.block.minSize,
): Rect {
  let left = startFrame.x;
  let top = startFrame.y;
  let right = startFrame.x + startFrame.width;
  let bottom = startFrame.y + startFrame.height;
  if (edges.left === true) left = snapToGrid(left + rawWorldDelta.x, interval);
  if (edges.right === true) {
    right = snapToGrid(right + rawWorldDelta.x, interval);
  }
  if (edges.top === true) top = snapToGrid(top + rawWorldDelta.y, interval);
  if (edges.bottom === true) {
    bottom = snapToGrid(bottom + rawWorldDelta.y, interval);
  }
  if (right - left < minSize.width && (edges.left || edges.right)) {
    if (edges.right === true) right = left + minSize.width;
    else left = right - minSize.width;
  }
  if (bottom - top < minSize.height && (edges.top || edges.bottom)) {
    if (edges.bottom === true) bottom = top + minSize.height;
    else top = bottom - minSize.height;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
