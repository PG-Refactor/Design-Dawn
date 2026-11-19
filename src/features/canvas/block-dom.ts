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

// The world layer of the canvas (its origin is the world's (0, 0) on screen) and the zoom
// it is drawn at, so a point on screen can be told in world units outside the canvas
// component (where files were dropped).
export const WORLD_LAYER_ATTRIBUTE = "data-canvas-world";
export const WORLD_ZOOM_ATTRIBUTE = "data-canvas-zoom";

// The world point under a point of the page, when it is on the canvas on screen.
export function worldPointAtClient(
  clientX: number,
  clientY: number,
): { readonly x: number; readonly y: number } | null {
  const canvas = document.querySelector<HTMLElement>(`[${CANVAS_ATTRIBUTE}]`);
  const world = canvas?.querySelector<HTMLElement>(
    `[${WORLD_LAYER_ATTRIBUTE}]`,
  );
  if (canvas == null || world == null) return null;
  const area = canvas.getBoundingClientRect();
  const inside =
    clientX >= area.left &&
    clientX <= area.right &&
    clientY >= area.top &&
    clientY <= area.bottom;
  const zoom = Number(world.getAttribute(WORLD_ZOOM_ATTRIBUTE));
  if (!inside || !(zoom > 0)) return null;
  const origin = world.getBoundingClientRect();
  return {
    x: (clientX - origin.left) / zoom,
    y: (clientY - origin.top) / zoom,
  };
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

// Whether a press is on the scrollbar of the element it hit (an element that scrolls, such
// as a wide table): the scrollbar is outside the element's client area. Measured on screen,
// so the canvas zoom is accounted for.
export function isOnScrollbar(event: {
  readonly target: EventTarget | null;
  readonly clientX: number;
  readonly clientY: number;
}): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.offsetWidth === 0)
    return false;
  const box = target.getBoundingClientRect();
  const scale = box.width / target.offsetWidth;
  const scrollsAcross = target.scrollWidth > target.clientWidth;
  const scrollsDown = target.scrollHeight > target.clientHeight;
  const belowContent =
    event.clientY > box.top + (target.clientTop + target.clientHeight) * scale;
  const rightOfContent =
    event.clientX > box.left + (target.clientLeft + target.clientWidth) * scale;
  return (scrollsAcross && belowContent) || (scrollsDown && rightOfContent);
}
