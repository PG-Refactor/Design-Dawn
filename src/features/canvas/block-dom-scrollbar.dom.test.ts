// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isOnScrollbar } from "./block-dom";

// A 200 x 100 element that scrolls across, drawn at `scale` (the canvas zoom), with a
// 10-pixel scrollbar under its 90-pixel-high content.
function wideTable(scale: number): HTMLElement {
  const element = document.createElement("table");
  const sizes = {
    offsetWidth: 200,
    clientWidth: 200,
    scrollWidth: 600,
    clientHeight: 90,
    scrollHeight: 90,
    clientTop: 0,
    clientLeft: 0,
  };
  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(element, name, { value });
  }
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200 * scale, height: 100 * scale }) as DOMRect;
  return element;
}

describe("a press on a scrollbar inside a block", () => {
  it("is told from a press on the content, at any zoom", () => {
    for (const scale of [1, 2]) {
      const target = wideTable(scale);
      expect(isOnScrollbar({ target, clientX: 50, clientY: 95 * scale })).toBe(
        true,
      );
      expect(isOnScrollbar({ target, clientX: 50, clientY: 40 * scale })).toBe(
        false,
      );
    }
  });

  it("is never one on an element that does not scroll", () => {
    const target = document.createElement("div");
    expect(isOnScrollbar({ target, clientX: 5, clientY: 5 })).toBe(false);
  });
});
