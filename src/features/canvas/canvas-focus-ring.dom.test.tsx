// @vitest-environment jsdom
// The canvas's focus ring is for keyboard users: a click marks the focus as the pointer's,
// so a key pressed afterwards (Delete) does not make the whole sheet look selected.
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";

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
});
