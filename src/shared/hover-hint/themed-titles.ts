// The short explanations of buttons and other controls (their `title`), shown in the
// theme's colours below and to the right of the pointer (or below a control reached with
// the keyboard), like the full names of the tree, instead of the webview's own white box.
// While an element is pointed at or focused, its title and those of the elements around it
// are moved aside (the webview shows the nearest title it finds, so an outer one would
// show instead) and put back afterwards; elements keep their names (`aria-label`) for
// assistive technology.

import { LAYOUT_CONFIG } from "../../config/layout-config";
import { hintPosition } from "./overflow-hint";
import "./overflow-hint.css";

const HINT = LAYOUT_CONFIG.overflowHint;
const TITLED_SELECTOR = "[title]";
const TITLE = "title";
// Where a title waits while it is aside (readable, and shown by nothing).
export const ASIDE_TITLE_ATTRIBUTE = "data-hint-title";
const HINT_CLASS = "overflow-hint";

interface Hovered {
  // The element whose title is shown.
  readonly element: Element;
  readonly title: string;
  // Every element whose title is aside, that one included.
  readonly aside: readonly {
    readonly element: Element;
    readonly title: string;
  }[];
}

// Returns the function that stops it.
export function installThemedTitles(root: Document = document): () => void {
  const view = root.defaultView;
  if (view === null) return () => undefined;
  let hovered: Hovered | null = null;
  let hint: HTMLDivElement | null = null;
  let timer: number | null = null;
  let pointer = { x: 0, y: 0 };
  // What the pointer is over (null once it has left the window).
  let underPointer: Element | null = null;

  function cancelTimer(): void {
    if (timer !== null) {
      view?.clearTimeout(timer);
      timer = null;
    }
  }

  function hideHint(): void {
    cancelTimer();
    hint?.remove();
    hint = null;
  }

  function place(): void {
    if (hint === null || view === null) return;
    const at = hintPosition(
      pointer,
      { width: hint.offsetWidth, height: hint.offsetHeight },
      { width: view.innerWidth, height: view.innerHeight },
    );
    hint.style.left = `${at.x}px`;
    hint.style.top = `${at.y}px`;
  }

  function showHint(text: string): void {
    hideHint();
    const element = root.createElement("div");
    element.className = HINT_CLASS;
    element.setAttribute("aria-hidden", "true");
    element.textContent = text;
    root.body.append(element);
    hint = element;
    place();
  }

  // Puts the titles back (unless the page gave an element a new one meanwhile).
  function release(): void {
    hideHint();
    for (const { element, title } of hovered?.aside ?? []) {
      element.removeAttribute(ASIDE_TITLE_ATTRIBUTE);
      if (!element.hasAttribute(TITLE)) element.setAttribute(TITLE, title);
    }
    hovered = null;
  }

  // Takes `titled` (and every titled element around it) for the explanation.
  function take(titled: Element | null): void {
    release();
    const title = titled?.getAttribute(TITLE) ?? "";
    if (titled === null || title.trim() === "") return;
    const aside: { element: Element; title: string }[] = [];
    for (
      let current: Element | null = titled;
      current !== null;
      current = current.parentElement?.closest(TITLED_SELECTOR) ?? null
    ) {
      const text = current.getAttribute(TITLE) ?? "";
      aside.push({ element: current, title: text });
      current.setAttribute(ASIDE_TITLE_ATTRIBUTE, text);
      current.removeAttribute(TITLE);
    }
    hovered = { element: titled, title, aside };
    timer =
      view?.setTimeout(() => {
        timer = null;
        if (hovered !== null) showHint(hovered.title);
      }, HINT.delayMs) ?? null;
  }

  // What is under the pointer, read from its position: while an element holds the pointer
  // (the canvas does, between a press and its release), the events name that element, not
  // the button the pointer is over, and the title would come back under the pointer.
  function elementUnder(event: PointerEvent): Element | null {
    const found =
      typeof root.elementFromPoint === "function"
        ? root.elementFromPoint(event.clientX, event.clientY)
        : null;
    if (found !== null) return found;
    return event.target instanceof Element ? event.target : null;
  }

  function follow(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY };
    const under = elementUnder(event);
    underPointer = under;
    // Still on the element whose title is aside (it has none now, so it is not found by it).
    if (hovered !== null && under !== null && hovered.element.contains(under))
      return;
    take(under?.closest(TITLED_SELECTOR) ?? null);
  }

  function onMove(event: PointerEvent): void {
    follow(event);
    place();
  }

  // Leaving the window (nothing next): the titles go back.
  function onOut(event: PointerEvent): void {
    if (hovered === null || event.relatedTarget !== null) return;
    underPointer = null;
    release();
  }

  // Reached with the keyboard: the explanation goes below the control.
  function onFocusIn(event: FocusEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const titled = target?.closest(TITLED_SELECTOR) ?? null;
    if (titled === null) return;
    const box = titled.getBoundingClientRect();
    pointer = { x: box.left, y: box.bottom };
    take(titled);
  }

  function onFocusOut(event: FocusEvent): void {
    if (hovered === null) return;
    const next = event.relatedTarget;
    if (next instanceof Node && hovered.element.contains(next)) return;
    // Still pointed at (a clicked button that became disabled loses the focus): the title
    // stays aside, or the webview would show it under the pointer.
    if (underPointer !== null && hovered.element.contains(underPointer)) return;
    release();
  }

  // A click, a key or scrolling: the explanation has done its job (the titles come back
  // when the pointer or the focus leaves).
  const dismiss = () => hideHint();

  root.addEventListener("pointerover", follow, true);
  root.addEventListener("pointermove", onMove, true);
  root.addEventListener("pointerout", onOut, true);
  root.addEventListener("pointerdown", dismiss, true);
  root.addEventListener("keydown", dismiss, true);
  root.addEventListener("scroll", dismiss, true);
  root.addEventListener("focusin", onFocusIn, true);
  root.addEventListener("focusout", onFocusOut, true);
  view.addEventListener("blur", release);
  return () => {
    release();
    root.removeEventListener("pointerover", follow, true);
    root.removeEventListener("pointermove", onMove, true);
    root.removeEventListener("pointerout", onOut, true);
    root.removeEventListener("pointerdown", dismiss, true);
    root.removeEventListener("keydown", dismiss, true);
    root.removeEventListener("scroll", dismiss, true);
    root.removeEventListener("focusin", onFocusIn, true);
    root.removeEventListener("focusout", onFocusOut, true);
    view.removeEventListener("blur", release);
  };
}
