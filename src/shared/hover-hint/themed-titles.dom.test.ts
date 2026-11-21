// @vitest-environment jsdom
// A control's explanation (its title) shown in the theme's colours by the pointer: the
// webview's own box is kept away (the title is moved aside while the pointer is there) and
// the title comes back afterwards.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { installThemedTitles } from "./themed-titles";

const HINT = LAYOUT_CONFIG.overflowHint;
let stop: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<button type="button" title="Zoom in" aria-label="Zoom in"><span>+</span></button><p>plain</p>';
  stop = installThemedTitles();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const button = () => document.querySelector("button") as HTMLButtonElement;
const hint = () => document.querySelector(".overflow-hint");

function pointer(type: string, target: Element, extra: PointerEventInit = {}) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: 30,
      clientY: 40,
      ...extra,
    }),
  );
}

describe("installThemedTitles", () => {
  it("shows the title by the pointer after a rest, with no title left for the webview", () => {
    pointer("pointerover", button().querySelector("span") as Element);
    expect(button().hasAttribute("title")).toBe(false);
    expect(hint()).toBeNull();
    vi.advanceTimersByTime(HINT.delayMs);
    expect(hint()?.textContent).toBe("Zoom in");
    expect(hint()?.getAttribute("aria-hidden")).toBe("true");
    expect((hint() as HTMLElement).style.left).toBe(
      `${30 + HINT.pointerOffsetPx}px`,
    );
  });

  it("puts the title back when the pointer moves off it or leaves the window", () => {
    pointer("pointerover", button());
    vi.advanceTimersByTime(HINT.delayMs);
    pointer("pointerover", document.querySelector("p") as Element);
    expect(hint()).toBeNull();
    expect(button().getAttribute("title")).toBe("Zoom in");
    pointer("pointerover", button());
    pointer("pointerout", button(), { relatedTarget: null });
    expect(button().getAttribute("title")).toBe("Zoom in");
  });

  it("goes by what is under the pointer, not by the element holding the pointer", () => {
    const paragraph = document.querySelector("p") as Element;
    // jsdom does no layout and has no elementFromPoint: one is given here.
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => button(),
    });
    // The events name another element (it holds the pointer); the button is under it.
    pointer("pointermove", paragraph);
    expect(button().hasAttribute("title")).toBe(false);
    pointer("pointermove", paragraph);
    expect(button().hasAttribute("title")).toBe(false);
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  it("hides on a click but keeps the title aside until the pointer leaves", () => {
    pointer("pointerover", button());
    vi.advanceTimersByTime(HINT.delayMs);
    pointer("pointerdown", button());
    expect(hint()).toBeNull();
    expect(button().hasAttribute("title")).toBe(false);
  });
});
