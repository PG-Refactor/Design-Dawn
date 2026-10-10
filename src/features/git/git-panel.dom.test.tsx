// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseViewport } from "../../application/local-state/viewport";
import type { GitRepositoryState } from "../../application/ports/git-gateway";
import { CLEAN_GIT_STATUS } from "../../application/test-support/fake-git";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { setViewport } from "../workspace/ui-state/ui-state";
import { GIT_MESSAGES } from "./git-messages";

afterEach(cleanup);

const modeTab = (name: string) =>
  within(
    screen.getByRole("tablist", { name: "左パネルの表示切り替え" }),
  ).getByRole("tab", { name });

async function showGit(shell: ShellHarness): Promise<void> {
  await shell.user.click(modeTab("Git"));
}

async function openProjectWithState(
  shell: ShellHarness,
  repositoryState: GitRepositoryState,
): Promise<void> {
  shell.gitGateway.status = { repositoryState, branch: null, files: [] };
  await shell.openProjectInUi();
  await showGit(shell);
}

describe("Project | Git switch", () => {
  it("shows the Project Tree by default and the Git panel after choosing Git", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    expect(modeTab("Project").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tree", { name: "Project Tree" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Git" })).toBeNull();

    await showGit(shell);
    expect(modeTab("Git").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByRole("region", { name: "Git" })).toBeTruthy();
    const panel = screen.getByRole("tabpanel", { name: "Git" });
    expect(modeTab("Git").getAttribute("aria-controls")).toBe(panel.id);
  });

  it("keeps the Document tabs and canvas in Git mode and keeps the same state", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    await shell.user.click(
      within(screen.getByRole("treeitem", { name: "Document A" })).getByText(
        "Document A",
      ),
    );
    await screen.findByRole("tablist", { name: "Document Tabs" });
    const parsed = parseViewport({ panX: 12, panY: 34, zoom: 1.5 });
    if (!parsed.ok) throw new Error("viewport");
    shell.uiStateStore.setState((ui) =>
      setViewport(ui, SHEET_A1, parsed.value),
    );
    const before = shell.uiStateStore.getState();

    await showGit(shell);
    expect(screen.getByRole("tablist", { name: "Document Tabs" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Sheet Tabs" })).toBeTruthy();

    await shell.user.click(modeTab("Project"));
    expect(screen.getByRole("tablist", { name: "Document Tabs" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Sheet Tabs" })).toBeTruthy();
    const after = shell.uiStateStore.getState();
    expect(after.activeDocumentId).toBe(DOCUMENT_A);
    expect(after.activeSheetIdByDocument).toBe(before.activeSheetIdByDocument);
    expect(after.viewportBySheet.get(SHEET_A1)).toBe(parsed.value);
  });

  it("moves and activates with the arrow keys, Home and End", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    modeTab("Project").focus();
    await shell.user.keyboard("{ArrowRight}");
    expect(modeTab("Git").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(modeTab("Git"));
    expect(modeTab("Git").tabIndex).toBe(0);
    expect(modeTab("Project").tabIndex).toBe(-1);
    await shell.user.keyboard("{ArrowRight}");
    expect(modeTab("Project").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(modeTab("Project"));
    await shell.user.keyboard("{End}");
    expect(document.activeElement).toBe(modeTab("Git"));
    expect(modeTab("Git").getAttribute("aria-selected")).toBe("true");
    await shell.user.keyboard("{Home}");
    expect(document.activeElement).toBe(modeTab("Project"));
    await shell.user.keyboard("{ArrowLeft}");
    expect(modeTab("Git").getAttribute("aria-selected")).toBe("true");
  });
});

describe("repository state", () => {
  it("asks for a Project when none is open and shows no Git state", async () => {
    const shell = await renderShell();
    await showGit(shell);
    expect(screen.getByText(GIT_MESSAGES.ja.noProject)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "更新" })).toBeNull();
  });

  it("shows a loading status while the first refresh is held", async () => {
    const shell = await renderShell();
    const release = shell.gitGateway.holdNextCall();
    await shell.openProjectInUi();
    await showGit(shell);
    const loading = screen.getByText(GIT_MESSAGES.ja.loading);
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      release();
      await settle();
    });
    expect(
      screen.getByText(GIT_MESSAGES.ja.repositoryStates.ready),
    ).toBeTruthy();
  });

  it.each([
    ["ready", "このProjectはGitで管理されています"],
    ["notRepository", "このProjectはGitで管理されていません"],
    [
      "unsupportedRepositoryLayout",
      "このProjectはGitリポジトリの一部として管理されています。現在のバージョンでは、Project全体がGitリポジトリである場合のみGit機能を利用できます。",
    ],
    ["gitUnavailable", "Gitが見つかりません（Git 2.25以上が必要です）"],
    ["error", "Gitの状態を取得できませんでした"],
  ] as const)("shows the fixed text of %s as a status", async (state, text) => {
    const shell = await renderShell();
    await openProjectWithState(shell, state);
    const status = screen.getByRole("status", { name: "Repositoryの状態" });
    expect(status.textContent).toBe(text);
    expect(screen.queryByRole("button", { name: "再試行" })).toBeNull();
    expect(screen.queryByText(GIT_MESSAGES.ja.loading)).toBeNull();
  });

  it("shows the change list placeholder only when ready", async () => {
    const shell = await renderShell();
    await openProjectWithState(shell, "ready");
    expect(document.querySelector(".git-panel__changes")).not.toBeNull();
    cleanup();
    const other = await renderShell();
    await openProjectWithState(other, "notRepository");
    expect(document.querySelector(".git-panel__changes")).toBeNull();
  });

  it("shows a failure with a retry that refreshes and recovers", async () => {
    const shell = await renderShell();
    shell.gitGateway.failure = { kind: "gitTimeout", detail: "slow" };
    await shell.openProjectInUi();
    await showGit(shell);
    expect(screen.getByText(GIT_MESSAGES.ja.statusFailed)).toBeTruthy();
    const callsBefore = shell.gitGateway.calls.length;

    shell.gitGateway.failure = null;
    await shell.user.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() =>
      expect(
        screen.getByText(GIT_MESSAGES.ja.repositoryStates.ready),
      ).toBeTruthy(),
    );
    expect(shell.gitGateway.calls.length).toBe(callsBefore + 1);
    expect(screen.queryByRole("button", { name: "再試行" })).toBeNull();
    expect(shell.gitController.store.getState().statusError).toBeNull();
  });

  it("shows an updating indicator without hiding the state while refreshing", async () => {
    const shell = await renderShell();
    await openProjectWithState(shell, "ready");
    const refresh = screen.getByRole("button", { name: "更新" });
    expect((refresh as HTMLButtonElement).disabled).toBe(false);

    const release = shell.gitGateway.holdNextCall();
    await shell.user.click(refresh);
    expect(screen.getByText(GIT_MESSAGES.ja.refreshing)).toBeTruthy();
    expect(
      screen.getByText(GIT_MESSAGES.ja.repositoryStates.ready),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "更新" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => {
      release();
      await settle();
    });
    expect(screen.queryByText(GIT_MESSAGES.ja.refreshing)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "更新" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("disables the refresh button while a Git operation runs", async () => {
    const shell = await renderShell();
    await openProjectWithState(shell, "ready");
    const refreshButton = () =>
      screen.getByRole("button", { name: "更新" }) as HTMLButtonElement;
    expect(refreshButton().disabled).toBe(false);
    // `operating` is owned by the controller; the test only sets what it would set.
    act(() => {
      shell.gitController.store.setState((git) => ({
        ...git,
        operating: true,
      }));
    });
    expect(refreshButton().disabled).toBe(true);
    act(() => {
      shell.gitController.store.setState((git) => ({
        ...git,
        operating: false,
      }));
    });
    expect(refreshButton().disabled).toBe(false);
  });

  it("drops the previous Project's state when the Project changes", async () => {
    const shell = await renderShell();
    await openProjectWithState(shell, "notRepository");
    expect(
      screen.getByText(GIT_MESSAGES.ja.repositoryStates.notRepository),
    ).toBeTruthy();

    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(screen.getByText(GIT_MESSAGES.ja.noProject)).toBeTruthy();
    expect(
      screen.queryByText(GIT_MESSAGES.ja.repositoryStates.notRepository),
    ).toBeNull();

    shell.gitGateway.status = CLEAN_GIT_STATUS;
    const release = shell.gitGateway.holdNextCall();
    await act(async () => {
      await shell.actions.openProjectViaDialog();
      await settle();
    });
    expect(screen.getByText(GIT_MESSAGES.ja.loading)).toBeTruthy();
    expect(
      screen.queryByText(GIT_MESSAGES.ja.repositoryStates.notRepository),
    ).toBeNull();
    await act(async () => {
      release();
      await settle();
    });
    expect(
      screen.getByText(GIT_MESSAGES.ja.repositoryStates.ready),
    ).toBeTruthy();
  });
});
