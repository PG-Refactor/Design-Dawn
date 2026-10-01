import { describe, expect, it } from "vitest";
import {
  type FlatTreeItem,
  tabTargetIndex,
  treeNavigation,
} from "./keyboard-navigation";

describe("tabTargetIndex", () => {
  it("moves with the arrows and wraps around", () => {
    expect(tabTargetIndex("ArrowRight", 0, 3)).toBe(1);
    expect(tabTargetIndex("ArrowRight", 2, 3)).toBe(0);
    expect(tabTargetIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(tabTargetIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("jumps to the first and last tab", () => {
    expect(tabTargetIndex("Home", 2, 3)).toBe(0);
    expect(tabTargetIndex("End", 0, 3)).toBe(2);
  });

  it("ignores other keys and empty lists", () => {
    expect(tabTargetIndex("a", 0, 3)).toBeNull();
    expect(tabTargetIndex("ArrowDown", 0, 3)).toBeNull();
    expect(tabTargetIndex("ArrowRight", 0, 0)).toBeNull();
  });

  it("stays on a single tab", () => {
    expect(tabTargetIndex("ArrowRight", 0, 1)).toBe(0);
    expect(tabTargetIndex("ArrowLeft", 0, 1)).toBe(0);
  });
});

// project, document 1 (open, two sheets), document 2 (unopened), document 3 (failed)
const ITEMS: readonly FlatTreeItem[] = [
  {
    key: "project",
    parentIndex: null,
    firstChildIndex: 1,
    opensOnExpand: false,
  },
  { key: "d1", parentIndex: 0, firstChildIndex: 2, opensOnExpand: false },
  { key: "s1", parentIndex: 1, firstChildIndex: null, opensOnExpand: false },
  { key: "s2", parentIndex: 1, firstChildIndex: null, opensOnExpand: false },
  { key: "d2", parentIndex: 0, firstChildIndex: null, opensOnExpand: true },
  { key: "d3", parentIndex: 0, firstChildIndex: null, opensOnExpand: false },
];

describe("treeNavigation", () => {
  it("moves down and up over visible items without wrapping", () => {
    expect(treeNavigation("ArrowDown", ITEMS, 0)).toEqual({
      action: "focus",
      index: 1,
    });
    expect(treeNavigation("ArrowDown", ITEMS, 5)).toBeNull();
    expect(treeNavigation("ArrowUp", ITEMS, 3)).toEqual({
      action: "focus",
      index: 2,
    });
    expect(treeNavigation("ArrowUp", ITEMS, 0)).toBeNull();
  });

  it("jumps to the first and last item", () => {
    expect(treeNavigation("Home", ITEMS, 3)).toEqual({
      action: "focus",
      index: 0,
    });
    expect(treeNavigation("End", ITEMS, 0)).toEqual({
      action: "focus",
      index: 5,
    });
  });

  it("opens an unopened document with ArrowRight, else moves to the first child", () => {
    expect(treeNavigation("ArrowRight", ITEMS, 4)).toEqual({
      action: "open",
      index: 4,
    });
    expect(treeNavigation("ArrowRight", ITEMS, 1)).toEqual({
      action: "focus",
      index: 2,
    });
    expect(treeNavigation("ArrowRight", ITEMS, 0)).toEqual({
      action: "focus",
      index: 1,
    });
    expect(treeNavigation("ArrowRight", ITEMS, 2)).toBeNull();
    expect(treeNavigation("ArrowRight", ITEMS, 5)).toBeNull();
  });

  it("moves to the parent with ArrowLeft", () => {
    expect(treeNavigation("ArrowLeft", ITEMS, 3)).toEqual({
      action: "focus",
      index: 1,
    });
    expect(treeNavigation("ArrowLeft", ITEMS, 1)).toEqual({
      action: "focus",
      index: 0,
    });
    expect(treeNavigation("ArrowLeft", ITEMS, 0)).toBeNull();
  });

  it("ignores other keys and unknown indices", () => {
    expect(treeNavigation("x", ITEMS, 1)).toBeNull();
    expect(treeNavigation("ArrowDown", ITEMS, 99)).toBeNull();
  });
});
