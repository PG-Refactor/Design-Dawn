// Bounding box of several rectangles, shared by the snap (moving a selection) and the
// align operations (both use the selection as one unit).

import type { Rect } from "./viewport-math";

// Null for an empty list: there is no box to speak of.
export function boundsOfRects(rects: readonly Rect[]): Rect | null {
  const [first, ...rest] = rects;
  if (first === undefined) return null;
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const rect of rest) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
