// The sheet grows right and down from the world origin, like a spreadsheet: the view
// cannot be panned past its top-left corner, and a move cannot take blocks past it.
// Blocks that are already left of or above the origin (files written before this rule, or
// edited by hand / an AI tool) move that corner out, so they stay reachable.

import type { Viewport } from "../../../application/local-state/viewport";
import { boundsOfRects } from "./selection-bounds";
import {
  clampViewport,
  type Extent,
  type Point,
  type Rect,
} from "./viewport-math";

interface Placed {
  readonly position: Point;
  readonly size: Extent;
}

export function sheetOriginOf(blocks: readonly Placed[]): Point {
  const bounds = boundsOfRects(
    blocks.map((block) => ({ ...block.position, ...block.size })),
  );
  return {
    x: Math.min(0, bounds?.x ?? 0),
    y: Math.min(0, bounds?.y ?? 0),
  };
}

export function keepOriginInView(viewport: Viewport, origin: Point): Viewport {
  // `+ 0` turns -0 into 0, so a view stopped at the origin compares equal to the default.
  const maxPanX = -origin.x * viewport.zoom + 0;
  const maxPanY = -origin.y * viewport.zoom + 0;
  if (viewport.panX <= maxPanX && viewport.panY <= maxPanY) return viewport;
  return clampViewport({
    panX: Math.min(viewport.panX, maxPanX),
    panY: Math.min(viewport.panY, maxPanY),
    zoom: viewport.zoom,
  });
}

// A selection already beyond the origin may stay there but not go further.
export function keepMoveRightOfOrigin(
  selectionBounds: Rect | null,
  delta: Point,
): Point {
  if (selectionBounds === null) return delta;
  return {
    x: Math.max(delta.x, Math.min(0, -selectionBounds.x)),
    y: Math.max(delta.y, Math.min(0, -selectionBounds.y)),
  };
}
