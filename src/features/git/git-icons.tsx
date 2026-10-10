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

// Two stacked rows: the inline (one column) layout of the diff.
export function InlineViewIcon() {
  return (
    <Icon>
      <rect x="2.5" y="2.5" width="11" height="4" rx="0.5" />
      <rect x="2.5" y="9.5" width="11" height="4" rx="0.5" />
    </Icon>
  );
}

// A curved arrow turning back: undo the change of the file.
export function DiscardIcon() {
  return (
    <Icon>
      <path d="M6 3L3 6l3 3" />
      <path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H7" />
    </Icon>
  );
}

// The "more actions" button: three dots.
export function EllipsisIcon() {
  return (
    <Icon>
      <circle cx="3.5" cy="8" r="0.75" fill="currentColor" />
      <circle cx="8" cy="8" r="0.75" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.75" fill="currentColor" />
    </Icon>
  );
}

// Two arrows turning round: synchronize (pull then push).
export function SyncIcon() {
  return (
    <Icon>
      <path d="M3 7a5 5 0 0 1 9-2" />
      <path d="M12.5 2v3h-3" />
      <path d="M13 9a5 5 0 0 1-9 2" />
      <path d="M3.5 14v-3h3" />
    </Icon>
  );
}

// An arrow rising out of a cloud: publish the branch.
export function CloudUploadIcon() {
  return (
    <Icon>
      <path d="M4.5 12a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.8 5.5 3 3 0 0 1 11.5 12" />
      <path d="M8 13V8M6 9.5L8 7.5l2 2" />
    </Icon>
  );
}
