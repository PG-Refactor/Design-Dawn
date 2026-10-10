// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { AUTO_REFRESH_DELAY_MS } from "../../config/git-config";
import {
  makeDocumentADirty,
  openedActionsHarness,
} from "../workspace/test-support/actions-harness";
import { renderShell } from "../workspace/test-support/shell-harness";
import { GIT_MESSAGES } from "./git-messages";
import { rowOf } from "./test-support/git-tree-queries";

afterEach(cleanup);

const CHANGES_SECTION = "変更";

async function openGitPanel() {
  const shell = await renderShell();
  await shell.openProjectInUi();
  await shell.user.click(screen.getByRole("tab", { name: "Git" }));
  await screen.findByRole("heading", { name: GIT_MESSAGES.ja.changeListLabel });
  return shell;
}

async function advanceAutoRefresh(
  shell: Awaited<ReturnType<typeof openGitPanel>>,
): Promise<void> {
  await act(async () => {
    shell.gitRefreshScheduler.advance(AUTO_REFRESH_DELAY_MS);
    await settle();
  });
}

const NEW_FILE_STATUS = {
  repositoryState: "ready",
  branch: null,
  files: [
    {
      path: "a.md",
      indexStatus: "unmodified",
      worktreeStatus: "modified",
      originalPath: null,
    },
  ],
} as const;

describe("automatic Git status refresh", () => {
  it("reads the status once after the debounce and shows the new change", async () => {
    const shell = await openGitPanel();
    const readsBefore = shell.gitGateway.calls.length;
    shell.gitGateway.status = NEW_FILE_STATUS;

    // Through the gateway, as a save of the app does.
    await act(async () => {
      await shell.signalingGateway.deleteBlockContent(
        ...([] as unknown as Parameters<
          typeof shell.signalingGateway.deleteBlockContent
        >),
      );
    });
    expect(shell.gitGateway.calls.length).toBe(readsBefore);
    await advanceAutoRefresh(shell);

    expect(shell.gitGateway.calls.length).toBe(readsBefore + 1);
    expect(rowOf(CHANGES_SECTION, "変更 a.md")).toBeTruthy();
  });

  it("turns several writes inside the window into one read", async () => {
    const shell = await openGitPanel();
    const readsBefore = shell.gitGateway.calls.length;

    for (let write = 0; write < 3; write += 1) {
      act(() => shell.services.projectWriteSignal.notify());
      act(() => shell.gitRefreshScheduler.advance(AUTO_REFRESH_DELAY_MS - 1));
    }
    await advanceAutoRefresh(shell);

    expect(shell.gitGateway.calls.length).toBe(readsBefore + 1);
  });

  it("does not flash the refreshing state", async () => {
    const shell = await openGitPanel();
    const states: boolean[] = [];
    shell.gitController.store.subscribe(() =>
      states.push(shell.gitController.store.getState().refreshing),
    );

    act(() => shell.services.projectWriteSignal.notify());
    await advanceAutoRefresh(shell);

    expect(states).not.toContain(true);
  });

  it("reads again when the window regains focus", async () => {
    const shell = await openGitPanel();
    const readsBefore = shell.gitGateway.calls.length;

    act(() => {
      fireEvent.focus(window);
    });
    await advanceAutoRefresh(shell);

    expect(shell.gitGateway.calls.length).toBe(readsBefore + 1);
  });

  it("does nothing while no Project is open", async () => {
    const shell = await renderShell();

    act(() => shell.services.projectWriteSignal.notify());
    act(() => {
      fireEvent.focus(window);
    });
    await advanceAutoRefresh(shell);

    expect(shell.gitGateway.calls).toEqual([]);
  });

  it("stops listening and cancels a pending read on unmount", async () => {
    const shell = await openGitPanel();
    const readsBefore = shell.gitGateway.calls.length;
    act(() => shell.services.projectWriteSignal.notify());
    expect(shell.gitRefreshScheduler.pendingCount()).toBe(1);

    cleanup();
    expect(shell.gitRefreshScheduler.pendingCount()).toBe(0);
    shell.services.projectWriteSignal.notify();
    fireEvent.focus(window);

    expect(shell.gitRefreshScheduler.pendingCount()).toBe(0);
    expect(shell.gitGateway.calls.length).toBe(readsBefore);
  });
});

describe("the workspace's own writes", () => {
  it("notify the signal when a document is saved", async () => {
    const harness = await openedActionsHarness();
    await harness.workspace.openDocument(DOCUMENT_A);
    await makeDocumentADirty(harness);
    let notified = 0;
    harness.services.projectWriteSignal.subscribe(() => {
      notified += 1;
    });

    await harness.actions.saveAll();

    expect(notified).toBeGreaterThan(0);
  });
});
