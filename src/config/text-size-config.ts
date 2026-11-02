// Text size of the application's own UI (menus, tree, tabs, panels, dialogs). It does not
// change the Document content on the canvas: blocks have a fixed size in the Document, so
// their text must not grow with a viewer's setting (the canvas zoom is for that).
// Mirrors `TEXT_SIZE_IDS` in Rust (`application/local_state/constants.rs`); adding a size
// means adding it in both.

export const TEXT_SIZES = ["small", "medium", "large", "xlarge"] as const;

export type TextSize = (typeof TEXT_SIZES)[number];

// The browser default (16px). It looked small on a 4K screen under WSLg, which applies no
// display scaling, but right on Windows, where the OS scaling applies; "large" and above
// are for the former.
export const DEFAULT_TEXT_SIZE: TextSize = "medium";

// The root font size each setting applies; every UI size is in rem, so this scales the UI.
export const TEXT_SIZE_ROOT_PX: Readonly<Record<TextSize, number>> = {
  small: 14,
  medium: 16,
  large: 18,
  xlarge: 20,
};
