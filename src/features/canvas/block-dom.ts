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

export function measureActiveCanvas(): {
  readonly width: number;
  readonly height: number;
} {
  const rect = document
    .querySelector(`[${CANVAS_ATTRIBUTE}]`)
    ?.getBoundingClientRect();
  return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
}
