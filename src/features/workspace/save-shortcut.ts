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
// layout. Alt (AltGr on some layouts types characters), Shift (a different shortcut
// elsewhere) and IME composition (the key belongs to the conversion) are not a save.
export function isSaveShortcut(event: SaveShortcutEventLike): boolean {
  return (
    event.key.toLowerCase() === SAVE_KEY &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

const MAC_PLATFORM_PATTERN = /mac|iphone|ipad/i;
const SAVE_HINT_MAC = "⌘S";
const SAVE_HINT_OTHER = "Ctrl+S";

// The text shown next to "Save" in the File menu; follows the key `isSaveShortcut` accepts
// on the platform in use.
export function saveShortcutHint(platform: string): string {
  return MAC_PLATFORM_PATTERN.test(platform) ? SAVE_HINT_MAC : SAVE_HINT_OTHER;
}
