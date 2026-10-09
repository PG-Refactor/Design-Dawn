import { describe, expect, it } from "vitest";
import type {
  GitFileChange,
  GitStatus,
} from "../../application/ports/git-gateway";
import type { GitSelection } from "../workspace/ui-state/ui-state";
import { nextDiffAction } from "./next-diff-action";

function statusOf(
  indexStatus: GitFileChange,
  worktreeStatus: GitFileChange,
  path = "a.md",
): GitStatus {
  return {
    repositoryState: "ready",
    files: [{ path, indexStatus, worktreeStatus, originalPath: null }],
  };
}

const STAGED: GitSelection = { path: "a.md", side: "staged" };
const UNSTAGED: GitSelection = { path: "a.md", side: "unstaged" };

describe("nextDiffAction", () => {
  it("does nothing without a selection", () => {
    expect(nextDiffAction(null, statusOf("modified", "unmodified"))).toEqual({
      kind: "none",
    });
  });

  it("reloads the selected side while it still has a change", () => {
    expect(nextDiffAction(STAGED, statusOf("modified", "unmodified"))).toEqual({
      kind: "reload",
    });
    expect(
      nextDiffAction(UNSTAGED, statusOf("unmodified", "modified")),
    ).toEqual({ kind: "reload" });
  });

  it("reloads the selected side of a partly staged file, whichever it is", () => {
    const partly = statusOf("modified", "modified");
    expect(nextDiffAction(STAGED, partly).kind).toBe("reload");
    expect(nextDiffAction(UNSTAGED, partly).kind).toBe("reload");
  });

  it("counts an untracked file as an unstaged change", () => {
    const untracked = statusOf("untracked", "untracked");
    expect(nextDiffAction(UNSTAGED, untracked).kind).toBe("reload");
    expect(nextDiffAction(STAGED, untracked)).toEqual({
      kind: "switch",
      selection: UNSTAGED,
    });
  });

  it("switches to the other side when the selected one has nothing left", () => {
    expect(nextDiffAction(UNSTAGED, statusOf("added", "unmodified"))).toEqual({
      kind: "switch",
      selection: STAGED,
    });
    expect(nextDiffAction(STAGED, statusOf("unmodified", "modified"))).toEqual({
      kind: "switch",
      selection: UNSTAGED,
    });
  });

  it("closes when the file has no change on either side", () => {
    expect(
      nextDiffAction(STAGED, statusOf("unmodified", "unmodified")).kind,
    ).toBe("close");
    expect(
      nextDiffAction(STAGED, statusOf("modified", "unmodified", "b.md")).kind,
    ).toBe("close");
    expect(
      nextDiffAction(STAGED, { repositoryState: "ready", files: [] }).kind,
    ).toBe("close");
  });

  it("closes for a conflict, whichever side was selected", () => {
    const conflict = statusOf("unmerged", "unmerged");
    expect(nextDiffAction(STAGED, conflict).kind).toBe("close");
    expect(nextDiffAction(UNSTAGED, conflict).kind).toBe("close");
  });

  it("closes when the repository is not ready or the status is gone", () => {
    expect(nextDiffAction(STAGED, null).kind).toBe("close");
    expect(
      nextDiffAction(STAGED, { repositoryState: "error", files: [] }).kind,
    ).toBe("close");
  });
});
