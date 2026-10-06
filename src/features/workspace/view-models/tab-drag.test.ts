import { describe, expect, it } from "vitest";
import {
  DRAG_START_THRESHOLD_PX,
  dropSlotAt,
  dropTargetOf,
  exceedsDragThreshold,
  type TabRect,
} from "./tab-drag";

const ROW_HEIGHT = 20;
function row(lefts: readonly number[], top = 0): TabRect[] {
  return lefts.map((left) => ({
    left,
    right: left + 100,
    top,
    bottom: top + ROW_HEIGHT,
  }));
}

describe("exceedsDragThreshold", () => {
  const start = { x: 10, y: 10 };
  it("is false below the threshold and true at it", () => {
    expect(
      exceedsDragThreshold(start, {
        x: 10 + DRAG_START_THRESHOLD_PX - 1,
        y: 10,
      }),
    ).toBe(false);
    expect(
      exceedsDragThreshold(start, { x: 10, y: 10 + DRAG_START_THRESHOLD_PX }),
    ).toBe(true);
  });
});

describe("dropSlotAt", () => {
  const rects = row([0, 100, 200]);
  it("counts the tabs whose middle the pointer passed", () => {
    expect(dropSlotAt(rects, { x: 10, y: 5 })).toBe(0);
    expect(dropSlotAt(rects, { x: 60, y: 5 })).toBe(1);
    expect(dropSlotAt(rects, { x: 160, y: 5 })).toBe(2);
    expect(dropSlotAt(rects, { x: 290, y: 5 })).toBe(3);
  });

  it("handles wrapped rows: a lower row is after every tab of an upper row", () => {
    const wrapped = [...row([0, 100]), ...row([0], ROW_HEIGHT)];
    expect(dropSlotAt(wrapped, { x: 5, y: ROW_HEIGHT + 5 })).toBe(2);
    expect(dropSlotAt(wrapped, { x: 5, y: 5 })).toBe(0);
  });
});

describe("dropTargetOf", () => {
  const ids = ["a", "b", "c"];
  it("is null for the slots next to the dragged tab", () => {
    expect(dropTargetOf(ids, "b", 1)).toBeNull();
    expect(dropTargetOf(ids, "b", 2)).toBeNull();
  });
  it("names the tab to go in front of, or null for the end", () => {
    expect(dropTargetOf(ids, "b", 0)).toEqual({ before: "a" });
    expect(dropTargetOf(ids, "a", 3)).toEqual({ before: null });
    expect(dropTargetOf(ids, "a", 2)).toEqual({ before: "c" });
  });
  it("is null for an unknown tab", () => {
    expect(dropTargetOf(ids, "x", 0)).toBeNull();
  });
});
