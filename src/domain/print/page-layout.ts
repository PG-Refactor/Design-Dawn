// Where a free-form sheet is cut into printed pages. A sheet has no paper of its own: its
// blocks can sit anywhere, so the printed area is the box around them plus a margin, cut
// into a grid of pages. A cut is moved up / left to the edge of a block it would go
// through, when that edge is inside the page, so blocks are not split unless one is
// larger than a page. Empty pages are left out. Pure: world units in, rectangles out.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// The box around every block, grown by `margin` on each side; null for an empty sheet.
export function contentBounds(
  blocks: readonly Rect[],
  margin: number,
): Rect | null {
  if (blocks.length === 0) return null;
  const left = Math.min(...blocks.map((block) => block.x));
  const top = Math.min(...blocks.map((block) => block.y));
  const right = Math.max(...blocks.map((block) => block.x + block.width));
  const bottom = Math.max(...blocks.map((block) => block.y + block.height));
  return {
    x: left - margin,
    y: top - margin,
    width: right - left + margin * 2,
    height: bottom - top + margin * 2,
  };
}

// Cut positions along one axis from `start` to `end` with pages `pageSize` long. Each cut
// is pulled back to the start of a span it would cross, if that start is past the
// previous cut (so a page always moves forward).
function cuts(
  start: number,
  end: number,
  pageSize: number,
  spans: readonly (readonly [number, number])[],
): number[] {
  const positions = [start];
  let current = start;
  while (current + pageSize < end) {
    let next = current + pageSize;
    const crossed = spans.filter(([from, to]) => from < next && to > next);
    if (crossed.length > 0) {
      const earliest = Math.min(...crossed.map(([from]) => from));
      if (earliest > current) next = earliest;
    }
    positions.push(next);
    current = next;
  }
  positions.push(end);
  return positions;
}

function intersects(page: Rect, block: Rect): boolean {
  return (
    block.x < page.x + page.width &&
    block.x + block.width > page.x &&
    block.y < page.y + page.height &&
    block.y + block.height > page.y
  );
}

// Pages in reading order (rows from the top, left to right), each at most `pageWidth` by
// `pageHeight` world units.
export function paginate(
  bounds: Rect,
  blocks: readonly Rect[],
  pageWidth: number,
  pageHeight: number,
): Rect[] {
  const columns = cuts(
    bounds.x,
    bounds.x + bounds.width,
    pageWidth,
    blocks.map((block) => [block.x, block.x + block.width] as const),
  );
  const rows = cuts(
    bounds.y,
    bounds.y + bounds.height,
    pageHeight,
    blocks.map((block) => [block.y, block.y + block.height] as const),
  );
  const pages: Rect[] = [];
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < columns.length - 1; column += 1) {
      const x = columns[column] ?? 0;
      const y = rows[row] ?? 0;
      const page = {
        x,
        y,
        width: (columns[column + 1] ?? x) - x,
        height: (rows[row + 1] ?? y) - y,
      };
      if (blocks.some((block) => intersects(page, block))) pages.push(page);
    }
  }
  return pages;
}
