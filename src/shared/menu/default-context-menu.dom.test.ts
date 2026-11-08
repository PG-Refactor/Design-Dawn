// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  keepsDefaultContextMenu,
  suppressDefaultContextMenu,
} from "./default-context-menu";

function rightClick(element: Element): boolean {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("default context menu", () => {
  let remove: (() => void) | null = null;
  afterEach(() => {
    remove?.();
    remove = null;
    document.body.replaceChildren();
  });

  it("is suppressed on ordinary parts of the page", () => {
    remove = suppressDefaultContextMenu(window);
    const panel = document.createElement("div");
    const button = document.createElement("button");
    panel.append(button);
    document.body.append(panel);
    expect(rightClick(panel)).toBe(true);
    expect(rightClick(button)).toBe(true);
  });

  it("is kept where text is being typed", () => {
    remove = suppressDefaultContextMenu(window);
    const textArea = document.createElement("textarea");
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inside = document.createElement("span");
    editable.append(inside);
    document.body.append(textArea, input, editable);
    expect(rightClick(textArea)).toBe(false);
    expect(rightClick(input)).toBe(false);
    expect(rightClick(inside)).toBe(false);
  });

  it("treats inputs that hold no text as ordinary controls", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(keepsDefaultContextMenu(checkbox)).toBe(false);
  });

  it("stops suppressing once removed", () => {
    suppressDefaultContextMenu(window)();
    const panel = document.createElement("div");
    document.body.append(panel);
    expect(rightClick(panel)).toBe(false);
  });
});
