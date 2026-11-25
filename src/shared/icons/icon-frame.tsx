// The frame of the small line icons (tree, Git, notifications): an SVG drawn with the text
// colour (`currentColor`, so themes and row or button colours apply) and round strokes.
// Decorative: whatever uses one has its own accessible name, hence `aria-hidden`.

import type { ReactNode } from "react";

// The icons are drawn in a 16 x 16 box unless they say otherwise.
const DEFAULT_VIEW_BOX = "0 0 16 16";

export function IconFrame({
  className,
  strokeWidth,
  viewBox = DEFAULT_VIEW_BOX,
  children,
}: {
  readonly className: string;
  readonly strokeWidth: number;
  readonly viewBox?: string;
  readonly children: ReactNode;
}) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
