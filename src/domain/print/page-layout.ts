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

// A block to paginate. A figure (a diagram or an image) larger than a page is split like
// any block, but a page that would show only a thin leftover strip of it, with nothing of
// the picture in it (the empty edge of its frame), is left out. `drawn` is where the
// picture is drawn inside the block; without it nothing is left out.
export interface PageBlock extends Rect {
  readonly figure?: boolean;
  readonly drawn?: Rect;
}

// Where a picture of `natural` size is drawn in `block`: as large as it is, or shrunk to
// fit (never enlarged), centred, as an export page draws it.
export function drawnPictureRect(
  block: Rect,
  natural: { readonly width: number; readonly height: number },
): Rect {
  if (natural.width <= 0 || natural.height <= 0) return block;
  const scale = Math.min(
    1,
    block.width / natural.width,
    block.height / natural.height,
  );
  const width = natural.width * scale;
  const height = natural.height * scale;
  return {
    x: block.x + (block.width - width) / 2,
    y: block.y + (block.height - height) / 2,
    width,
    height,
  };
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
// is pulled back to the start of the spans it would cross, as long as that start is past
// the previous cut (so a page always moves forward).
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
    // Pulled back again while the new cut goes through another span (one that starts
    // above the span the cut was moved to).
    for (;;) {
      const at = next;
      const crossed = spans.filter(([from, to]) => from < at && to > at);
      if (crossed.length === 0) break;
      const earliest = Math.min(...crossed.map(([from]) => from));
      if (earliest <= current) break;
      next = earliest;
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

// The part of a figure larger than the page that continues onto `page` from an earlier
// page, when it is no more than `sliverFraction` of the page along that axis.
function isFigureSliver(
  page: Rect,
  block: PageBlock,
  sliverFraction: number,
): boolean {
  if (block.figure !== true || block.drawn === undefined) return false;
  // Any of the picture on the page: it is printed.
  if (intersects(page, block.drawn)) return false;
  const continuesAcross =
    block.x < page.x &&
    block.width > page.width &&
    Math.min(block.x + block.width, page.x + page.width) - page.x <=
      page.width * sliverFraction;
  const continuesDown =
    block.y < page.y &&
    block.height > page.height &&
    Math.min(block.y + block.height, page.y + page.height) - page.y <=
      page.height * sliverFraction;
  return continuesAcross || continuesDown;
}

// Pages in reading order (rows from the top, left to right), each at most `pageWidth` by
// `pageHeight` world units. A page with nothing but figure slivers (`isFigureSliver`) is
// left out.
export function paginate(
  bounds: Rect,
  blocks: readonly PageBlock[],
  pageWidth: number,
  pageHeight: number,
  sliverFraction = 0,
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
      const shown = blocks.some(
        (block) =>
          intersects(page, block) &&
          !isFigureSliver(
            { ...page, width: pageWidth, height: pageHeight },
            block,
            sliverFraction,
          ),
      );
      if (shown) pages.push(page);
    }
  }
  return pages;
}
