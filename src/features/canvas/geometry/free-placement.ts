// The free place nearest a starting point for a new block: the first spot, in growing
// rings around the start, whose rectangle overlaps no block already there. Pure.

export interface PlacementRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function overlaps(first: PlacementRect, second: PlacementRect): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

// Offsets of ring `ring` (its square's border), nearest to the start first.
function ringOffsets(
  ring: number,
): { readonly dx: number; readonly dy: number }[] {
  if (ring === 0) return [{ dx: 0, dy: 0 }];
  const offsets: { dx: number; dy: number }[] = [];
  for (let dx = -ring; dx <= ring; dx += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === ring)
        offsets.push({ dx, dy });
    }
  }
  return offsets.sort(
    (first, second) =>
      first.dx * first.dx +
      first.dy * first.dy -
      (second.dx * second.dx + second.dy * second.dy),
  );
}

function inside(candidate: PlacementRect, area: PlacementRect): boolean {
  return (
    candidate.x >= area.x &&
    candidate.y >= area.y &&
    candidate.x + candidate.width <= area.x + area.width &&
    candidate.y + candidate.height <= area.y + area.height
  );
}

function search(
  start: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  taken: readonly PlacementRect[],
  rings: { readonly step: number; readonly rings: number },
  accept: (candidate: PlacementRect) => boolean,
): { readonly x: number; readonly y: number } | null {
  for (let ring = 0; ring <= rings.rings; ring += 1) {
    for (const { dx, dy } of ringOffsets(ring)) {
      const candidate = {
        x: start.x + dx * rings.step,
        y: start.y + dy * rings.step,
        ...size,
      };
      if (candidate.x < 0 || candidate.y < 0 || !accept(candidate)) continue;
      if (!taken.some((rect) => overlaps(candidate, rect))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }
  return null;
}

// `null` when every place searched is taken (or would start left of / above the sheet's
// origin), and the caller falls back to its own rule. With `within` (the part of the sheet
// on screen), a free place wholly inside it is preferred, so the new block is seen; only
// when there is none (or the block is larger) can it be partly outside.
export function freePlacement(
  start: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  taken: readonly PlacementRect[],
  rings: { readonly step: number; readonly rings: number },
  within?: PlacementRect,
): { readonly x: number; readonly y: number } | null {
  if (within !== undefined) {
    const seen = search(start, size, taken, rings, (candidate) =>
      inside(candidate, within),
    );
    if (seen !== null) return seen;
  }
  return search(start, size, taken, rings, () => true);
}
