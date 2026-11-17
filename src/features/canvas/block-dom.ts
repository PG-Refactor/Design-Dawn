// DOM markers that connect the canvas's event handling with what blocks render. In their
// own module so block renderers can use them without importing the frame (the frame imports
// the renderers).

// The attributes the canvas reads from the DOM to find out what a pointer event hit.
export const BLOCK_ID_ATTRIBUTE = "data-block-id";
export const RESIZE_HANDLE_ATTRIBUTE = "data-canvas-handle";
// The focusable element of a block (focus returns here when editing ends).
export const BLOCK_BODY_ATTRIBUTE = "data-block-body";
// Marks the inline editor of a block. Pointer, wheel and keyboard events that start inside
// it belong to the editor, never to the canvas gestures and shortcuts.
export const BLOCK_EDITOR_ATTRIBUTE = "data-block-editor";

const BLOCK_EDITOR_SELECTOR = `[${BLOCK_EDITOR_ATTRIBUTE}]`;

export function isInsideBlockEditor(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(BLOCK_EDITOR_SELECTOR) !== null
  );
}

// Marks the canvas element, so code outside the canvas component (the file drop handler)
// can measure the canvas that is on screen.
export const CANVAS_ATTRIBUTE = "data-canvas";

// Set while the canvas has the focus from a click (or what stands for one: a drop, a
// deleted block): its focus ring (a frame round the whole sheet) is for keyboard users. A
// key pressed meanwhile (Delete) would otherwise make the webview draw it, and the sheet
// looks selected. Cleared when the focus leaves.
export const POINTER_FOCUS_DATA = "pointerFocus";

export function focusByPointer(element: HTMLElement): void {
  element.dataset[POINTER_FOCUS_DATA] = "true";
  element.focus({ preventScroll: true });
}

// The canvas on screen takes the keyboard after files were dropped on the window (the
// focus was elsewhere, or nowhere): Ctrl+Z then undoes the drop. Not while something
// that takes typing has the focus.
export function focusActiveCanvasAfterDrop(): void {
  const canvas = document.querySelector<HTMLElement>(`[${CANVAS_ATTRIBUTE}]`);
  const active = document.activeElement;
  if (canvas === null || canvas.contains(active)) return;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    isInsideBlockEditor(active)
  ) {
    return;
  }
  focusByPointer(canvas);
}

export function measureActiveCanvas(): {
  readonly width: number;
  readonly height: number;
} {
  const rect = document
    .querySelector(`[${CANVAS_ATTRIBUTE}]`)
    ?.getBoundingClientRect();
  return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
}
