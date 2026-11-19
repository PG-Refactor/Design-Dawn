// A sheet printed on paper: the paper sizes, how far the sheet is scaled down to fit, and
// which part of the sheet each page shows. The same pages are drawn on the canvas as page
// breaks and cut out by the print page, so both agree. Pure: world units in, rectangles
// out; one CSS pixel per world unit at 100%.

import {
  contentBounds,
  type PageBlock,
  paginate,
  type Rect,
} from "./page-layout";

export const PAPER_SIZES = {
  // At the CSS reference of 96 pixels per inch.
  a4: { width: 794, height: 1123, name: "A4" },
  a3: { width: 1123, height: 1587, name: "A3" },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;
export const PAPER_SIZE_IDS = Object.keys(PAPER_SIZES) as PaperSize[];

export const ORIENTATIONS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

// 100%, the width on one page, or all of it on one page (never enlarged).
export const PAPER_SCALES = ["actual", "fitWidth", "fitPage"] as const;
export type PaperScale = (typeof PAPER_SCALES)[number];

export interface PaperSettings {
  readonly size: PaperSize;
  readonly orientation: Orientation;
  readonly scale: PaperScale;
}

export const DEFAULT_PAPER_SETTINGS: PaperSettings = {
  size: "a4",
  orientation: "portrait",
  scale: "fitWidth",
};

export interface Extent {
  readonly width: number;
  readonly height: number;
}

export function paperDimensions(settings: PaperSettings): Extent {
  const paper = PAPER_SIZES[settings.size];
  return settings.orientation === "portrait"
    ? { width: paper.width, height: paper.height }
    : { width: paper.height, height: paper.width };
}

function scaleFor(scale: PaperScale, bounds: Rect, area: Extent): number {
  switch (scale) {
    case "actual":
      return 1;
    case "fitWidth":
      return Math.min(1, area.width / bounds.width);
    case "fitPage":
      return Math.min(
        1,
        area.width / bounds.width,
        area.height / bounds.height,
      );
  }
}

export interface PaperLayout {
  // The printed part of the sheet (the blocks and a margin around them).
  readonly bounds: Rect;
  // Printed size / world size.
  readonly scale: number;
  // The paper, and the part of it under the heading where the sheet is shown.
  readonly paper: Extent;
  readonly area: Extent;
  // What each page shows, in world units and reading order.
  readonly pages: readonly Rect[];
}

// Null for a sheet without blocks. `margin` is world units around the blocks; `heading`
// is the height at the top of each page taken by the sheet's name; `sliverFraction` how
// thin a leftover strip of a figure larger than a page may be to get no page of its own.
export function paperLayout(
  blocks: readonly PageBlock[],
  settings: PaperSettings,
  margin: number,
  heading: number,
  sliverFraction = 0,
): PaperLayout | null {
  const bounds = contentBounds(blocks, margin);
  if (bounds === null) return null;
  const paper = paperDimensions(settings);
  const area = { width: paper.width, height: paper.height - heading };
  const scale = scaleFor(settings.scale, bounds, area);
  const pages = paginate(
    bounds,
    blocks,
    area.width / scale,
    area.height / scale,
    sliverFraction,
  );
  return { bounds, scale, paper, area, pages };
}
