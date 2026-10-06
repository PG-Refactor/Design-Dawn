// Pure geometry and decisions of the pointer drag that reorders the Sheet Tabs. Kept free
// of the DOM so the rules are testable without layout.

// How far the pointer must travel from where it went down before a press becomes a drag;
// below it the gesture is still a click that selects the tab.
export const DRAG_START_THRESHOLD_PX = 5;

export interface TabRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

export function exceedsDragThreshold(
  start: PointerPoint,
  current: PointerPoint,
): boolean {
  return (
    Math.hypot(current.x - start.x, current.y - start.y) >=
    DRAG_START_THRESHOLD_PX
  );
}

// The insertion slot under the pointer: 0 = before the first tab, rects.length = after the
// last one. A tab is "passed" when the pointer is on a later row, or on its row beyond its
// middle (the tab strip wraps, so the row matters).
export function dropSlotAt(
  rects: readonly TabRect[],
  point: PointerPoint,
): number {
  return rects.filter((rect) => {
    if (point.y > rect.bottom) return true;
    if (point.y < rect.top) return false;
    return point.x > (rect.left + rect.right) / 2;
  }).length;
}

export interface TabDropTarget<Id> {
  // The tab to put the dragged one in front of; null = last.
  readonly before: Id | null;
}

// Where a drop at `slot` puts the dragged tab, or null when that is where it already is
// (the slots directly before and after it): a drop there is not a move.
export function dropTargetOf<Id>(
  tabIds: readonly Id[],
  draggedId: Id,
  slot: number,
): TabDropTarget<Id> | null {
  const index = tabIds.indexOf(draggedId);
  if (index < 0 || slot === index || slot === index + 1) return null;
  return { before: tabIds[slot] ?? null };
}
