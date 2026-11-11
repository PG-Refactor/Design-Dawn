// Ctrl+P (Cmd+P on macOS) opens the app's print dialog instead of the webview printing the
// app's own page. Pure; the top bar decides what to run.

import type { SaveShortcutEventLike } from "../workspace/save-shortcut";

export const PRINT_KEY = "p";

export function isPrintShortcut(event: SaveShortcutEventLike): boolean {
  return (
    event.key.toLowerCase() === PRINT_KEY &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}
