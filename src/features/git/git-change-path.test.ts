import { describe, expect, it } from "vitest";
import { splitGitPath } from "./git-change-path";

describe("splitGitPath", () => {
  it("returns no directory for a root file", () => {
    expect(splitGitPath("a.md")).toEqual({ name: "a.md", directory: "" });
  });

  it("splits at the last separator", () => {
    expect(splitGitPath("docs/sub/a.md")).toEqual({
      name: "a.md",
      directory: "docs/sub",
    });
  });
});
