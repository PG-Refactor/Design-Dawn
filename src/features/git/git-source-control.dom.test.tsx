// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitBranchInfo,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import { renderShell } from "../workspace/test-support/shell-harness";
import { GIT_MESSAGES } from "./git-messages";
import { hasHeader, headerOf, rowOf } from "./test-support/git-tree-queries";

afterEach(cleanup);

const FULL_ID = "0123456789abcdef0123456789abcdef01234567";

function statusOf(
  branch: Pick<GitBranchInfo, "head" | "oid"> | null,
  files: GitFileStatus[] = [],
): GitStatus {
  return {
    repositoryState: "ready",
    branch:
      branch === null
        ? null
        : {
            ...branch,
            upstream: null,
            ahead: null,
            behind: null,
            headPushed: false,
          },
    files,
  };
}

async function openGit(status: GitStatus) {
  const shell = await renderShell();
  shell.gitGateway.status = status;
  await shell.openProjectInUi();
  await shell.user.click(screen.getByRole("tab", { name: "Git" }));
  await screen.findByRole("heading", { name: GIT_MESSAGES.ja.changeListLabel });
  return shell;
}

const placeholderOf = () =>
  (
    screen.getByRole("textbox", {
      name: GIT_MESSAGES.ja.commitMessageLabel,
    }) as HTMLTextAreaElement
  ).placeholder;

describe("header and branch", () => {
  it("shows the title, the branch name and an icon refresh button with a tooltip", async () => {
    await openGit(statusOf({ head: "main", oid: FULL_ID }));
    const panel = screen.getByRole("region", { name: "Git" });
    expect(
      within(panel).getByRole("heading", { name: "ソース管理" }),
    ).toBeTruthy();
    expect(within(panel).getByText("main")).toBeTruthy();
    const refresh = within(panel).getByRole("button", { name: "更新" });
    expect(refresh.title).toBe("更新");
    expect(refresh.textContent).toBe("");
    expect(refresh.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("shows the short commit id and (detached) on a detached HEAD", async () => {
    await openGit(statusOf({ head: null, oid: FULL_ID }));
    expect(screen.getByText("0123456 (detached)")).toBeTruthy();
  });

  it("shows the branch name of an unborn branch", async () => {
    await openGit(statusOf({ head: "main", oid: null }));
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("shows no branch when the repository is not ready", async () => {
    const shell = await renderShell();
    shell.gitGateway.status = {
      repositoryState: "notRepository",
      branch: null,
      files: [],
    };
    await shell.openProjectInUi();
    await shell.user.click(screen.getByRole("tab", { name: "Git" }));
    await screen.findByText(GIT_MESSAGES.ja.repositoryStates.notRepository);
    expect(document.querySelector(".git-branch")).toBeNull();
    expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
  });

  it("renders a branch name that looks like HTML as text", async () => {
    await openGit(statusOf({ head: "<img src=x>", oid: FULL_ID }));
    expect(screen.getByText("<img src=x>")).toBeTruthy();
    expect(document.querySelector(".git-branch img")).toBeNull();
  });
});

describe("commit box", () => {
  it("names the branch in the placeholder, and uses a generic one when detached", async () => {
    await openGit(statusOf({ head: "main", oid: FULL_ID }));
    expect(placeholderOf()).toBe(
      "メッセージ (Ctrl+Enter で 'main' にコミット)",
    );
    cleanup();
    await openGit(statusOf({ head: null, oid: FULL_ID }));
    expect(placeholderOf()).toBe("メッセージ (Ctrl+Enter でコミット)");
  });

  it("keeps the label as the accessible name, and shows a full-width commit button with an icon", async () => {
    await openGit(statusOf({ head: "main", oid: FULL_ID }));
    const label = screen.getByText(GIT_MESSAGES.ja.commitMessageLabel);
    expect(label.classList.contains("git-visually-hidden")).toBe(true);
    const button = screen.getByRole("button", { name: "コミット" });
    expect(button.classList.contains("git-primary-button")).toBe(true);
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("English", () => {
  it("renders the panel with the English catalog", async () => {
    const shell = await openGit(
      statusOf({ head: "main", oid: FULL_ID }, [
        {
          path: "docs/a.md",
          indexStatus: "modified",
          worktreeStatus: "modified",
          originalPath: null,
        },
        {
          path: "n.md",
          indexStatus: "untracked",
          worktreeStatus: "untracked",
          originalPath: null,
        },
      ]),
    );
    act(() => shell.services.languageController.applyExternal("en"));
    const messages = GIT_MESSAGES.en;
    expect(
      await screen.findByRole("heading", { name: "Source Control" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: messages.refresh }).title).toBe(
      "Refresh",
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: messages.commitMessageLabel,
        }) as HTMLTextAreaElement
      ).placeholder,
    ).toBe("Message (Ctrl+Enter to commit on 'main')");
    expect(hasHeader("Staged Changes")).toBe(true);
    expect(hasHeader("Changes")).toBe(true);
    expect(
      screen.getByRole("treeitem", { name: "Staged Changes 1 change" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: "Changes 2 changes" }),
    ).toBeTruthy();
    expect(rowOf("Changes", "Untracked n.md")).toBeTruthy();
    expect(
      within(rowOf("Changes", "Modified docs/a.md")).getByRole("button", {
        name: "Stage Changes",
      }),
    ).toBeTruthy();
    expect(
      within(headerOf("Staged Changes")).getByRole("button", {
        name: "Unstage All Changes",
      }),
    ).toBeTruthy();
  });
});
