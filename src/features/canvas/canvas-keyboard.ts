// Maps key events on the focused canvas to canvas commands. Pure; the component decides
// what to run.

export const CANVAS_KEY_COMMANDS = {
  deleteSelection: "deleteSelection",
  undo: "undo",
  redo: "redo",
  cancelGesture: "cancelGesture",
  startEditing: "startEditing",
  copy: "copy",
  cut: "cut",
  paste: "paste",
  duplicate: "duplicate",
  bringForward: "bringForward",
  sendBackward: "sendBackward",
  bringToFront: "bringToFront",
  sendToBack: "sendToBack",
} as const;

export type CanvasKeyCommand =
  (typeof CANVAS_KEY_COMMANDS)[keyof typeof CANVAS_KEY_COMMANDS];

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  // Physical key; used where `key` changes with Shift or the keyboard layout. Real
  // keyboard events always have it.
  readonly code?: string;
}

const KEYS = {
  alt: "Alt",
  escape: "Escape",
  delete: "Delete",
  backspace: "Backspace",
  enter: "Enter",
  undo: "z",
  redo: "y",
  copy: "c",
  cut: "x",
  paste: "v",
  duplicate: "d",
  space: " ",
} as const;

// Z-order shortcuts are matched on the CHARACTER the key produces, not on its physical
// position: on a Japanese (JIS) keyboard the key printed "]" is not at the US "]" position,
// so matching `event.code` would make Ctrl+] do the opposite of what is printed. Shift
// turns "]" / "[" into "}" / "{" on both US and JIS layouts, so both are accepted.
const BRACKET_KEYS = {
  forward: ["]", "}"],
  backward: ["[", "{"],
} as const;

const CODES = {
  space: "Space",
} as const;

function isOneOf(key: string, candidates: readonly string[]): boolean {
  return candidates.includes(key);
}

// Matches keys case-insensitively: Shift turns "z" into "Z".
function isLetter(event: KeyEventLike, letter: string): boolean {
  return event.key.toLowerCase() === letter;
}

export function keyCommandOf(event: KeyEventLike): CanvasKeyCommand | null {
  if (event.key === KEYS.escape) return CANVAS_KEY_COMMANDS.cancelGesture;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier) {
    if (isLetter(event, KEYS.undo)) {
      return event.shiftKey
        ? CANVAS_KEY_COMMANDS.redo
        : CANVAS_KEY_COMMANDS.undo;
    }
    if (isLetter(event, KEYS.redo) && event.ctrlKey) {
      return CANVAS_KEY_COMMANDS.redo;
    }
    if (isOneOf(event.key, BRACKET_KEYS.forward)) {
      return event.shiftKey
        ? CANVAS_KEY_COMMANDS.bringToFront
        : CANVAS_KEY_COMMANDS.bringForward;
    }
    if (isOneOf(event.key, BRACKET_KEYS.backward)) {
      return event.shiftKey
        ? CANVAS_KEY_COMMANDS.sendToBack
        : CANVAS_KEY_COMMANDS.sendBackward;
    }
    // Shift variants (for example Ctrl+Shift+V, "paste as plain text") are not ours.
    if (event.shiftKey) return null;
    if (isLetter(event, KEYS.copy)) return CANVAS_KEY_COMMANDS.copy;
    if (isLetter(event, KEYS.cut)) return CANVAS_KEY_COMMANDS.cut;
    if (isLetter(event, KEYS.paste)) return CANVAS_KEY_COMMANDS.paste;
    if (isLetter(event, KEYS.duplicate)) return CANVAS_KEY_COMMANDS.duplicate;
    return null;
  }
  if (event.key === KEYS.delete || event.key === KEYS.backspace) {
    return CANVAS_KEY_COMMANDS.deleteSelection;
  }
  if (event.key === KEYS.enter) return CANVAS_KEY_COMMANDS.startEditing;
  return null;
}

// The Space key is the pan modifier (hold Space and drag).
export function isPanModifierKey(event: {
  readonly key: string;
  readonly code?: string;
}): boolean {
  return event.code === CODES.space || event.key === KEYS.space;
}

// The Alt key suspends the grid snap while a move / resize is in progress.
export function isSnapSuspendKey(event: { readonly key: string }): boolean {
  return event.key === KEYS.alt;
}

const EDITABLE_TAG_NAMES: ReadonlySet<string> = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

// The parts of an element that decide whether it takes text input; a structural type so the
// check runs without a DOM global.
interface EditableCandidate {
  readonly tagName: string;
  readonly isContentEditable?: boolean;
  closest?(selector: string): unknown;
}

const CONTENT_EDITABLE_SELECTOR =
  '[contenteditable=""], [contenteditable="true"]';

function isElementLike(target: unknown): target is EditableCandidate {
  return (
    typeof target === "object" &&
    target !== null &&
    "tagName" in target &&
    typeof target.tagName === "string"
  );
}

// Typing in a field (a future Markdown editor inside a block) must never trigger canvas
// shortcuts. `isContentEditable` is not implemented by every DOM, hence the selector.
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElementLike(target)) return false;
  return (
    EDITABLE_TAG_NAMES.has(target.tagName) ||
    target.isContentEditable === true ||
    (target.closest?.(CONTENT_EDITABLE_SELECTOR) ?? null) !== null
  );
}
