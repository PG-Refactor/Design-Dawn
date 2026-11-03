// Text size of the application's own UI (menus, tree, tabs, panels, dialogs). It does not
// change the Document content on the canvas: blocks have a fixed size in the Document, so
// their text must not grow with a viewer's setting (the canvas zoom is for that).
// Mirrors `TEXT_SIZE_IDS` in Rust (`application/local_state/constants.rs`); adding a size
// means adding it in both.

export const TEXT_SIZES = ["small", "medium", "large", "xlarge"] as const;

export type TextSize = (typeof TEXT_SIZES)[number];

// "medium" is the size of desktop tools such as VS Code (13px UI text), which suits a
// Windows screen with its display scaling (user decision, 2026-11-03). Under WSLg on a 4K
// screen, which applies no scaling, "large" and above make it readable.
export const DEFAULT_TEXT_SIZE: TextSize = "medium";

// The root font size each setting applies; every UI size is in rem, so this scales the UI.
export const TEXT_SIZE_ROOT_PX: Readonly<Record<TextSize, number>> = {
  small: 12,
  medium: 13,
  large: 15,
  xlarge: 17,
};
