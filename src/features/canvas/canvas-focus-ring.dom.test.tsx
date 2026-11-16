// @vitest-environment jsdom
// The canvas's focus ring is for keyboard users: a click marks the focus as the pointer's,
// so a key pressed afterwards (Delete) does not make the whole sheet look selected.
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";

const CANVAS_STYLESHEET = Object.values(
  import.meta.glob("/src/features/canvas/canvas.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
).join("");

// jsdom draws nothing: the stylesheet itself has to take the ring off, the app-wide
// `:focus-visible` one included.
function ruleBody(selector: string): string | undefined {
  const start = CANVAS_STYLESHEET.indexOf(`${selector} {`);
  if (start < 0) return undefined;
  return CANVAS_STYLESHEET.slice(start, CANVAS_STYLESHEET.indexOf("}", start));
}

afterEach(() => {
  cleanup();
});

describe("the canvas focus ring", () => {
  it("is off after a click, and back once the focus has left", async () => {
    await renderOpenedCanvas();
    const canvas = canvasElement();
    fireEvent.pointerDown(canvas, { button: 0, clientX: 600, clientY: 400 });
    expect(document.activeElement).toBe(canvas);
    expect(canvas.dataset.pointerFocus).toBe("true");
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(canvas.dataset.pointerFocus).toBe("true");
    canvas.blur();
    expect(canvas.dataset.pointerFocus).toBeUndefined();
  });

  it("is taken off by the stylesheet while the focus is the pointer's", () => {
    expect(ruleBody(".canvas[data-pointer-focus]:focus-visible")).toMatch(
      /outline:\s*none/,
    );
  });
});
