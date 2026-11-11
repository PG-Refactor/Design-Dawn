// Ctrl+F (find in the shown sheet) and Ctrl+Shift+F (search the Project), Cmd on macOS, as
// in VS Code. Pure; the hook decides what to run.

import type { SaveShortcutEventLike } from "../workspace/save-shortcut";
import type { FindTarget } from "./find-store";

export const FIND_KEY = "f";

// `event.key` is matched so the shortcut follows the printed letter on any layout; Alt
// (AltGr types characters on some layouts) and IME composition are not a shortcut.
export function findShortcutTarget(
  event: SaveShortcutEventLike,
): FindTarget | null {
  if (
    event.key.toLowerCase() !== FIND_KEY ||
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.isComposing
  ) {
    return null;
  }
  return event.shiftKey ? "project" : "sheet";
}
