// Printed and exported sheets (CSS pixels, one per world unit at 100%).
export const PRINT_CONFIG = {
  // Space around the blocks of a sheet.
  sheetMargin: 24,
  // The sheet's name above its content: one line on screen, in "fit" pages and at the top
  // of every paper page.
  sheetTitleHeight: 48,
  paperHeadingHeight: 32,
  // A diagram or image larger than the paper is split across pages; a page that would show
  // only a strip of it this thin (a share of the page: mostly the empty edge of its frame)
  // is left out, so no sheet of paper is spent on it.
  figureSliverFraction: 0.25,
} as const;
