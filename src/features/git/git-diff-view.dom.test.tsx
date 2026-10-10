// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitDiff,
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import { settle } from "../../application/test-support/fakes";
import { DIFF_PANEL_ID } from "../workspace/tab-ids";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { GIT_MESSAGES } from "./git-messages";
import { headerOf, rowOf } from "./test-support/git-tree-queries";

afterEach(cleanup);

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

async function settled(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

async function openChanges(...files: GitFileStatus[]): Promise<ShellHarness> {
  const shell = await renderShell();
  shell.gitGateway.status = statusOf(...files);
  await shell.openProjectInUi();
  await shell.user.click(
    within(
      screen.getByRole("tablist", { name: "左パネルの表示切り替え" }),
    ).getByRole("tab", { name: "Git" }),
  );
  await screen.findByRole("heading", { name: GIT_MESSAGES.ja.changeListLabel });
  return shell;
}

const clickRow = (shell: ShellHarness, title: string, name: string) =>
  shell.user.click(
    rowOf(title, name).querySelector(".git-file-row__name") as HTMLElement,
  );
const diffPanel = () => document.getElementById(DIFF_PANEL_ID);
const mainArea = (): HTMLElement => {
  const panel = diffPanel();
  if (panel === null) throw new Error("no diff panel");
  return panel;
};
const noDiffPanel = () => expect(diffPanel()).toBeNull();

function textDiff(
  path: string,
  side: "staged" | "unstaged",
  diff: string,
): GitDiff {
  return { path, side, outcome: "text", diff };
}

const SAMPLE_DIFF = [
  "diff --git a/a.md b/a.md",
  "--- a/a.md",
  "+++ b/a.md",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

describe("opening a diff", () => {
  it("asks for the side of the row: staged, changed and untracked rows", async () => {
    const shell = await openChanges(
      file("a.md", "modified", "unmodified"),
      file("c.md", "unmodified", "modified"),
      file("d.md", "untracked", "untracked"),
    );
    noDiffPanel();
    await clickRow(shell, "ステージされている変更", "変更 a.md");
    await clickRow(shell, "変更", "変更 c.md");
    await clickRow(shell, "変更", "未追跡 d.md");
    await settled();
    expect(
      shell.gitGateway.diffCalls.map(({ path, side }) => ({ path, side })),
    ).toEqual([
      { path: "a.md", side: "staged" },
      { path: "c.md", side: "unstaged" },
      { path: "d.md", side: "unstaged" },
    ]);
  });

  it("opens no diff for a conflict", async () => {
    const shell = await openChanges(file("x.md", "unmerged", "unmerged"));
    await clickRow(shell, "マージの変更", "競合 x.md");
    expect(shell.gitGateway.diffCalls).toHaveLength(0);
    expect(shell.uiStateStore.getState().diffTabs).toEqual([]);
    noDiffPanel();
  });

  it("loads again when the same row is selected again", async () => {
    const shell = await openChanges(file("c.md", "unmodified", "modified"));
    await clickRow(shell, "変更", "変更 c.md");
    await clickRow(shell, "変更", "変更 c.md");
    await settled();
    expect(shell.gitGateway.diffCalls).toHaveLength(2);
  });

  it("shows a loading state, then the diff lines with their prefixes", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      SAMPLE_DIFF,
    );
    const release = shell.gitGateway.holdNextDiff();
    await clickRow(shell, "変更", "変更 a.md");
    const loading = within(mainArea()).getByRole("status");
    expect(loading.textContent).toBe(GIT_MESSAGES.ja.diffLoading);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      release();
      await settle();
    });
    // Side by side by default: old then new, the sign is a gutter and not part of the text.
    const added = within(mainArea()).getByText("new");
    expect(added.closest("td")?.className).toContain("git-diff__code--added");
    const removed = within(mainArea()).getByText("old");
    expect(removed.closest("td")?.className).toContain(
      "git-diff__code--removed",
    );
    expect(removed.closest("tr")).toBe(added.closest("tr"));
    expect(removed.closest("td")?.textContent).toBe("-削除old");
    expect(added.closest("td")?.textContent).toBe("+追加new");
    expect(within(mainArea()).queryByText("+++ b/a.md")).toBeNull();
    expect(within(mainArea()).queryByRole("status")).toBeNull();
    expect(
      within(mainArea()).getByRole("heading", { name: "a.md" }),
    ).toBeTruthy();
  });

  it("renders HTML-looking diff text as text", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      "@@ -1 +1 @@\n+<img src=x onerror=alert(1)><b>bold</b>\n",
    );
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    expect(
      within(mainArea()).getByText("<img src=x onerror=alert(1)><b>bold</b>"),
    ).toBeTruthy();
    expect(mainArea().querySelector("img, b")).toBeNull();
  });

  it("shows a staged rename as old → new", async () => {
    const shell = await openChanges(
      file("new.md", "renamed", "unmodified", "old.md"),
    );
    await clickRow(shell, "ステージされている変更", "名前変更 old.md → new.md");
    await settled();
    expect(
      within(mainArea()).getByRole("heading", { name: "old.md → new.md" }),
    ).toBeTruthy();
  });
});

describe("outcomes", () => {
  const CASES: readonly [string, GitDiff, string][] = [
    [
      "empty",
      { path: "a.md", side: "unstaged", outcome: "empty" },
      GIT_MESSAGES.ja.diffEmpty,
    ],
    [
      "untracked",
      { path: "a.md", side: "unstaged", outcome: "untracked" },
      "新しいファイルです（まだGitで管理されていません）",
    ],
    [
      "binary",
      { path: "a.md", side: "unstaged", outcome: "binary" },
      "バイナリファイルのため、差分を表示できません",
    ],
    [
      "tooLarge",
      {
        path: "a.md",
        side: "unstaged",
        outcome: "tooLarge",
        limitBytes: 1048576,
      },
      "差分が大きすぎるため表示できません（上限 1 MiB）",
    ],
    [
      "notUtf8",
      { path: "a.md", side: "unstaged", outcome: "notUtf8" },
      "UTF-8として読めないため、差分を表示できません",
    ],
  ];

  it.each(CASES)("shows the %s outcome as text", async (_name, diff, text) => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.diffs["unstaged:a.md"] = diff;
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    expect(within(mainArea()).getByText(text)).toBeTruthy();
  });

  it("says so and retries when the diff could not be loaded", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.failure = { kind: "gitTimeout", detail: "slow" };
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    expect(
      within(mainArea()).getByText(GIT_MESSAGES.ja.diffFailed),
    ).toBeTruthy();
    shell.gitGateway.failure = null;
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      "@@ -1 +1 @@\n+ok\n",
    );
    await shell.user.click(
      within(mainArea()).getByRole("button", { name: GIT_MESSAGES.ja.retry }),
    );
    await settled();
    expect(within(mainArea()).getByText("ok")).toBeTruthy();
    expect(
      within(mainArea()).queryByText(GIT_MESSAGES.ja.diffFailed),
    ).toBeNull();
  });
});

describe("both sides of a file", () => {
  it("open as two tabs, each with its own diff", async () => {
    const shell = await openChanges(file("both.md", "modified", "modified"));
    shell.gitGateway.diffs["unstaged:both.md"] = textDiff(
      "both.md",
      "unstaged",
      "@@ -1 +1 @@\n+unstaged side\n",
    );
    shell.gitGateway.diffs["staged:both.md"] = textDiff(
      "both.md",
      "staged",
      "@@ -1 +1 @@\n+staged side\n",
    );
    // A double click pins the first tab, so the next preview does not replace it.
    await shell.user.dblClick(
      rowOf("変更", "変更 both.md").querySelector(
        ".git-file-row__name",
      ) as HTMLElement,
    );
    await settled();
    expect(within(mainArea()).getByText("unstaged side")).toBeTruthy();
    await clickRow(shell, "ステージされている変更", "変更 both.md");
    await settled();
    expect(within(mainArea()).getByText("staged side")).toBeTruthy();
    expect(within(mainArea()).queryByText("unstaged side")).toBeNull();
    // The side is not a switch inside the view any more.
    expect(screen.queryByRole("tablist", { name: "差分の対象" })).toBeNull();
    expect(screen.getByRole("tab", { name: "both.md (Index)" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "both.md (Working Tree)" }),
    ).toBeTruthy();
  });
});

describe("closing", () => {
  it("closes with the tab's button and drops the loaded diff", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    await shell.user.click(
      screen.getByRole("button", { name: "a.md (Working Tree)を閉じる" }),
    );
    expect(shell.uiStateStore.getState().diffTabs).toEqual([]);
    expect(shell.gitController.store.getState().diff).toBeNull();
    noDiffPanel();
    expect(screen.queryByRole("tablist", { name: "Document Tabs" })).toBeNull();
  });

  it("has no Close button or Escape handling inside the view", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      SAMPLE_DIFF,
    );
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    expect(
      within(mainArea()).queryByRole("button", { name: "閉じる" }),
    ).toBeNull();
    within(mainArea()).getByRole("region", { name: "差分の内容" }).focus();
    await shell.user.keyboard("{Escape}");
    expect(shell.uiStateStore.getState().diffTabs).toHaveLength(1);
  });
});

describe("after stage and unstage", () => {
  it("reloads the same side while it still has changes (partly staged)", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(file("a.md", "modified", "modified")),
    );
    await shell.user.click(
      within(rowOf("変更", "変更 a.md")).getByRole("button", {
        name: GIT_MESSAGES.ja.stage,
      }),
    );
    await settled();
    expect(shell.gitGateway.diffCalls.map((call) => call.side)).toEqual([
      "unstaged",
      "unstaged",
    ]);
    expect(shell.uiStateStore.getState().activeMainTab).toEqual({
      kind: "diff",
      path: "a.md",
      side: "unstaged",
    });
  });

  it("switches to the staged side when the only change moved there", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.diffs["staged:a.md"] = textDiff(
      "a.md",
      "staged",
      "@@ -1 +1 @@\n+now staged\n",
    );
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(file("a.md", "modified", "unmodified")),
    );
    await shell.user.click(
      within(rowOf("変更", "変更 a.md")).getByRole("button", {
        name: GIT_MESSAGES.ja.stage,
      }),
    );
    await settled();
    expect(shell.uiStateStore.getState().activeMainTab).toEqual({
      kind: "diff",
      path: "a.md",
      side: "staged",
    });
    expect(within(mainArea()).getByText("now staged")).toBeTruthy();
  });

  it("switches to the unstaged side after unstaging everything, and closes when the file is gone", async () => {
    const shell = await openChanges(
      file("a.md", "modified", "unmodified"),
      file("b.md", "added", "unmodified"),
    );
    await clickRow(shell, "ステージされている変更", "変更 a.md");
    await settled();
    shell.gitGateway.nextUnstageResult = operationOk(
      statusOf(
        file("a.md", "unmodified", "modified"),
        file("b.md", "untracked", "untracked"),
      ),
    );
    await shell.user.click(
      within(rowOf("ステージされている変更", "変更 a.md")).getByRole("button", {
        name: GIT_MESSAGES.ja.unstage,
      }),
    );
    await settled();
    expect(shell.uiStateStore.getState().activeMainTab).toEqual({
      kind: "diff",
      path: "a.md",
      side: "unstaged",
    });

    // The file disappears from both sides.
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(file("b.md", "added", "unmodified")),
    );
    await shell.user.click(
      within(rowOf("変更", "変更 a.md")).getByRole("button", {
        name: GIT_MESSAGES.ja.stage,
      }),
    );
    await settled();
    expect(shell.uiStateStore.getState().diffTabs).toEqual([]);
    expect(shell.gitController.store.getState().diff).toBeNull();
  });

  it("applies the rule after a bulk stage", async () => {
    const shell = await openChanges(
      file("a.md", "unmodified", "modified"),
      file("d.md", "untracked", "untracked"),
    );
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(
        file("a.md", "modified", "unmodified"),
        file("d.md", "added", "unmodified"),
      ),
    );
    await shell.user.click(
      within(headerOf("変更")).getByRole("button", {
        name: GIT_MESSAGES.ja.stageAll,
      }),
    );
    await settled();
    expect(shell.uiStateStore.getState().activeMainTab).toEqual({
      kind: "diff",
      path: "a.md",
      side: "staged",
    });
  });

  it("does not fake success after a failed stage: the re-read status decides", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    shell.gitGateway.nextStageResult = operationErr("gitCommandFailed", "no");
    await shell.user.click(
      within(rowOf("変更", "変更 a.md")).getByRole("button", {
        name: GIT_MESSAGES.ja.stage,
      }),
    );
    await settled();
    // The unchanged status was read again, so the unstaged diff is still the right one.
    expect(shell.uiStateStore.getState().activeMainTab).toEqual({
      kind: "diff",
      path: "a.md",
      side: "unstaged",
    });
    expect(shell.gitGateway.diffCalls.at(-1)).toMatchObject({
      path: "a.md",
      side: "unstaged",
    });
  });
});

describe("races", () => {
  it("shows only the latest selection when an earlier answer arrives late", async () => {
    const shell = await openChanges(
      file("a.md", "unmodified", "modified"),
      file("b.md", "unmodified", "modified"),
    );
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      "@@ -1 +1 @@\n+from A\n",
    );
    shell.gitGateway.diffs["unstaged:b.md"] = textDiff(
      "b.md",
      "unstaged",
      "@@ -1 +1 @@\n+from B\n",
    );
    const release = shell.gitGateway.holdNextDiff();
    await clickRow(shell, "変更", "変更 a.md");
    await clickRow(shell, "変更", "変更 b.md");
    // While A is outstanding nothing of A may show for B.
    expect(within(mainArea()).queryByText("from A")).toBeNull();
    expect(
      within(mainArea()).getByText(GIT_MESSAGES.ja.diffLoading),
    ).toBeTruthy();
    await act(async () => {
      release();
      await settle();
    });
    expect(within(mainArea()).queryByText("from A")).toBeNull();
    expect(within(mainArea()).getByText("from B")).toBeTruthy();
  });

  it("hides the old diff when the Project is closed", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      "@@ -1 +1 @@\n+secret\n",
    );
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(screen.queryByText("secret")).toBeNull();
    noDiffPanel();
  });
});

describe("diff layout", () => {
  const MODIFIED = [
    "diff --git a/a.md b/a.md",
    "--- a/a.md",
    "+++ b/a.md",
    "@@ -10,3 +10,4 @@ heading",
    " same",
    "-old one",
    "-old two",
    "+new one",
    "+new two",
    "+new three",
    "",
  ].join("\n");

  const toggle = () =>
    within(mainArea()).getByRole("button", {
      name: GIT_MESSAGES.ja.diffViewToggle,
    });
  const rowsOf = () =>
    Array.from(mainArea().querySelectorAll("tbody tr")).map((row) =>
      Array.from(row.children).map((cell) => cell.textContent),
    );

  async function openModified(): Promise<ShellHarness> {
    const shell = await openChanges(
      file("a.md", "unmodified", "modified"),
      file("b.md", "unmodified", "modified"),
    );
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      MODIFIED,
    );
    shell.gitGateway.diffs["unstaged:b.md"] = textDiff(
      "b.md",
      "unstaged",
      "@@ -0,0 +1 @@\n+only\n",
    );
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    return shell;
  }

  it("is side by side by default: numbers, pairing and fillers", async () => {
    await openModified();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().getAttribute("title")).toBe(GIT_MESSAGES.ja.diffViewToggle);
    expect(rowsOf()).toEqual([
      [`${GIT_MESSAGES.ja.diffHunkLabel}heading`],
      ["10", "same", "10", "same"],
      ["11", "-削除old one", "11", "+追加new one"],
      ["12", "-削除old two", "12", "+追加new two"],
      ["", "", "13", "+追加new three"],
    ]);
    expect(mainArea().querySelector(".git-diff__code--filler")).not.toBeNull();
  });

  it("switches to inline and back, and keeps the scroll region reachable", async () => {
    const shell = await openModified();
    await shell.user.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(shell.uiStateStore.getState().diffViewMode).toBe("inline");
    expect(rowsOf()).toEqual([
      [`${GIT_MESSAGES.ja.diffHunkLabel}heading`],
      ["10", "10", "same"],
      ["11", "", "-削除old one"],
      ["12", "", "-削除old two"],
      ["", "11", "+追加new one"],
      ["", "12", "+追加new two"],
      ["", "13", "+追加new three"],
    ]);
    const region = within(mainArea()).getByRole("region", {
      name: GIT_MESSAGES.ja.diffTextLabel,
    });
    expect(region.getAttribute("tabindex")).toBe("0");
    await shell.user.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(rowsOf()).toHaveLength(5);
  });

  it("shares the mode between tabs and keeps it when the Project is closed", async () => {
    const shell = await openModified();
    await shell.user.click(toggle());
    await clickRow(shell, "変更", "変更 b.md");
    await settled();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(rowsOf()).toEqual([
      [GIT_MESSAGES.ja.diffHunkLabel],
      ["", "1", "+追加only"],
    ]);
    expect(mainArea().querySelector(".git-diff__table--inline")).not.toBeNull();
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(shell.uiStateStore.getState().diffViewMode).toBe("inline");
  });

  it("has no toggle for results that are not text", async () => {
    const shell = await openChanges(file("a.md", "unmodified", "modified"));
    shell.gitGateway.diffs["unstaged:a.md"] = {
      path: "a.md",
      side: "unstaged",
      outcome: "binary",
    };
    await clickRow(shell, "変更", "変更 a.md");
    await settled();
    expect(
      within(mainArea()).getByText(GIT_MESSAGES.ja.diffBinary),
    ).toBeTruthy();
    expect(
      within(mainArea()).queryByRole("button", {
        name: GIT_MESSAGES.ja.diffViewToggle,
      }),
    ).toBeNull();
    expect(mainArea().querySelector("table")).toBeNull();
  });

  it("uses the English labels", async () => {
    const shell = await openModified();
    act(() => shell.services.languageController.applyExternal("en"));
    const messages = GIT_MESSAGES.en;
    expect(
      within(mainArea()).getByRole("button", { name: "Toggle Inline View" }),
    ).toBeTruthy();
    expect(
      within(mainArea()).getByRole("region", { name: messages.diffTextLabel }),
    ).toBeTruthy();
    expect(rowsOf()[2]).toEqual([
      "11",
      "-removedold one",
      "11",
      "+addednew one",
    ]);
  });
});
