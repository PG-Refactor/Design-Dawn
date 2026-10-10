import { describe, expect, it } from "vitest";
import type {
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import {
  deriveGitChangeSections,
  focusKeyAfterChange,
} from "./git-change-sections";

function file(
  path: string,
  indexStatus: GitFileChange,
  worktreeStatus: GitFileChange,
  originalPath: string | null = null,
): GitFileStatus {
  return { path, indexStatus, worktreeStatus, originalPath };
}

function statusOf(...files: GitFileStatus[]): GitStatus {
  return { repositoryState: "ready", branch: null, files };
}

function summary(status: GitStatus) {
  return deriveGitChangeSections(status).map((section) => [
    section.id,
    section.entries.map((entry) => entry.path),
  ]);
}

describe("deriveGitChangeSections", () => {
  it("has no sections without changes, and ignores unmodified / ignored files", () => {
    expect(deriveGitChangeSections(statusOf())).toEqual([]);
    expect(
      deriveGitChangeSections(
        statusOf(
          file("a", "unmodified", "unmodified"),
          file("b", "ignored", "ignored"),
        ),
      ),
    ).toEqual([]);
  });

  it.each([
    ["modified"],
    ["added"],
    ["deleted"],
    ["renamed"],
    ["copied"],
    ["typeChanged"],
  ] as const)(
    "puts an index side %s into the staged section only",
    (change) => {
      expect(summary(statusOf(file("a", change, "unmodified")))).toEqual([
        ["staged", ["a"]],
      ]);
    },
  );

  it.each([["modified"], ["deleted"], ["typeChanged"]] as const)(
    "puts a work tree side %s into the changes section only",
    (change) => {
      expect(summary(statusOf(file("a", "unmodified", change)))).toEqual([
        ["changes", ["a"]],
      ]);
    },
  );

  it("puts unmerged on either side into conflicts, listed first", () => {
    expect(
      summary(
        statusOf(
          file("m", "modified", "unmodified"),
          file("c1", "unmerged", "unmerged"),
          file("c2", "unmodified", "unmerged"),
          file("c3", "added", "unmerged"),
        ),
      ),
    ).toEqual([
      ["conflicts", ["c1", "c2", "c3"]],
      ["staged", ["m"]],
    ]);
  });

  it("lists untracked files in changes, sorted with the other changes by path", () => {
    const sections = deriveGitChangeSections(
      statusOf(
        file("m.md", "unmodified", "modified"),
        file("a.md", "untracked", "untracked"),
        file("z.md", "unmodified", "modified"),
        file("b/c.md", "untracked", "untracked"),
      ),
    );
    expect(sections.map((section) => section.id)).toEqual(["changes"]);
    expect(
      sections[0]?.entries.map((entry) => [entry.path, entry.change]),
    ).toEqual([
      ["a.md", "untracked"],
      ["b/c.md", "untracked"],
      ["m.md", "modified"],
      ["z.md", "modified"],
    ]);
    expect(sections[0]?.entries[0]?.key).toBe("changes:a.md");
    expect(sections[0]?.entries[0]?.selectionSide).toBe("unstaged");
  });

  it("lists a partly staged file in both staged and changes, in display order", () => {
    const sections = deriveGitChangeSections(
      statusOf(
        file("z", "unmodified", "modified"),
        file("a", "modified", "modified"),
      ),
    );
    expect(sections.map((section) => section.id)).toEqual([
      "staged",
      "changes",
    ]);
    const keys = sections.flatMap((section) =>
      section.entries.map((e) => e.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(sections[0]?.entries[0]?.selectionSide).toBe("staged");
    expect(sections[1]?.entries.map((entry) => entry.selectionSide)).toEqual([
      "unstaged",
      "unstaged",
    ]);
  });

  it("keeps the original path of a staged rename only, and conflicts unselectable", () => {
    const sections = deriveGitChangeSections(
      statusOf(
        file("new.md", "renamed", "modified", "old.md"),
        file("x", "unmerged", "unmerged", "ignored.md"),
      ),
    );
    const staged = sections.find((section) => section.id === "staged");
    const changes = sections.find((section) => section.id === "changes");
    const conflicts = sections.find((section) => section.id === "conflicts");
    expect(staged?.entries[0]?.originalPath).toBe("old.md");
    expect(changes?.entries[0]?.originalPath).toBeNull();
    expect(conflicts?.entries[0]?.originalPath).toBeNull();
    expect(conflicts?.entries[0]?.selectionSide).toBeNull();
  });
});

describe("focusKeyAfterChange", () => {
  const before = deriveGitChangeSections(
    statusOf(
      file("a", "modified", "unmodified"),
      file("b", "modified", "unmodified"),
      file("c", "unmodified", "modified"),
      file("u", "untracked", "untracked"),
    ),
  );

  function statusAfter(...files: GitFileStatus[]) {
    return deriveGitChangeSections(statusOf(...files));
  }

  it("keeps the same row when it is still in the same section", () => {
    expect(focusKeyAfterChange(before, before, "staged:a")).toBe("staged:a");
  });

  it("moves to the next row of the section when the row left", () => {
    const next = statusAfter(
      file("b", "modified", "unmodified"),
      file("c", "unmodified", "modified"),
      file("u", "untracked", "untracked"),
    );
    expect(focusKeyAfterChange(before, next, "staged:a")).toBe("staged:b");
  });

  it("moves to the first row of the next section when the section is empty", () => {
    const next = statusAfter(
      file("c", "unmodified", "modified"),
      file("u", "untracked", "untracked"),
    );
    expect(focusKeyAfterChange(before, next, "staged:b")).toBe("changes:c");
  });

  it("moves to the previous row when nothing follows, and to nothing when empty", () => {
    const next = statusAfter(file("a", "modified", "unmodified"));
    expect(focusKeyAfterChange(before, next, "changes:u")).toBe("staged:a");
    expect(focusKeyAfterChange(before, statusAfter(), "staged:a")).toBeNull();
  });
});
