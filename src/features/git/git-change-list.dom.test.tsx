// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import { settle } from "../../application/test-support/fakes";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { GIT_MESSAGES } from "./git-messages";
import {
  hasHeader,
  headerOf,
  rowCountOf,
  rowOf,
  rowsOf,
  sectionTitles,
} from "./test-support/git-tree-queries";

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

const buttonIn = (element: HTMLElement, name: string) =>
  within(element).getByRole("button", { name }) as HTMLButtonElement;
const sectionOf = headerOf;

const STAGE_BUTTON_TEXTS: readonly string[] = [
  GIT_MESSAGES.ja.stage,
  GIT_MESSAGES.ja.unstage,
  GIT_MESSAGES.ja.stageAll,
  GIT_MESSAGES.ja.unstageAll,
];

const MIXED = [
  file("a.md", "modified", "unmodified"),
  file("b.md", "modified", "modified"),
  file("c.md", "unmodified", "modified"),
  file("d.md", "untracked", "untracked"),
  file("x.md", "unmerged", "unmerged"),
];

async function settled(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

describe("change list display", () => {
  it("shows the sections in order, with a partly staged file in two of them", async () => {
    await openChanges(...MIXED);
    expect(sectionTitles()).toEqual([
      "マージの変更",
      "ステージされている変更",
      "変更",
    ]);
    expect(rowCountOf("ステージされている変更")).toBe(2);
    expect(rowOf("ステージされている変更", "変更 a.md")).toBeTruthy();
    expect(rowOf("ステージされている変更", "変更 b.md")).toBeTruthy();
    expect(rowOf("変更", "変更 b.md")).toBeTruthy();
    expect(rowOf("変更", "変更 c.md")).toBeTruthy();
    // Untracked files are listed in Changes, sorted with the others by path.
    expect(rowsOf("変更").map((row) => row.getAttribute("aria-label"))).toEqual(
      ["変更 b.md", "変更 c.md", "未追跡 d.md"],
    );
    expect(rowOf("マージの変更", "競合 x.md")).toBeTruthy();
  });

  it("shows a count badge per section with a readable label", async () => {
    await openChanges(...MIXED);
    expect(
      screen.getByRole("treeitem", { name: "マージの変更 1 件" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: "ステージされている変更 2 件" }),
    ).toBeTruthy();
    const changes = screen.getByRole("treeitem", { name: "変更 3 件" });
    expect(changes.getAttribute("aria-level")).toBe("1");
    expect(changes.getAttribute("aria-expanded")).toBe("true");
    expect(changes.textContent).toContain("3");
  });

  it("shows the name with the dimmed directory, and the letter at the end", async () => {
    await openChanges(
      file("docs/sub/a.md", "unmodified", "modified"),
      file("root.md", "unmodified", "deleted"),
    );
    const nested = rowOf("変更", "変更 docs/sub/a.md");
    expect(nested.querySelector(".git-file-row__name")?.textContent).toBe(
      "a.md",
    );
    expect(nested.querySelector(".git-file-row__directory")?.textContent).toBe(
      "docs/sub",
    );
    expect(nested.getAttribute("title")).toBe("docs/sub/a.md");
    const root = rowOf("変更", "削除 root.md");
    expect(root.querySelector(".git-file-row__directory")).toBeNull();
    expect(root.classList.contains("git-file-row--deleted")).toBe(true);
    expect(nested.classList.contains("git-file-row--deleted")).toBe(false);
    expect(root.lastElementChild?.textContent).toBe("D");
  });

  it("shows the status letter as text with a Japanese label", async () => {
    await openChanges(
      file("added.md", "added", "unmodified"),
      file("gone.md", "deleted", "unmodified"),
      file("copy.md", "copied", "unmodified", "orig.md"),
      file("kind.md", "typeChanged", "unmodified"),
    );
    const letter = (name: string) =>
      within(rowOf("ステージされている変更", name)).getByRole("img");
    expect(letter("追加 added.md").textContent).toBe("A");
    expect(letter("削除 gone.md").textContent).toBe("D");
    expect(letter("コピー orig.md → copy.md").textContent).toBe("C");
    expect(letter("種類の変更 kind.md").textContent).toBe("T");
  });

  it("shows a staged rename as old → new", async () => {
    await openChanges(file("new.md", "renamed", "unmodified", "old.md"));
    const row = rowOf("ステージされている変更", "名前変更 old.md → new.md");
    expect(row.textContent).toContain("R");
    expect(row.querySelector(".git-file-row__name")?.textContent).toBe(
      "new.md",
    );
    expect(row.getAttribute("title")).toBe("old.md → new.md");
  });

  it("omits empty sections and says so when there is nothing", async () => {
    await openChanges(file("c.md", "unmodified", "modified"));
    expect(sectionTitles()).toEqual(["変更"]);
    expect(hasHeader("ステージされている変更")).toBe(false);
    expect(screen.queryByText(GIT_MESSAGES.ja.noChanges)).toBeNull();
    cleanup();
    await openChanges();
    expect(screen.getByText("変更はありません")).toBeTruthy();
    expect(screen.queryByRole("tree")).toBeNull();
    expect(
      screen.queryByRole("button", { name: GIT_MESSAGES.ja.stageAll }),
    ).toBeNull();
  });

  it("renders an HTML-looking path as text", async () => {
    const path = "<img src=x onerror=alert(1)>.md";
    await openChanges(file(path, "unmodified", "modified"));
    const row = rowOf("変更", `変更 ${path}`);
    expect(row.textContent).toContain(path);
    expect(row.querySelector("img")).toBeNull();
  });

  it("shows conflicts without buttons and with the note", async () => {
    await openChanges(file("x.md", "unmerged", "unmerged"));
    const row = rowOf("マージの変更", "競合 x.md");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(sectionOf("マージの変更")).queryByRole("button")).toBeNull();
    expect(within(row).getByText(GIT_MESSAGES.ja.conflictNote)).toBeTruthy();
    expect(row.hasAttribute("aria-selected")).toBe(false);
  });
});

describe("stage and unstage", () => {
  it("stages one changes row with that path and shows the returned status", async () => {
    const shell = await openChanges(...MIXED);
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(
        file("a.md", "modified", "unmodified"),
        file("b.md", "modified", "modified"),
        file("c.md", "modified", "unmodified"),
        file("d.md", "untracked", "untracked"),
      ),
    );
    await shell.user.click(
      buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage),
    );
    await waitFor(() => expect(rowCountOf("ステージされている変更")).toBe(3));
    expect(shell.gitGateway.stageCalls.map((call) => call.paths)).toEqual([
      ["c.md"],
    ]);
    // b.md (still partly changed) and the untracked d.md remain.
    expect(rowCountOf("変更")).toBe(2);
  });

  it("stages an untracked row", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      buttonIn(rowOf("変更", "未追跡 d.md"), GIT_MESSAGES.ja.stage),
    );
    expect(shell.gitGateway.stageCalls.map((call) => call.paths)).toEqual([
      ["d.md"],
    ]);
  });

  it("unstages a staged row, and a rename by its new path", async () => {
    const shell = await openChanges(
      file("a.md", "modified", "unmodified"),
      file("new.md", "renamed", "unmodified", "old.md"),
    );
    await shell.user.click(
      buttonIn(
        rowOf("ステージされている変更", "変更 a.md"),
        GIT_MESSAGES.ja.unstage,
      ),
    );
    await settled();
    await shell.user.click(
      buttonIn(
        rowOf("ステージされている変更", "名前変更 old.md → new.md"),
        GIT_MESSAGES.ja.unstage,
      ),
    );
    expect(shell.gitGateway.unstageCalls.map((call) => call.paths)).toEqual([
      ["a.md"],
      ["new.md"],
    ]);
  });

  it("stages modified and untracked files of Changes in one call, conflicts excluded", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      buttonIn(sectionOf("変更"), GIT_MESSAGES.ja.stageAll),
    );
    expect(shell.gitGateway.stageCalls.map((call) => call.paths)).toEqual([
      ["b.md", "c.md", "d.md"],
    ]);
  });

  it("unstages all staged files in one call", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      buttonIn(sectionOf("ステージされている変更"), GIT_MESSAGES.ja.unstageAll),
    );
    expect(shell.gitGateway.unstageCalls.map((call) => call.paths)).toEqual([
      ["a.md", "b.md"],
    ]);
    expect(shell.gitGateway.stageCalls).toHaveLength(0);
  });

  it("disables every stage button and shows 処理中 while one runs", async () => {
    const shell = await openChanges(...MIXED);
    const release = shell.gitGateway.holdNextStage();
    await shell.user.click(
      buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage),
    );
    expect(
      screen.getByText(GIT_MESSAGES.ja.operating).getAttribute("role"),
    ).toBe("status");
    const buttons = screen
      .getAllByRole("button")
      .filter((button) =>
        STAGE_BUTTON_TEXTS.includes(button.getAttribute("aria-label") ?? ""),
      );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    await shell.user.click(buttons[0] as HTMLElement);
    expect(shell.gitGateway.stageCalls).toHaveLength(1);
    expect(shell.gitGateway.unstageCalls).toHaveLength(0);
    await act(async () => {
      release();
      await settle();
    });
    expect(screen.queryByText(GIT_MESSAGES.ja.operating)).toBeNull();
    expect(
      buttonIn(rowOf("変更", "変更 b.md"), GIT_MESSAGES.ja.stage).disabled,
    ).toBe(false);
  });

  it("shows the re-read status after a failure, not a fake success", async () => {
    const shell = await openChanges(...MIXED);
    shell.gitGateway.nextStageResult = operationErr("gitCommandFailed", "no");
    await shell.user.click(
      buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage),
    );
    await settled();
    expect(shell.gitGateway.stageCalls).toHaveLength(1);
    // The failed call is followed by one status read, which returns the unchanged status.
    expect(rowOf("変更", "変更 c.md")).toBeTruthy();
    expect(rowCountOf("ステージされている変更")).toBe(2);
    expect(screen.queryByText(GIT_MESSAGES.ja.operating)).toBeNull();
  });

  it("does not apply a stale result after the Project changed", async () => {
    const shell = await openChanges(...MIXED);
    const release = shell.gitGateway.holdNextStage();
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(file("stale.md", "added", "unmodified")),
    );
    await shell.user.click(
      buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage),
    );
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(screen.getByText(GIT_MESSAGES.ja.noProject)).toBeTruthy();
    await act(async () => {
      release();
      await settle();
    });
    expect(screen.queryByText("stale.md")).toBeNull();
    expect(shell.gitController.store.getState().status).toBeNull();
  });
});

describe("selection", () => {
  it("selects a row by click and by Enter, with the side of its section", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      within(rowOf("変更", "変更 c.md")).getByText("c.md"),
    );
    expect(rowOf("変更", "変更 c.md").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(shell.uiStateStore.getState().gitSelection).toEqual({
      path: "c.md",
      side: "unstaged",
    });
    // The same file in the other section is another row.
    expect(
      rowOf("ステージされている変更", "変更 b.md").getAttribute(
        "aria-selected",
      ),
    ).toBe("false");

    rowOf("ステージされている変更", "変更 a.md").focus();
    await shell.user.keyboard("{Enter}");
    expect(
      rowOf("ステージされている変更", "変更 a.md").getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(rowOf("変更", "変更 c.md").getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(shell.uiStateStore.getState().gitSelection).toEqual({
      path: "a.md",
      side: "staged",
    });
  });

  it("does not select a conflict row", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      within(rowOf("マージの変更", "競合 x.md")).getByText("x.md"),
    );
    expect(shell.uiStateStore.getState().gitSelection).toBeNull();
  });

  it("drops the selection when the Project changes", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      within(rowOf("変更", "変更 c.md")).getByText("c.md"),
    );
    expect(shell.uiStateStore.getState().gitSelection).not.toBeNull();
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(shell.uiStateStore.getState().gitSelection).toBeNull();
    expect(shell.uiStateStore.getState().leftPanelMode).toBe("git");
  });
});

describe("keyboard and focus", () => {
  it("has one tab stop among the rows and moves with the arrow keys, Home and End", async () => {
    const shell = await openChanges(...MIXED);
    const rows = screen.getAllByRole("treeitem");
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(rows[0]?.tabIndex).toBe(0);

    rows[0]?.focus();
    await shell.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1]?.tabIndex).toBe(0);
    expect(rows[0]?.tabIndex).toBe(-1);
    await shell.user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(rows[3]);
    await shell.user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rows[2]);
    await shell.user.keyboard("{End}");
    expect(document.activeElement).toBe(rows.at(-1));
    await shell.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows.at(-1));
    await shell.user.keyboard("{Home}");
    expect(document.activeElement).toBe(rows[0]);
    await shell.user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("reaches the row's button with Tab", async () => {
    const shell = await openChanges(...MIXED);
    rowOf("ステージされている変更", "変更 a.md").focus();
    await shell.user.tab();
    expect(document.activeElement).toBe(
      buttonIn(
        rowOf("ステージされている変更", "変更 a.md"),
        GIT_MESSAGES.ja.unstage,
      ),
    );
  });

  it("returns the focus to the next row of the section when the row left", async () => {
    const shell = await openChanges(
      file("a.md", "modified", "unmodified"),
      file("b.md", "modified", "unmodified"),
      file("c.md", "unmodified", "modified"),
    );
    shell.gitGateway.nextUnstageResult = operationOk(
      statusOf(
        file("a.md", "unmodified", "modified"),
        file("b.md", "modified", "unmodified"),
        file("c.md", "unmodified", "modified"),
      ),
    );
    await shell.user.click(
      buttonIn(
        rowOf("ステージされている変更", "変更 a.md"),
        GIT_MESSAGES.ja.unstage,
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        rowOf("ステージされている変更", "変更 b.md"),
      ),
    );
  });

  it("keeps the focus on the same row when it stays in its section (a failed call)", async () => {
    const shell = await openChanges(...MIXED);
    shell.gitGateway.nextStageResult = operationErr("gitCommandFailed", "no");
    await shell.user.click(
      buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(rowOf("変更", "変更 c.md")),
    );
  });

  it("moves to the first row of the next section when its section disappears", async () => {
    const shell = await openChanges(
      file("a.md", "modified", "unmodified"),
      file("d.md", "untracked", "untracked"),
    );
    shell.gitGateway.nextUnstageResult = operationOk(
      statusOf(
        file("a.md", "unmodified", "modified"),
        file("d.md", "untracked", "untracked"),
      ),
    );
    await shell.user.click(
      buttonIn(
        rowOf("ステージされている変更", "変更 a.md"),
        GIT_MESSAGES.ja.unstage,
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(rowOf("変更", "変更 a.md")),
    );
  });

  it("falls back to the previous row, then to the heading", async () => {
    const shell = await openChanges(
      file("a.md", "modified", "unmodified"),
      file("c.md", "unmodified", "modified"),
    );
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(
        file("a.md", "modified", "unmodified"),
        file("c.md", "modified", "unmodified"),
      ),
    );
    await shell.user.click(
      buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        rowOf("ステージされている変更", "変更 c.md"),
      ),
    );

    shell.gitGateway.nextUnstageResult = operationOk(statusOf());
    await shell.user.click(
      buttonIn(sectionOf("ステージされている変更"), GIT_MESSAGES.ja.unstageAll),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: GIT_MESSAGES.ja.changeListLabel }),
      ),
    );
  });
});

describe("tree structure", () => {
  it("is one tree of level 1 headers and level 2 files", async () => {
    await openChanges(...MIXED);
    const tree = screen.getByRole("tree", {
      name: GIT_MESSAGES.ja.changeListLabel,
    });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((item) => item.getAttribute("aria-level"))).toEqual([
      "1",
      "2",
      "1",
      "2",
      "2",
      "1",
      "2",
      "2",
      "2",
    ]);
    expect(rowOf("変更", "変更 c.md").getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(headerOf("変更").hasAttribute("aria-selected")).toBe(false);
  });
});

describe("collapsing sections", () => {
  it("collapses and expands a section by click, hiding its files", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(headerOf("変更"));
    expect(headerOf("変更").getAttribute("aria-expanded")).toBe("false");
    expect(rowCountOf("変更")).toBe(0);
    expect(rowCountOf("ステージされている変更")).toBe(2);
    expect(
      shell.uiStateStore.getState().gitCollapsedSections.has("changes"),
    ).toBe(true);
    await shell.user.click(headerOf("変更"));
    expect(headerOf("変更").getAttribute("aria-expanded")).toBe("true");
    expect(rowCountOf("変更")).toBe(3);
  });

  it("toggles with Enter and Space, and with the arrow keys", async () => {
    const shell = await openChanges(...MIXED);
    headerOf("ステージされている変更").focus();
    await shell.user.keyboard("{Enter}");
    expect(rowCountOf("ステージされている変更")).toBe(0);
    await shell.user.keyboard(" ");
    expect(rowCountOf("ステージされている変更")).toBe(2);
    await shell.user.keyboard("{ArrowLeft}");
    expect(
      headerOf("ステージされている変更").getAttribute("aria-expanded"),
    ).toBe("false");
    // ArrowLeft on a collapsed header does nothing more.
    await shell.user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(headerOf("ステージされている変更"));
    await shell.user.keyboard("{ArrowRight}");
    expect(
      headerOf("ステージされている変更").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.activeElement).toBe(headerOf("ステージされている変更"));
    await shell.user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      rowOf("ステージされている変更", "変更 a.md"),
    );
  });

  it("keeps the collapsed state across panel switches and drops it when the Project closes", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(headerOf("変更"));
    const tablist = screen.getByRole("tablist", {
      name: "左パネルの表示切り替え",
    });
    await shell.user.click(
      within(tablist).getByRole("tab", { name: "Project" }),
    );
    await shell.user.click(within(tablist).getByRole("tab", { name: "Git" }));
    await screen.findByRole("tree");
    expect(headerOf("変更").getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(shell.uiStateStore.getState().gitCollapsedSections.size).toBe(0);
  });

  it("reaches a collapsed section's header after Stage All empties the focus target", async () => {
    const shell = await openChanges(
      file("a.md", "modified", "unmodified"),
      file("c.md", "unmodified", "modified"),
    );
    await shell.user.click(headerOf("変更"));
    shell.gitGateway.nextUnstageResult = operationOk(
      statusOf(file("c.md", "unmodified", "modified")),
    );
    await shell.user.click(
      buttonIn(headerOf("ステージされている変更"), GIT_MESSAGES.ja.unstageAll),
    );
    await waitFor(() => expect(document.activeElement).toBe(headerOf("変更")));
  });
});

describe("tree keyboard navigation", () => {
  it("moves across headers and files, and ArrowLeft on a file goes to its header", async () => {
    const shell = await openChanges(...MIXED);
    const items = screen.getAllByRole("treeitem");
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    items[0]?.focus();
    await shell.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await shell.user.keyboard("{End}");
    expect(document.activeElement).toBe(items.at(-1));
    await shell.user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(headerOf("変更"));
    await shell.user.keyboard("{Home}");
    expect(document.activeElement).toBe(items[0]);
  });

  it("opens the diff of a file with Enter and Space, not of a header", async () => {
    const shell = await openChanges(...MIXED);
    rowOf("変更", "変更 c.md").focus();
    await shell.user.keyboard(" ");
    expect(shell.uiStateStore.getState().gitSelection).toEqual({
      path: "c.md",
      side: "unstaged",
    });
    headerOf("変更").focus();
    await shell.user.keyboard("{Enter}");
    expect(shell.uiStateStore.getState().gitSelection).toEqual({
      path: "c.md",
      side: "unstaged",
    });
  });
});

describe("inline actions", () => {
  it("offers stage on Changes rows, unstage on Staged rows and nothing on conflicts, with tooltips", async () => {
    await openChanges(...MIXED);
    const stage = buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage);
    expect(stage.title).toBe("変更をステージ");
    const unstage = buttonIn(
      rowOf("ステージされている変更", "変更 a.md"),
      GIT_MESSAGES.ja.unstage,
    );
    expect(unstage.title).toBe("変更のステージング解除");
    expect(
      within(rowOf("ステージされている変更", "変更 a.md")).queryByRole(
        "button",
        {
          name: GIT_MESSAGES.ja.stage,
        },
      ),
    ).toBeNull();
    expect(buttonIn(headerOf("変更"), "すべての変更をステージ").title).toBe(
      "すべての変更をステージ",
    );
    expect(
      buttonIn(
        headerOf("ステージされている変更"),
        "すべての変更のステージング解除",
      ).title,
    ).toBe("すべての変更のステージング解除");
  });

  it("is operable from the keyboard: Tab to the row's button, then Enter", async () => {
    const shell = await openChanges(...MIXED);
    rowOf("変更", "変更 c.md").focus();
    await shell.user.tab();
    expect(document.activeElement).toBe(
      buttonIn(rowOf("変更", "変更 c.md"), GIT_MESSAGES.ja.stage),
    );
    await shell.user.keyboard("{Enter}");
    expect(shell.gitGateway.stageCalls.map((call) => call.paths)).toEqual([
      ["c.md"],
    ]);
  });

  it("makes a header's button reachable with Tab and operable", async () => {
    const shell = await openChanges(...MIXED);
    headerOf("ステージされている変更").focus();
    await shell.user.tab();
    expect(document.activeElement).toBe(
      buttonIn(headerOf("ステージされている変更"), GIT_MESSAGES.ja.unstageAll),
    );
    await shell.user.keyboard("{Enter}");
    expect(shell.gitGateway.unstageCalls.map((call) => call.paths)).toEqual([
      ["a.md", "b.md"],
    ]);
  });
});
