// Drags Project Tree rows in jsdom, which has no layout: every row is given a box of a fixed
// height, stacked in display order, before the pointer moves.

import { type TreeRow, treeItemNamed, type UserSession } from "./shell-harness";

export const TREE_ROW_HEIGHT = 20;
const TREE_ROW_WIDTH = 200;
// Far enough to start a drag (past the click threshold).
const DRAG_START_DISTANCE = 10;
const POINTER_X = 50;

function rowBox(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + TREE_ROW_HEIGHT,
    left: 0,
    right: TREE_ROW_WIDTH,
    width: TREE_ROW_WIDTH,
    height: TREE_ROW_HEIGHT,
    toJSON: () => ({}),
  };
}

// Stacks the rows that are in the tree now. Call again after the tree changed.
export function layOutTreeRows(): void {
  const rows = document.querySelectorAll<HTMLElement>(
    '[role="tree"] .tree-item__row',
  );
  rows.forEach((row, index) => {
    const box = rowBox(index * TREE_ROW_HEIGHT);
    row.getBoundingClientRect = () => box;
  });
}

export function treeRowOf(row: TreeRow): HTMLElement {
  const item = typeof row === "string" ? treeItemNamed(row) : row;
  const element = item.querySelector<HTMLElement>(":scope > .tree-item__row");
  if (element === null) throw new Error("the tree item has no row");
  return element;
}

// A point on a row: `share` 0 is its top edge, 1 its bottom edge.
export function yOnRow(row: TreeRow, share: number): number {
  layOutTreeRows();
  const box = treeRowOf(row).getBoundingClientRect();
  return box.top + (box.bottom - box.top) * share;
}

// The empty space below the last row.
export function yBelowRows(): number {
  const rows = document.querySelectorAll('[role="tree"] .tree-item__row');
  return rows.length * TREE_ROW_HEIGHT + TREE_ROW_HEIGHT;
}

// Presses on `from`, drags past the click threshold and on to `toY`; releases there unless
// `release` is false.
export async function dragTreeRow(
  user: UserSession,
  from: TreeRow,
  toY: number,
  release = true,
): Promise<void> {
  layOutTreeRows();
  const row = treeRowOf(from);
  const startY = yOnRow(from, 0.5);
  await user.pointer([
    {
      keys: "[MouseLeft>]",
      target: row,
      coords: { clientX: POINTER_X, clientY: startY },
    },
    {
      target: row,
      coords: { clientX: POINTER_X + DRAG_START_DISTANCE, clientY: startY },
    },
    { target: row, coords: { clientX: POINTER_X, clientY: toY } },
  ]);
  if (release) {
    await user.pointer({
      keys: "[/MouseLeft]",
      target: row,
      coords: { clientX: POINTER_X, clientY: toY },
    });
  }
}
