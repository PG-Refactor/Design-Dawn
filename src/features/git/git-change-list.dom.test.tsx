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
  return { repositoryState: "ready", files };
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

const listOf = (title: string) => screen.getByRole("listbox", { name: title });
const rowOf = (title: string, name: string) =>
  within(listOf(title)).getByRole("option", { name });
const rowCountOf = (title: string) =>
  within(listOf(title)).queryAllByRole("option").length;
const buttonIn = (element: HTMLElement, name: string) =>
  within(element).getByRole("button", { name }) as HTMLButtonElement;
const sectionOf = (title: string) =>
  screen.getByRole("region", { name: title });

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
    const titles = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(["ステージ済み", "変更", "未追跡", "競合"]);
    expect(rowCountOf("ステージ済み")).toBe(2);
    expect(rowOf("ステージ済み", "変更 a.md")).toBeTruthy();
    expect(rowOf("ステージ済み", "変更 b.md")).toBeTruthy();
    expect(rowOf("変更", "変更 b.md")).toBeTruthy();
    expect(rowOf("変更", "変更 c.md")).toBeTruthy();
    expect(rowOf("未追跡", "未追跡 d.md")).toBeTruthy();
    expect(rowOf("競合", "競合 x.md")).toBeTruthy();
  });

  it("shows the status letter as text with a Japanese label", async () => {
    await openChanges(
      file("added.md", "added", "unmodified"),
      file("gone.md", "deleted", "unmodified"),
      file("copy.md", "copied", "unmodified", "orig.md"),
      file("kind.md", "typeChanged", "unmodified"),
    );
    const letter = (name: string) =>
      within(rowOf("ステージ済み", name)).getByRole("img");
    expect(letter("追加 added.md").textContent).toBe("A");
    expect(letter("削除 gone.md").textContent).toBe("D");
    expect(letter("コピー orig.md → copy.md").textContent).toBe("C");
    expect(letter("種類の変更 kind.md").textContent).toBe("T");
  });

  it("shows a staged rename as old → new", async () => {
    await openChanges(file("new.md", "renamed", "unmodified", "old.md"));
    const row = rowOf("ステージ済み", "名前変更 old.md → new.md");
    expect(row.textContent).toContain("R");
    expect(row.textContent).toContain("old.md → new.md");
  });

  it("omits empty sections and says so when there is nothing", async () => {
    await openChanges(file("c.md", "unmodified", "modified"));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.queryByText(GIT_MESSAGES.ja.noChanges)).toBeNull();
    cleanup();
    await openChanges();
    expect(screen.getByText("変更はありません")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "すべてステージ" })).toBeNull();
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
    const row = rowOf("競合", "競合 x.md");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(sectionOf("競合")).queryByRole("button")).toBeNull();
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
    await waitFor(() => expect(rowCountOf("ステージ済み")).toBe(3));
    expect(shell.gitGateway.stageCalls.map((call) => call.paths)).toEqual([
      ["c.md"],
    ]);
    expect(rowCountOf("変更")).toBe(1);
  });

  it("stages an untracked row", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      buttonIn(rowOf("未追跡", "未追跡 d.md"), GIT_MESSAGES.ja.stage),
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
      buttonIn(rowOf("ステージ済み", "変更 a.md"), GIT_MESSAGES.ja.unstage),
    );
    await settled();
    await shell.user.click(
      buttonIn(
        rowOf("ステージ済み", "名前変更 old.md → new.md"),
        GIT_MESSAGES.ja.unstage,
      ),
    );
    expect(shell.gitGateway.unstageCalls.map((call) => call.paths)).toEqual([
      ["a.md"],
      ["new.md"],
    ]);
  });

  it("stages all of changes and untracked in one call each, conflicts excluded", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      buttonIn(sectionOf("変更"), GIT_MESSAGES.ja.stageAll),
    );
    await settled();
    await shell.user.click(
      buttonIn(sectionOf("未追跡"), GIT_MESSAGES.ja.stageAll),
    );
    expect(shell.gitGateway.stageCalls.map((call) => call.paths)).toEqual([
      ["b.md", "c.md"],
      ["d.md"],
    ]);
  });

  it("unstages all staged files in one call", async () => {
    const shell = await openChanges(...MIXED);
    await shell.user.click(
      buttonIn(sectionOf("ステージ済み"), GIT_MESSAGES.ja.unstageAll),
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
        STAGE_BUTTON_TEXTS.includes(button.textContent ?? ""),
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
    expect(rowCountOf("ステージ済み")).toBe(2);
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
      rowOf("ステージ済み", "変更 b.md").getAttribute("aria-selected"),
    ).toBe("false");

    rowOf("ステージ済み", "変更 a.md").focus();
    await shell.user.keyboard("{Enter}");
    expect(
      rowOf("ステージ済み", "変更 a.md").getAttribute("aria-selected"),
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
      within(rowOf("競合", "競合 x.md")).getByText("x.md"),
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
    const rows = screen.getAllByRole("option");
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
    screen.getAllByRole("option")[0]?.focus();
    await shell.user.tab();
    expect(document.activeElement).toBe(
      buttonIn(rowOf("ステージ済み", "変更 a.md"), GIT_MESSAGES.ja.unstage),
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
      buttonIn(rowOf("ステージ済み", "変更 a.md"), GIT_MESSAGES.ja.unstage),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(rowOf("ステージ済み", "変更 b.md")),
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
      file("a.md", "unmodified", "modified"),
      file("d.md", "untracked", "untracked"),
    );
    shell.gitGateway.nextStageResult = operationOk(
      statusOf(
        file("a.md", "modified", "unmodified"),
        file("d.md", "untracked", "untracked"),
      ),
    );
    await shell.user.click(
      buttonIn(rowOf("変更", "変更 a.md"), GIT_MESSAGES.ja.stage),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(rowOf("未追跡", "未追跡 d.md")),
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
      expect(document.activeElement).toBe(rowOf("ステージ済み", "変更 c.md")),
    );

    shell.gitGateway.nextUnstageResult = operationOk(statusOf());
    await shell.user.click(
      buttonIn(sectionOf("ステージ済み"), GIT_MESSAGES.ja.unstageAll),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: GIT_MESSAGES.ja.changeListLabel }),
      ),
    );
  });
});
