// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitDiff,
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import { operationOk } from "../../application/ports/operation-error";
import { settle } from "../../application/test-support/fakes";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { GIT_MESSAGES } from "./git-messages";
import { rowOf } from "./test-support/git-tree-queries";

afterEach(cleanup);

function file(
  path: string,
  indexStatus: GitFileChange,
  worktreeStatus: GitFileChange,
): GitFileStatus {
  return { path, indexStatus, worktreeStatus, originalPath: null };
}

function statusOf(...files: GitFileStatus[]): GitStatus {
  return { repositoryState: "ready", branch: null, files };
}

async function settled(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

async function showMode(
  shell: ShellHarness,
  mode: "Project" | "Git",
  label: string = WORKSPACE_MESSAGES.ja.leftPanel.tabsLabel,
) {
  await shell.user.click(
    within(screen.getByRole("tablist", { name: label })).getByRole("tab", {
      name: mode,
    }),
  );
}

async function openChanges(
  options: { readonly withDocument?: boolean; readonly language?: string } = {},
  ...files: GitFileStatus[]
): Promise<ShellHarness> {
  const shell = await renderShell(
    options.language === undefined
      ? {}
      : { systemLanguages: [options.language] },
  );
  shell.gitGateway.status = statusOf(...files);
  await shell.openProjectInUi();
  if (options.withDocument === true) {
    await shell.user.click(
      within(screen.getByRole("treeitem", { name: "Document A" })).getByText(
        "Document A",
      ),
    );
    await screen.findByRole("tablist", { name: "Sheet Tabs" });
  }
  const english = options.language === "en-US";
  await showMode(
    shell,
    "Git",
    WORKSPACE_MESSAGES[english ? "en" : "ja"].leftPanel.tabsLabel,
  );
  await screen.findByRole("heading", {
    name: GIT_MESSAGES[english ? "en" : "ja"].changeListLabel,
  });
  return shell;
}

const nameOf = (title: string, name: string): HTMLElement =>
  rowOf(title, name).querySelector(".git-file-row__name") as HTMLElement;
const click = (shell: ShellHarness, title: string, name: string) =>
  shell.user.click(nameOf(title, name));
const dblClick = (shell: ShellHarness, title: string, name: string) =>
  shell.user.dblClick(nameOf(title, name));
const diffTab = (name: string): HTMLElement =>
  screen.getByRole("tab", { name });
const diffTabs = (): HTMLElement[] =>
  screen.getAllByRole("tab").filter((tab) => tab.id.startsWith("diff-tab-"));
const isPreview = (tab: HTMLElement): boolean =>
  tab.parentElement?.classList.contains("tab--preview") === true;
const isSelected = (tab: HTMLElement): boolean =>
  tab.getAttribute("aria-selected") === "true";
const diffPanel = (): HTMLElement | null =>
  document.getElementById("diff-panel");

const A = "a.md (Working Tree)";
const B = "b.md (Working Tree)";
const CHANGED = [
  file("a.md", "unmodified", "modified"),
  file("b.md", "unmodified", "modified"),
];

function textDiff(
  path: string,
  side: "staged" | "unstaged",
  line: string,
): GitDiff {
  return { path, side, outcome: "text", diff: `@@ -1 +1 @@\n${line}\n` };
}

describe("preview tab", () => {
  it("opens with a single click: italic, announced as preview, with the path as description", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await click(shell, "変更", "変更 a.md");
    const tab = diffTab(A);
    expect(isPreview(tab)).toBe(true);
    expect(isSelected(tab)).toBe(true);
    expect(tab.getAttribute("title")).toBe("a.md（プレビュー）");
    expect(tab.textContent).toContain("±");
    expect(shell.uiStateStore.getState().diffTabs).toEqual([
      { path: "a.md", side: "unstaged", preview: true },
    ]);
  });

  it("is replaced by the next single click", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await click(shell, "変更", "変更 a.md");
    await click(shell, "変更", "変更 b.md");
    expect(diffTabs().map((tab) => tab.textContent)).toEqual([`±${B}`]);
    expect(isPreview(diffTab(B))).toBe(true);
  });

  it("is pinned by a double click on the row, so the next preview is a new tab", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    expect(isPreview(diffTab(A))).toBe(false);
    expect(diffTab(A).getAttribute("title")).toBe("a.md");
    await click(shell, "変更", "変更 b.md");
    expect(diffTabs()).toHaveLength(2);
    expect(isPreview(diffTab(B))).toBe(true);
  });

  it("is pinned by a double click on the tab", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await click(shell, "変更", "変更 a.md");
    await shell.user.dblClick(diffTab(A));
    expect(isPreview(diffTab(A))).toBe(false);
    await click(shell, "変更", "変更 b.md");
    expect(diffTabs()).toHaveLength(2);
  });

  it("is pinned by a double click, and activates an existing tab instead of opening another", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    await dblClick(shell, "変更", "変更 b.md");
    expect(isSelected(diffTab(B))).toBe(true);
    await click(shell, "変更", "変更 a.md");
    expect(diffTabs()).toHaveLength(2);
    expect(isSelected(diffTab(A))).toBe(true);
    expect(isPreview(diffTab(A))).toBe(false);
  });
});

describe("tab strip", () => {
  it("shows both sides of a file as separate tabs with the Index / Working Tree titles", async () => {
    const shell = await openChanges(
      {},
      file("both.md", "modified", "modified"),
    );
    await dblClick(shell, "変更", "変更 both.md");
    await click(shell, "ステージされている変更", "変更 both.md");
    expect(diffTabs().map((tab) => tab.textContent?.replace("±", ""))).toEqual([
      "both.md (Working Tree)",
      "both.md (Index)",
    ]);
  });

  it("closes with the button and activates the neighbour, then the Document", async () => {
    const shell = await openChanges({ withDocument: true }, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    await dblClick(shell, "変更", "変更 b.md");
    await shell.user.click(diffTab(A));
    await shell.user.click(
      screen.getByRole("button", { name: `${A}を閉じる` }),
    );
    expect(isSelected(diffTab(B))).toBe(true);
    await shell.user.click(
      screen.getByRole("button", { name: `${B}を閉じる` }),
    );
    expect(diffTabs()).toHaveLength(0);
    expect(isSelected(screen.getByRole("tab", { name: "Document A" }))).toBe(
      true,
    );
    expect(screen.getByRole("tablist", { name: "Sheet Tabs" })).toBeTruthy();
    expect(diffPanel()).toBeNull();
  });

  it("keeps Document tabs in Git mode and shows the diff next to them", async () => {
    const shell = await openChanges({ withDocument: true }, ...CHANGED);
    expect(screen.getByRole("tablist", { name: "Document Tabs" })).toBeTruthy();
    await click(shell, "変更", "変更 a.md");
    const documentTab = screen.getByRole("tab", { name: "Document A" });
    expect(isSelected(documentTab)).toBe(false);
    expect(screen.queryByRole("tablist", { name: "Sheet Tabs" })).toBeNull();
    // Diff tabs come after the Document tabs.
    const ids = screen.getAllByRole("tab").map((tab) => tab.id);
    expect(ids.findIndex((id) => id.startsWith("diff-tab-"))).toBeGreaterThan(
      ids.findIndex((id) => id.startsWith("document-tab-")),
    );
    await shell.user.click(documentTab);
    expect(isSelected(documentTab)).toBe(true);
    expect(diffTabs()).toHaveLength(1);
    expect(screen.getByRole("tablist", { name: "Sheet Tabs" })).toBeTruthy();
  });

  it("keeps all tabs and the active tab when the left panel mode changes", async () => {
    const shell = await openChanges({ withDocument: true }, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    await dblClick(shell, "変更", "変更 b.md");
    await showMode(shell, "Project");
    expect(diffTabs()).toHaveLength(2);
    expect(isSelected(diffTab(B))).toBe(true);
    expect(diffPanel()).not.toBeNull();
    await showMode(shell, "Git");
    expect(isSelected(diffTab(B))).toBe(true);
  });

  it("moves through Document and diff tabs with the arrow keys, but reorders Document tabs only", async () => {
    const shell = await openChanges({ withDocument: true }, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    await shell.user.click(screen.getByRole("tab", { name: "Document A" }));
    await shell.user.keyboard("{ArrowRight}");
    expect(isSelected(diffTab(A))).toBe(true);
    expect(document.activeElement).toBe(diffTab(A));
    await shell.user.keyboard("{ArrowLeft}");
    expect(isSelected(screen.getByRole("tab", { name: "Document A" }))).toBe(
      true,
    );
    await shell.user.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(
      screen
        .getAllByRole("tab")
        .map((tab) => tab.id.split("-")[0])
        .filter((kind) => kind === "document" || kind === "diff"),
    ).toEqual(["document", "diff"]);
    await shell.user.click(diffTab(A));
    await shell.user.keyboard("{Control>}{ArrowLeft}{/Control}");
    expect(diffTabs()).toHaveLength(1);
    expect(document.activeElement).toBe(diffTab(A));
  });
});

describe("selected row", () => {
  it("follows the active diff tab", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    await dblClick(shell, "変更", "変更 b.md");
    const selected = (name: string) =>
      rowOf("変更", name).getAttribute("aria-selected");
    expect(selected("変更 b.md")).toBe("true");
    expect(selected("変更 a.md")).toBe("false");
    await shell.user.click(diffTab(A));
    expect(selected("変更 a.md")).toBe("true");
    expect(selected("変更 b.md")).toBe("false");
  });
});

describe("loading", () => {
  it("shows the loading state, never another file's diff, when a tab is activated", async () => {
    const shell = await openChanges({}, ...CHANGED);
    shell.gitGateway.diffs["unstaged:a.md"] = textDiff(
      "a.md",
      "unstaged",
      "+from A",
    );
    shell.gitGateway.diffs["unstaged:b.md"] = textDiff(
      "b.md",
      "unstaged",
      "+from B",
    );
    await dblClick(shell, "変更", "変更 a.md");
    await dblClick(shell, "変更", "変更 b.md");
    await settled();
    expect(screen.getByText("from B")).toBeTruthy();
    const release = shell.gitGateway.holdNextDiff();
    await shell.user.click(diffTab(A));
    expect(screen.queryByText("from B")).toBeNull();
    expect(screen.queryByText("from A")).toBeNull();
    expect(screen.getByText(GIT_MESSAGES.ja.diffLoading)).toBeTruthy();
    await act(async () => {
      release();
      await settle();
    });
    expect(screen.getByText("from A")).toBeTruthy();
  });
});

describe("after a status change", () => {
  it("retargets every tab: switches a side, merges into an existing tab and closes the rest", async () => {
    const shell = await openChanges(
      {},
      file("a.md", "modified", "modified"),
      file("b.md", "unmodified", "modified"),
      file("c.md", "unmodified", "modified"),
    );
    shell.gitGateway.diffs["staged:a.md"] = textDiff(
      "a.md",
      "staged",
      "+a staged",
    );
    // a: both sides open; b: open; c: open and active.
    await dblClick(shell, "変更", "変更 a.md");
    await dblClick(shell, "ステージされている変更", "変更 a.md");
    await dblClick(shell, "変更", "変更 b.md");
    await dblClick(shell, "変更", "変更 c.md");
    await settled();
    const callsBefore = shell.gitGateway.diffCalls.length;
    // After the stage everything of a is staged, b is gone and c is staged.
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(
        file("a.md", "modified", "unmodified"),
        file("c.md", "modified", "unmodified"),
      ),
    );
    await shell.user.click(
      within(rowOf("変更", "変更 c.md")).getByRole("button", {
        name: GIT_MESSAGES.ja.stage,
      }),
    );
    await settled();
    expect(
      shell.uiStateStore
        .getState()
        .diffTabs.map((tab) => `${tab.path}:${tab.side}`),
    ).toEqual(["a.md:staged", "c.md:staged"]);
    expect(isSelected(diffTab("c.md (Index)"))).toBe(true);
    expect(shell.gitGateway.diffCalls.at(-1)).toMatchObject({
      path: "c.md",
      side: "staged",
    });
    // Only the active tab was reloaded (inactive ones load when activated).
    expect(
      shell.gitGateway.diffCalls
        .slice(callsBefore)
        .map((call) => `${call.path}:${call.side}`),
    ).toEqual(["c.md:staged"]);
  });

  it("closes the active tab to its neighbour, and all tabs when the status is lost", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    await dblClick(shell, "変更", "変更 b.md");
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(file("a.md", "unmodified", "modified")),
    );
    await shell.user.click(
      within(rowOf("変更", "変更 b.md")).getByRole("button", {
        name: GIT_MESSAGES.ja.stage,
      }),
    );
    await settled();
    expect(diffTabs()).toHaveLength(1);
    expect(isSelected(diffTab(A))).toBe(true);
  });
});

describe("Project change", () => {
  it("clears the diff tabs and shows the Document state again", async () => {
    const shell = await openChanges({}, ...CHANGED);
    await dblClick(shell, "変更", "変更 a.md");
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(shell.uiStateStore.getState().diffTabs).toEqual([]);
    expect(shell.uiStateStore.getState().activeMainTab).toEqual({
      kind: "document",
    });
    expect(screen.queryAllByRole("tab", { name: A })).toHaveLength(0);
  });
});

describe("English", () => {
  it("uses the same titles and an English preview description", async () => {
    const shell = await openChanges(
      { language: "en-US" },
      ...CHANGED,
      file("s.md", "modified", "unmodified"),
    );
    await shell.user.click(
      rowOf("Changes", "Modified a.md").querySelector(
        ".git-file-row__name",
      ) as HTMLElement,
    );
    const tab = screen.getByRole("tab", { name: A });
    expect(tab.getAttribute("title")).toBe("a.md (Preview)");
    await shell.user.click(
      rowOf("Staged Changes", "Modified s.md").querySelector(
        ".git-file-row__name",
      ) as HTMLElement,
    );
    expect(screen.getByRole("tab", { name: "s.md (Index)" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close s.md (Index)" }),
    ).toBeTruthy();
  });
});
