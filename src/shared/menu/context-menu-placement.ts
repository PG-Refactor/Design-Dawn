// Where a context menu goes: at the pointer, flipped to the other side of it when it would
// run past the right / bottom edge of the window, and kept inside the window when it is
// larger than the space on either side.

export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

export interface MenuExtent {
  readonly width: number;
  readonly height: number;
}

function placeAxis(
  anchor: number,
  size: number,
  available: number,
  margin: number,
): number {
  const max = available - margin - size;
  if (anchor <= max) return Math.max(margin, anchor);
  const flipped = anchor - size;
  if (flipped >= margin) return flipped;
  return Math.max(margin, max);
}

export function placeContextMenu(
  anchor: MenuPoint,
  menu: MenuExtent,
  windowSize: MenuExtent,
  margin: number,
): MenuPoint {
  return {
    x: placeAxis(anchor.x, menu.width, windowSize.width, margin),
    y: placeAxis(anchor.y, menu.height, windowSize.height, margin),
  };
}
