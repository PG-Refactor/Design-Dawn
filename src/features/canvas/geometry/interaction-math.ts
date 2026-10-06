// Pure calculations of the drag / resize gestures. Preview values are fractional (UI
// state); the application's `commit-geometry` turns them into validated integers when the
// gesture ends.

import { CANVAS_CONFIG } from "../../../config/canvas-config";
import type { Extent, Point, Rect } from "./viewport-math";

export function dragPreviewPosition(
  blockPosition: Point,
  worldDelta: Point,
): Point {
  return {
    x: blockPosition.x + worldDelta.x,
    y: blockPosition.y + worldDelta.y,
  };
}

// Bottom-right handle: the origin stays, the size follows the pointer but never drops
// below `minSize` (so it is never zero or negative).
export function resizePreviewFrame(
  startFrame: Rect,
  worldDelta: Point,
  minSize: Extent = CANVAS_CONFIG.block.minSize,
): Rect {
  return {
    x: startFrame.x,
    y: startFrame.y,
    width: Math.max(minSize.width, startFrame.width + worldDelta.x),
    height: Math.max(minSize.height, startFrame.height + worldDelta.y),
  };
}

// Strictly beyond: a press that moves exactly the threshold is still a click.
export function exceedsDragThreshold(
  start: Point,
  current: Point,
  thresholdPx: number = CANVAS_CONFIG.interaction.dragThresholdPx,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > thresholdPx;
}

export function pointDifference(to: Point, from: Point): Point {
  return { x: to.x - from.x, y: to.y - from.y };
}
