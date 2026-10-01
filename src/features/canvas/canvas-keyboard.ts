// Maps key events on the focused canvas to canvas commands. Pure; the component decides
// what to run.

export const CANVAS_KEY_COMMANDS = {
  deleteSelection: "deleteSelection",
  undo: "undo",
  redo: "redo",
  cancelGesture: "cancelGesture",
  startEditing: "startEditing",
} as const;

export type CanvasKeyCommand =
  (typeof CANVAS_KEY_COMMANDS)[keyof typeof CANVAS_KEY_COMMANDS];

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

const KEYS = {
  escape: "Escape",
  delete: "Delete",
  backspace: "Backspace",
  enter: "Enter",
  undo: "z",
  redo: "y",
} as const;

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
    return null;
  }
  if (event.key === KEYS.delete || event.key === KEYS.backspace) {
    return CANVAS_KEY_COMMANDS.deleteSelection;
  }
  if (event.key === KEYS.enter) return CANVAS_KEY_COMMANDS.startEditing;
  return null;
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
