import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE_SELECTION,
  selectOnly,
  selectRange,
  toggleSelected,
  visibleSelection,
} from "./tree-selection";

const ROWS = ["project", "a", "b", "c", "d"];

describe("tree selection", () => {
  it("chooses one row on a plain click", () => {
    expect(selectOnly("b")).toEqual({
      keys: ["b"],
      anchorKey: "b",
      activeKey: "b",
    });
  });

  it("adds and removes a row with Ctrl/Cmd, which moves the anchor", () => {
    const added = toggleSelected(selectOnly("a"), "c");
    expect(added).toEqual({ keys: ["a", "c"], anchorKey: "c", activeKey: "c" });
    const removed = toggleSelected(added, "c");
    expect(removed).toEqual({ keys: ["a"], anchorKey: "c", activeKey: "a" });
    expect(toggleSelected(removed, "a")).toEqual({
      keys: [],
      anchorKey: "a",
      activeKey: null,
    });
  });

  it("chooses the range from the anchor with Shift, either way", () => {
    expect(selectRange(selectOnly("b"), "d", ROWS)).toEqual({
      keys: ["b", "c", "d"],
      anchorKey: "b",
      activeKey: "d",
    });
    expect(selectRange(selectOnly("c"), "a", ROWS).keys).toEqual([
      "a",
      "b",
      "c",
    ]);
    // A second Shift click replaces the range; the anchor stays.
    const first = selectRange(selectOnly("b"), "d", ROWS);
    expect(selectRange(first, "a", ROWS).keys).toEqual(["a", "b"]);
  });

  it("starts a range at the clicked row when there is no anchor shown", () => {
    expect(selectRange(EMPTY_TREE_SELECTION, "c", ROWS)).toEqual(
      selectOnly("c"),
    );
    expect(selectRange(selectOnly("gone"), "c", ROWS)).toEqual(selectOnly("c"));
  });

  it("keeps only the rows that are still shown", () => {
    const selection = selectRange(selectOnly("a"), "c", ROWS);
    expect(visibleSelection(selection, ["project", "a", "c"])).toEqual({
      keys: ["a", "c"],
      anchorKey: "a",
      activeKey: "c",
    });
    expect(visibleSelection(selection, ["project", "b"])).toEqual({
      keys: ["b"],
      anchorKey: null,
      activeKey: null,
    });
    expect(visibleSelection(selection, ROWS)).toBe(selection);
  });
});
