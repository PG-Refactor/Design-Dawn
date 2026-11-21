// The short explanations of buttons and other controls (their `title`), shown in the
// theme's colours below and to the right of the pointer, like the full names of the tree,
// instead of the webview's own white box. While the pointer is on an element with a title,
// the title is moved aside (so the webview shows nothing) and put back when the pointer
// leaves; the element keeps its name (`aria-label`) for assistive technology.

import { LAYOUT_CONFIG } from "../../config/layout-config";
import { hintPosition } from "./overflow-hint";
import "./overflow-hint.css";

const HINT = LAYOUT_CONFIG.overflowHint;
const TITLED_SELECTOR = "[title]";
const HINT_CLASS = "overflow-hint";

interface Hovered {
  readonly element: Element;
  readonly title: string;
}

// Returns the function that stops it.
export function installThemedTitles(root: Document = document): () => void {
  const view = root.defaultView;
  if (view === null) return () => undefined;
  let hovered: Hovered | null = null;
  let hint: HTMLDivElement | null = null;
  let timer: number | null = null;
  let pointer = { x: 0, y: 0 };

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

  // Puts the title back (unless the page gave the element a new one meanwhile).
  function release(): void {
    hideHint();
    if (hovered !== null && !hovered.element.hasAttribute("title")) {
      hovered.element.setAttribute("title", hovered.title);
    }
    hovered = null;
  }

  function onOver(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const titled = target?.closest(TITLED_SELECTOR) ?? null;
    if (titled === hovered?.element) return;
    release();
    const title = titled?.getAttribute("title") ?? "";
    if (titled === null || title.trim() === "") return;
    titled.removeAttribute("title");
    hovered = { element: titled, title };
    pointer = { x: event.clientX, y: event.clientY };
    timer =
      view?.setTimeout(() => {
        timer = null;
        if (hovered !== null) showHint(hovered.title);
      }, HINT.delayMs) ?? null;
  }

  function onMove(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY };
    place();
  }

  function onOut(event: PointerEvent): void {
    if (hovered === null) return;
    const next = event.relatedTarget;
    if (next instanceof Node && hovered.element.contains(next)) return;
    release();
  }

  // A click, a key or scrolling: the explanation has done its job (the title comes back
  // when the pointer leaves).
  const dismiss = () => hideHint();

  root.addEventListener("pointerover", onOver, true);
  root.addEventListener("pointermove", onMove, true);
  root.addEventListener("pointerout", onOut, true);
  root.addEventListener("pointerdown", dismiss, true);
  root.addEventListener("keydown", dismiss, true);
  root.addEventListener("scroll", dismiss, true);
  view.addEventListener("blur", release);
  return () => {
    release();
    root.removeEventListener("pointerover", onOver, true);
    root.removeEventListener("pointermove", onMove, true);
    root.removeEventListener("pointerout", onOut, true);
    root.removeEventListener("pointerdown", dismiss, true);
    root.removeEventListener("keydown", dismiss, true);
    root.removeEventListener("scroll", dismiss, true);
    view.removeEventListener("blur", release);
  };
}
