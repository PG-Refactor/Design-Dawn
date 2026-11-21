// The small marks of buttons (close, plus, minus, arrows, disclosure) drawn as shapes rather
// than as text: a glyph sits on the font's baseline and so lower or higher than the
// middle of its button depending on the font; a shape is always centred. One `em` square,
// so it follows the button's text size; the colour is the text's.

import type { ReactNode } from "react";
import "./glyph-icon.css";

export const GLYPHS = [
  "close",
  "plus",
  "minus",
  "arrowUp",
  "arrowDown",
  "chevronRight",
  "chevronDown",
  "doubleChevronLeft",
  "doubleChevronRight",
] as const;

export type Glyph = (typeof GLYPHS)[number];

// Paths in a 16 x 16 box, drawn with a round 1.5 stroke.
const PATHS: Readonly<Record<Glyph, string>> = {
  close: "M4 4 L12 12 M12 4 L4 12",
  plus: "M8 3 L8 13 M3 8 L13 8",
  minus: "M3 8 L13 8",
  arrowUp: "M8 13 L8 3 M4 7 L8 3 L12 7",
  arrowDown: "M8 3 L8 13 M4 9 L8 13 L12 9",
  chevronRight: "M6 3 L11 8 L6 13",
  chevronDown: "M3 6 L8 11 L13 6",
  doubleChevronLeft: "M8 3 L3 8 L8 13 M13 3 L8 8 L13 13",
  doubleChevronRight: "M3 3 L8 8 L3 13 M8 3 L13 8 L8 13",
};

const VIEW_BOX = "0 0 16 16";

// Decorative: the button carries the name (aria-label), so the shape is hidden.
export function GlyphIcon({ glyph }: { readonly glyph: Glyph }): ReactNode {
  return (
    <svg
      className="glyph-icon"
      viewBox={VIEW_BOX}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[glyph]} />
    </svg>
  );
}
