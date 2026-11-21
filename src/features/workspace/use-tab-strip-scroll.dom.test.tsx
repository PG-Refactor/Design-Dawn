// @vitest-environment jsdom
// The one-row tab strip: the wheel scrolls it sideways when the tabs do not fit, and the
// active tab is brought into view when it changes.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTabStripScroll } from "./use-tab-strip-scroll";

afterEach(() => {
  cleanup();
});

function Strip({ active }: { readonly active: number }) {
  const strip = useTabStripScroll(String(active));
  return (
    <div ref={strip} role="tablist" data-testid="strip">
      {[0, 1, 2].map((index) => (
        <button
          key={index}
          type="button"
          role="tab"
          aria-selected={index === active}
        >
          {`tab ${index}`}
        </button>
      ))}
    </div>
  );
}

// jsdom does no layout: the widths are set by hand.
function setWidths(element: HTMLElement, scroll: number, client: number) {
  Object.defineProperty(element, "scrollWidth", { value: scroll });
  Object.defineProperty(element, "clientWidth", { value: client });
}

function wheel(element: HTMLElement, deltaX: number, deltaY: number) {
  const event = new WheelEvent("wheel", { deltaX, deltaY, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

describe("useTabStripScroll", () => {
  it("turns an up / down wheel into sideways scrolling when the tabs overflow", () => {
    const view = render(<Strip active={0} />);
    const strip = view.getByTestId("strip");
    setWidths(strip, 900, 300);
    const event = wheel(strip, 0, 120);
    expect(strip.scrollLeft).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the wheel alone when the tabs fit or the wheel already goes sideways", () => {
    const view = render(<Strip active={0} />);
    const strip = view.getByTestId("strip");
    setWidths(strip, 300, 300);
    expect(wheel(strip, 0, 120).defaultPrevented).toBe(false);
    expect(strip.scrollLeft).toBe(0);
  });

  it("brings the active tab into view when it changes", () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolled.push(this.textContent ?? "");
    });
    try {
      const view = render(<Strip active={0} />);
      view.rerender(<Strip active={2} />);
      expect(scrolled).toEqual(["tab 0", "tab 2"]);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
