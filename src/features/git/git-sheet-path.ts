// Which changed files are inside a Sheet (`<document>/sheets/<sheet>/...`): their diff can
// also be shown as the Sheet looks, and "Open Sheet" goes there. Mirrors `sheet_location`
// in Rust.

const SHEETS_DIRECTORY = "sheets";
const SEPARATOR = "/";

export interface SheetPath {
  // Project root relative.
  readonly documentDirectory: string;
  readonly sheetDirectory: string;
  // The file relative to its Document (as a Block's `contentPath` names it).
  readonly documentRelative: string;
}

export function sheetPathOf(path: string): SheetPath | null {
  const parts = path.split(SEPARATOR);
  const index = parts.lastIndexOf(SHEETS_DIRECTORY);
  if (index <= 0 || index + 2 >= parts.length) return null;
  return {
    documentDirectory: parts.slice(0, index).join(SEPARATOR),
    sheetDirectory: parts.slice(0, index + 2).join(SEPARATOR),
    documentRelative: parts.slice(index).join(SEPARATOR),
  };
}
