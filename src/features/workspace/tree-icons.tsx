// Small inline icons of the Project Tree. They draw with `currentColor` (so themes and the
// row colours apply) and are decorative: the rows and buttons that use one have their own
// accessible names, hence `aria-hidden`.

import type { ReactNode } from "react";

const ICON_VIEW_BOX = "0 0 16 16";

function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      className="tree-icon"
      viewBox={ICON_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const FOLDER_PATH =
  "M1.5 4V12.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1H8L6.5 2.5h-4a1 1 0 0 0-1 1z";
const DOCUMENT_PATH = "M3.5 1.5h6l3 3v10h-9z";

export function FolderIcon() {
  return (
    <Icon>
      <path d={FOLDER_PATH} />
    </Icon>
  );
}

// The open folder: its front flap tilts down, as in file managers.
export function FolderOpenIcon() {
  return (
    <Icon>
      <path d="M1.5 12.5V3.5a1 1 0 0 1 1-1h4L8 4.5h4.5a1 1 0 0 1 1 1V7" />
      <path d="M1.5 12.5L3.5 7h11l-2 6.5h-10a1 1 0 0 1-1-1z" />
    </Icon>
  );
}

export function DocumentIcon() {
  return (
    <Icon>
      <path d={DOCUMENT_PATH} />
      <path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5" />
    </Icon>
  );
}

export function ProjectIcon() {
  return (
    <Icon>
      <path d="M2 4.5l6-3 6 3v7l-6 3-6-3z" />
      <path d="M2 4.5l6 3 6-3M8 7.5v7" />
    </Icon>
  );
}

export function NewFolderIcon() {
  return (
    <Icon>
      <path d="M8 13.5H2.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h4L8 4.5h5.5a1 1 0 0 1 1 1V8" />
      <path d="M12 10v5M9.5 12.5h5" />
    </Icon>
  );
}

export function NewDocumentIcon() {
  return (
    <Icon>
      <path d="M8 14.5H3.5v-13h6l3 3V8" />
      <path d="M9.5 1.5v3h3M12 10v5M9.5 12.5h5" />
    </Icon>
  );
}
