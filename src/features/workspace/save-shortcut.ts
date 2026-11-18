// Ctrl+S (Windows / Linux) and Cmd+S (macOS). Pure; the hook decides what to run.

// The part of a keyboard event the matcher reads, so it is testable without a DOM.
export interface SaveShortcutEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

const SAVE_KEY = "s";

// `event.key` is matched (not `code`) so the shortcut follows the printed letter on any
// layout. Alt (AltGr on some layouts types characters) and IME composition (the key
// belongs to the conversion) are not a save; Shift makes it "save all".
function isSaveKey(event: SaveShortcutEventLike, shift: boolean): boolean {
  return (
    event.key.toLowerCase() === SAVE_KEY &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.shiftKey === shift &&
    !event.isComposing
  );
}

// Ctrl/Cmd+S: save the Document shown.
export function isSaveShortcut(event: SaveShortcutEventLike): boolean {
  return isSaveKey(event, false);
}

// Ctrl/Cmd+Shift+S: save everything.
export function isSaveAllShortcut(event: SaveShortcutEventLike): boolean {
  return isSaveKey(event, true);
}

const MAC_PLATFORM_PATTERN = /mac|iphone|ipad/i;

// The text shown next to a menu item for Ctrl / Cmd (+ Shift) + a letter, as the platform
// in use writes it.
export function modifierShortcutHint(
  platform: string,
  letter: string,
  shift = false,
): string {
  const key = letter.toUpperCase();
  return MAC_PLATFORM_PATTERN.test(platform)
    ? `${shift ? "⇧" : ""}⌘${key}`
    : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

// The text shown next to "Save" in the File menu; follows the key `isSaveShortcut` accepts
// on the platform in use.
export function saveShortcutHint(platform: string): string {
  return modifierShortcutHint(platform, SAVE_KEY);
}

// The text shown next to "Save All".
export function saveAllShortcutHint(platform: string): string {
  return modifierShortcutHint(platform, SAVE_KEY, true);
}
