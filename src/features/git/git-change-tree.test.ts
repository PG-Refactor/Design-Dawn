import { describe, expect, it } from "vitest";
import type {
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import {
  NAVIGATION_KEYS,
  treeNavigation,
} from "../workspace/view-models/keyboard-navigation";
import { deriveGitChangeSections } from "./git-change-sections";
import { buildGitTreeItems, toFlatTreeItems } from "./git-change-tree";

function file(
  path: string,
  indexStatus: GitFileChange,
  worktreeStatus: GitFileChange,
): GitFileStatus {
  return { path, indexStatus, worktreeStatus, originalPath: null };
}

const STATUS: GitStatus = {
  repositoryState: "ready",
  branch: null,
  files: [
    file("a.md", "modified", "unmodified"),
    file("b.md", "unmodified", "modified"),
    file("c.md", "unmodified", "modified"),
  ],
};

const sections = deriveGitChangeSections(STATUS);

describe("buildGitTreeItems", () => {
  it("lists each header followed by its files", () => {
    const items = buildGitTreeItems(sections, new Set());
    expect(items.map((item) => item.key)).toEqual([
      "section:staged",
      "staged:a.md",
      "section:changes",
      "changes:b.md",
      "changes:c.md",
    ]);
  });

  it("shows only the header of a collapsed section", () => {
    const items = buildGitTreeItems(sections, new Set(["staged"]));
    expect(items.map((item) => item.key)).toEqual([
      "section:staged",
      "section:changes",
      "changes:b.md",
      "changes:c.md",
    ]);
  });
});

describe("tree keys", () => {
  const flat = toFlatTreeItems(buildGitTreeItems(sections, new Set()));

  it("moves between visible items and to the ends", () => {
    expect(treeNavigation(NAVIGATION_KEYS.arrowDown, flat, 0)).toEqual({
      action: "focus",
      index: 1,
    });
    expect(treeNavigation(NAVIGATION_KEYS.end, flat, 0)).toEqual({
      action: "focus",
      index: 4,
    });
    expect(treeNavigation(NAVIGATION_KEYS.home, flat, 3)).toEqual({
      action: "focus",
      index: 0,
    });
  });

  it("moves a file to its header with ArrowLeft, and a header to its first file with ArrowRight", () => {
    expect(treeNavigation(NAVIGATION_KEYS.arrowLeft, flat, 4)).toEqual({
      action: "focus",
      index: 2,
    });
    expect(treeNavigation(NAVIGATION_KEYS.arrowRight, flat, 2)).toEqual({
      action: "focus",
      index: 3,
    });
  });

  it("collapses an expanded header and expands a collapsed one", () => {
    expect(treeNavigation(NAVIGATION_KEYS.arrowLeft, flat, 0)).toEqual({
      action: "collapse",
      index: 0,
    });
    const collapsed = toFlatTreeItems(
      buildGitTreeItems(sections, new Set(["staged"])),
    );
    expect(treeNavigation(NAVIGATION_KEYS.arrowRight, collapsed, 0)).toEqual({
      action: "expand",
      index: 0,
    });
    expect(treeNavigation(NAVIGATION_KEYS.arrowLeft, collapsed, 0)).toBeNull();
  });
});
