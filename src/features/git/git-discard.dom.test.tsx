// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { GIT_MESSAGES } from "./git-messages";
import { headerOf, rowOf } from "./test-support/git-tree-queries";

afterEach(cleanup);

const JA = GIT_MESSAGES.ja;
const EN = GIT_MESSAGES.en;

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

async function openChanges(
  files: GitFileStatus[],
  systemLanguages?: readonly string[],
): Promise<ShellHarness> {
  const shell = await renderShell({ systemLanguages });
  shell.gitGateway.status = statusOf(...files);
  await shell.openProjectInUi();
  const english = systemLanguages?.[0] === "en";
  await shell.user.click(screen.getByRole("tab", { name: "Git" }));
  await screen.findByRole("heading", {
    name: (english ? EN : JA).changeListLabel,
  });
  return shell;
}

const MIXED = [
  file("a.md", "modified", "unmodified"),
  file("b.md", "unmodified", "modified"),
  file("d.md", "untracked", "untracked"),
  file("x.md", "unmerged", "unmerged"),
];

async function flush(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

describe("discard buttons", () => {
  it("are on Changes rows and the Changes header only", async () => {
    await openChanges(MIXED);
    const names = [JA.discard, JA.discardAll];
    const hasDiscard = (element: HTMLElement) =>
      within(element).queryAllByRole("button", {
        name: (name) => names.includes(name),
      }).length;
    expect(hasDiscard(headerOf("変更"))).toBe(1);
    expect(hasDiscard(rowOf("変更", "変更 b.md"))).toBe(1);
    expect(hasDiscard(rowOf("変更", "未追跡 d.md"))).toBe(1);
    expect(hasDiscard(headerOf("ステージされている変更"))).toBe(0);
    expect(hasDiscard(rowOf("ステージされている変更", "変更 a.md"))).toBe(0);
    expect(hasDiscard(headerOf("マージの変更"))).toBe(0);
    expect(hasDiscard(rowOf("マージの変更", "競合 x.md"))).toBe(0);
  });

  it("are reached with Tab from the focused row", async () => {
    const shell = await openChanges(MIXED);
    const row = rowOf("変更", "変更 b.md");
    row.focus();
    await shell.user.tab();
    expect(document.activeElement).toBe(
      within(row).getByRole("button", { name: JA.discard }),
    );
    await shell.user.tab();
    expect(document.activeElement).toBe(
      within(row).getByRole("button", { name: JA.stage }),
    );
  });

  it("are disabled while git works and while the workspace is busy", async () => {
    const shell = await openChanges(MIXED);
    const button = () =>
      within(rowOf("変更", "変更 b.md")).getByRole("button", {
        name: JA.discard,
      }) as HTMLButtonElement;
    expect(button().disabled).toBe(false);
    const release = shell.gitGateway.holdNextStage();
    await shell.user.click(
      within(rowOf("変更", "変更 b.md")).getByRole("button", {
        name: JA.stage,
      }),
    );
    expect(button().disabled).toBe(true);
    release();
    await flush();
    act(() => {
      shell.uiStateStore.setState((state) => ({ ...state, busy: true }));
    });
    expect(button().disabled).toBe(true);
    expect(
      (
        within(headerOf("変更")).getByRole("button", {
          name: JA.discardAll,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

async function askFor(
  shell: ShellHarness,
  rowName: string,
  language: typeof JA | typeof EN = JA,
): Promise<HTMLElement> {
  await shell.user.click(
    within(rowOf(language.sectionTitles.changes, rowName)).getByRole("button", {
      name: language.discard,
    }),
  );
  return screen.findByRole("dialog");
}

describe("the question", () => {
  it("asks about one tracked file in Japanese, with Cancel focused", async () => {
    const shell = await openChanges(MIXED);
    const dialog = await askFor(shell, "変更 b.md");
    expect(
      within(dialog).getByText("'b.md' の変更を破棄しますか?"),
    ).toBeTruthy();
    expect(within(dialog).getByText("この操作は元に戻せません。")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "変更を破棄" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
  });

  it("asks about one untracked file as a deletion", async () => {
    const shell = await openChanges(MIXED);
    const dialog = await askFor(shell, "未追跡 d.md");
    expect(within(dialog).getByText("'d.md' を削除しますか?")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "ファイルを削除" }),
    ).toBeTruthy();
  });

  it("asks about several files and counts the untracked ones", async () => {
    const shell = await openChanges(MIXED);
    await shell.user.click(
      within(headerOf("変更")).getByRole("button", { name: JA.discardAll }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("2 個のファイルの変更を破棄しますか?"),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("うち 1 個の未追跡のファイルは削除されます。"),
    ).toBeTruthy();
  });

  it("lists the open Documents and mentions the Project files", async () => {
    const shell = await openChanges(MIXED);
    await shell.actions.openDocument(DOCUMENT_A);
    shell.gitGateway.impactResult = {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: true,
    };
    const dialog = await askFor(shell, "変更 b.md");
    expect(
      within(dialog).getByText(
        "次の Document は保存せずに閉じ、元に戻した後に開き直します。Undo の履歴は消えます。",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("Document A")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Project の構成ファイルが含まれるため、Project を開き直します。ほかの未保存の変更は先に保存されます。",
      ),
    ).toBeTruthy();
  });

  it("is in English with an English display language", async () => {
    const shell = await openChanges(MIXED, ["en"]);
    let dialog = await askFor(shell, "Modified b.md", EN);
    expect(
      within(dialog).getByText(
        "Are you sure you want to discard changes in 'b.md'?",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("This action is irreversible!"),
    ).toBeTruthy();
    await shell.user.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    dialog = await askFor(shell, "Untracked d.md", EN);
    expect(
      within(dialog).getByText("Are you sure you want to DELETE 'd.md'?"),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Delete File" }),
    ).toBeTruthy();
    await shell.user.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await shell.user.click(
      within(headerOf("Changes")).getByRole("button", { name: EN.discardAll }),
    );
    dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Are you sure you want to discard changes in 2 files?",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("1 untracked file will be DELETED."),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Discard Changes" }),
    ).toBeTruthy();
  });

  it("is cancelled by the button and by Escape, without a discard", async () => {
    const shell = await openChanges(MIXED);
    let dialog = await askFor(shell, "変更 b.md");
    await shell.user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = await askFor(shell, "変更 b.md");
    await shell.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.gitGateway.discardCalls).toEqual([]);
  });

  it("discards the file when confirmed", async () => {
    const shell = await openChanges(MIXED);
    const dialog = await askFor(shell, "変更 b.md");
    shell.gitGateway.status = statusOf(file("a.md", "modified", "unmodified"));
    await shell.user.click(
      within(dialog).getByRole("button", { name: "変更を破棄" }),
    );
    await flush();
    expect(shell.gitGateway.discardCalls.map((call) => call.paths)).toEqual([
      ["b.md"],
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
