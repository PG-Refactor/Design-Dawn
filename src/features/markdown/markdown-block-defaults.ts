// What a new Markdown block starts with. The size is in world units.
export const MARKDOWN_BLOCK_DEFAULTS = {
  initialText: "# New Markdown",
  size: { width: 480, height: 320 },
} as const;

// A block made from a spreadsheet sheet starts roughly as large as its table, within limits
// that keep a big sheet from covering the canvas (it scrolls while edited, like any block).
export const SPREADSHEET_BLOCK_SIZE = {
  columnWidth: 120,
  rowHeight: 28,
  // Room for the sheet's heading and the block's padding.
  extraHeight: 80,
  minWidth: 320,
  maxWidth: 1200,
  minHeight: 160,
  maxHeight: 800,
} as const;
