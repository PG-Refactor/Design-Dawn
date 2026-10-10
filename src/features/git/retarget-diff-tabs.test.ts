import { describe, expect, it } from "vitest";
import type {
  GitFileChange,
  GitStatus,
} from "../../application/ports/git-gateway";
import type { DiffTab } from "../workspace/ui-state/ui-state";
import { retargetDiffTabs } from "./retarget-diff-tabs";

function statusOf(
  ...files: readonly [string, GitFileChange, GitFileChange][]
): GitStatus {
  return {
    repositoryState: "ready",
    branch: null,
    files: files.map(([path, indexStatus, worktreeStatus]) => ({
      path,
      indexStatus,
      worktreeStatus,
      originalPath: null,
    })),
  };
}

const tab = (
  path: string,
  side: "staged" | "unstaged",
  preview = false,
): DiffTab => ({ path, side, preview });

describe("retargetDiffTabs", () => {
  it("keeps tabs whose side still has a change", () => {
    const tabs = [tab("a.md", "unstaged"), tab("b.md", "staged")];
    const result = retargetDiffTabs(
      tabs,
      tabs[0] ?? null,
      statusOf(
        ["a.md", "unmodified", "modified"],
        ["b.md", "modified", "unmodified"],
      ),
    );
    expect(result.tabs).toEqual(tabs);
    expect(result.active).toEqual({ path: "a.md", side: "unstaged" });
  });

  it("switches a tab to the other side and follows it when active", () => {
    const tabs = [tab("a.md", "unstaged", true)];
    const result = retargetDiffTabs(
      tabs,
      tabs[0] ?? null,
      statusOf(["a.md", "modified", "unmodified"]),
    );
    expect(result.tabs).toEqual([tab("a.md", "staged", true)]);
    expect(result.active).toEqual({ path: "a.md", side: "staged" });
  });

  it("merges a switched tab into the existing tab of that side (pinned wins)", () => {
    const tabs = [tab("a.md", "unstaged", true), tab("a.md", "staged")];
    const result = retargetDiffTabs(
      tabs,
      tabs[0] ?? null,
      statusOf(["a.md", "modified", "unmodified"]),
    );
    expect(result.tabs).toEqual([tab("a.md", "staged", false)]);
    expect(result.active).toEqual({ path: "a.md", side: "staged" });
  });

  it("closes tabs with nothing left and moves the active one to its neighbour", () => {
    const tabs = [
      tab("a.md", "unstaged"),
      tab("b.md", "unstaged"),
      tab("c.md", "unstaged"),
    ];
    const status = statusOf(
      ["a.md", "unmodified", "modified"],
      ["c.md", "unmodified", "modified"],
    );
    const result = retargetDiffTabs(tabs, tabs[1] ?? null, status);
    expect(result.tabs.map((entry) => entry.path)).toEqual(["a.md", "c.md"]);
    expect(result.active).toEqual({ path: "c.md", side: "unstaged" });
    const lastClosed = retargetDiffTabs(
      tabs,
      tabs[2] ?? null,
      statusOf(["a.md", "unmodified", "modified"]),
    );
    expect(lastClosed.active).toEqual({ path: "a.md", side: "unstaged" });
  });

  it("closes everything without a usable status, leaving the Document", () => {
    const tabs = [tab("a.md", "unstaged")];
    const result = retargetDiffTabs(tabs, tabs[0] ?? null, null);
    expect(result).toEqual({ tabs: [], active: null });
  });

  it("keeps the Document active when no diff tab was active", () => {
    const tabs = [tab("a.md", "unstaged")];
    const result = retargetDiffTabs(
      tabs,
      null,
      statusOf(["a.md", "unmodified", "modified"]),
    );
    expect(result.active).toBeNull();
  });
});
