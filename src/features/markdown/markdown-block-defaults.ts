// What a new Markdown block starts with. The size is in world units.
export const MARKDOWN_BLOCK_DEFAULTS = {
  initialText: "# New Markdown",
  size: { width: 480, height: 320 },
} as const;

// A block made from a spreadsheet sheet starts roughly as large as its table, within limits
// that keep a big sheet from covering the canvas (it scrolls while edited, like any block).
export const SPREADSHEET_BLOCK_SIZE = {
  columnWidth: 120,
  // A table row: its padding and borders, plus one text line per line of its tallest cell.
  rowPadding: 12,
  lineHeight: 24,
  // An estimate of one half-width character (a full-width one counts twice), to tell how
  // many lines a long cell wraps to.
  characterWidth: 8,
  // Room for the sheet's heading, the block's padding and a little to spare.
  extraHeight: 112,
  minWidth: 320,
  maxWidth: 1200,
  minHeight: 160,
  maxHeight: 800,
} as const;
