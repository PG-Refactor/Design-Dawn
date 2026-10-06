// One-step moves of an entry inside an order (documents in the project, sheets in a
// document). Pure. Positions are computed against the FULL order, including entries that
// failed to load, so the stored order stays consistent: a neighbour that cannot be
// edited is still a position that is passed.

export const MOVE_DIRECTIONS = {
  up: "up",
  down: "down",
} as const;

export type MoveDirection =
  (typeof MOVE_DIRECTIONS)[keyof typeof MOVE_DIRECTIONS];

export interface OneStepMove<Id> {
  // The entry to put the moved one directly in front of; null = at the end. This is the
  // argument shape of `moveDocument` / `moveSheetCommand`.
  readonly before: Id | null;
}

// null when the entry is unknown or already at the boundary in that direction.
export function oneStepMove<Id>(
  order: readonly Id[],
  id: Id,
  direction: MoveDirection,
): OneStepMove<Id> | null {
  const index = order.indexOf(id);
  if (index < 0) return null;
  if (direction === MOVE_DIRECTIONS.up) {
    const previous = order[index - 1];
    return previous === undefined ? null : { before: previous };
  }
  if (index >= order.length - 1) return null;
  // Moving down one place = in front of the entry two places down (or last).
  return { before: order[index + 2] ?? null };
}

export function canMoveOneStep<Id>(
  order: readonly Id[],
  id: Id,
  direction: MoveDirection,
): boolean {
  return oneStepMove(order, id, direction) !== null;
}
