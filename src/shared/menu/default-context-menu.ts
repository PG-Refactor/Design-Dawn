// The webview's own right-click menu (Back, Reload, Print, Inspect, ...) belongs to a web
// page, not to this app, so it is turned off everywhere. Text the user is typing keeps it:
// there it offers cut / copy / paste. The app's own menus call `preventDefault` themselves
// and are not affected either way.

// `<input>` types that hold editable text (the others are buttons, boxes and pickers).
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "url",
  "email",
  "tel",
  "password",
  "number",
]);

const CONTENT_EDITABLE_SELECTOR =
  '[contenteditable=""], [contenteditable="true"]';

export function keepsDefaultContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type);
  }
  return target.closest(CONTENT_EDITABLE_SELECTOR) !== null;
}

// Installs the rule on `target` (the window); returns the function that removes it.
export function suppressDefaultContextMenu(target: Window): () => void {
  function handleContextMenu(event: MouseEvent): void {
    if (!keepsDefaultContextMenu(event.target)) event.preventDefault();
  }
  target.addEventListener("contextmenu", handleContextMenu);
  return () => target.removeEventListener("contextmenu", handleContextMenu);
}
