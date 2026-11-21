// @vitest-environment jsdom
// The whole text of a label cut short with "…": shown beside the pointer after a rest,
// only when the label does not fit, and gone when the pointer leaves or anything is pressed.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { hintPosition, OverflowHintLabel } from "./overflow-hint";

const HINT = LAYOUT_CONFIG.overflowHint;
const NAME = "F1-LongFolderName-ABCDEFGHIJKLMNOPQRSTUV";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// jsdom does no layout: the label's widths are set by hand.
function renderLabel(fits: boolean) {
  const view = render(
    <OverflowHintLabel text={NAME} className="label">
      {NAME}
    </OverflowHintLabel>,
  );
  const label = view.container.querySelector(".label") as HTMLElement;
  Object.defineProperty(label, "clientWidth", { value: 100 });
  Object.defineProperty(label, "scrollWidth", { value: fits ? 100 : 300 });
  return label;
}

function rest(label: HTMLElement, x: number, y: number) {
  fireEvent.pointerMove(label, { clientX: x, clientY: y });
  act(() => {
    vi.advanceTimersByTime(HINT.delayMs);
  });
}

const hint = () => document.body.querySelector(".overflow-hint");

describe("OverflowHintLabel", () => {
  it("shows the whole name below and to the right of the pointer when it is cut short", () => {
    const label = renderLabel(false);
    fireEvent.pointerMove(label, { clientX: 40, clientY: 50 });
    // Not at once: moving across rows does not flash hints.
    expect(hint()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(HINT.delayMs);
    });
    const shown = hint() as HTMLElement;
    expect(shown.textContent).toBe(NAME);
    expect(shown.getAttribute("aria-hidden")).toBe("true");
    expect(shown.style.left).toBe(`${40 + HINT.pointerOffsetPx}px`);
    expect(shown.style.top).toBe(`${50 + HINT.pointerOffsetPx}px`);
  });

  it("shows nothing for a name that fits", () => {
    const label = renderLabel(true);
    rest(label, 40, 50);
    expect(hint()).toBeNull();
  });

  it("goes when the pointer leaves, anything is pressed or the window is resized", () => {
    const label = renderLabel(false);
    rest(label, 40, 50);
    expect(hint()).not.toBeNull();
    fireEvent.pointerLeave(label);
    expect(hint()).toBeNull();
    rest(label, 40, 50);
    fireEvent.pointerDown(window);
    expect(hint()).toBeNull();
    rest(label, 40, 50);
    fireEvent(window, new Event("resize"));
    expect(hint()).toBeNull();
  });
});

describe("hintPosition", () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 30 };

  it("is below and to the right of the pointer", () => {
    expect(hintPosition({ x: 100, y: 100 }, size, viewport)).toEqual({
      x: 100 + HINT.pointerOffsetPx,
      y: 100 + HINT.pointerOffsetPx,
    });
  });

  it("goes to the left of / above the pointer at the right and bottom edges", () => {
    expect(hintPosition({ x: 700, y: 590 }, size, viewport)).toEqual({
      x: 700 - HINT.pointerOffsetPx - size.width,
      y: 590 - HINT.pointerOffsetPx - size.height,
    });
  });

  it("stays inside the window at the left and top", () => {
    const wide = { width: 790, height: 30 };
    expect(hintPosition({ x: 50, y: 10 }, wide, viewport).x).toBe(
      HINT.edgeMarginPx,
    );
  });
});
