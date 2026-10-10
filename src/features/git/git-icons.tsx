// Small inline icons of the Git panel. They draw with `currentColor` (so themes and the
// button colours apply) and are decorative: every button that uses one has its own text
// or accessible name, hence `aria-hidden`.

import type { ReactNode } from "react";

const ICON_VIEW_BOX = "0 0 16 16";

function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      className="git-icon"
      viewBox={ICON_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function BranchIcon() {
  return (
    <Icon>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 3-7 1.5-7 4" />
    </Icon>
  );
}

export function RefreshIcon() {
  return (
    <Icon>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13 2.5v3h-3" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </Icon>
  );
}

// Points down; the stylesheet turns it for a collapsed section.
export function ChevronIcon() {
  return (
    <Icon>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

export function MinusIcon() {
  return (
    <Icon>
      <path d="M3 8h10" />
    </Icon>
  );
}
