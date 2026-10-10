// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitDiff,
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import { operationErr } from "../../application/ports/operation-error";
import { FAKE_COMMIT_ID } from "../../application/test-support/fake-git";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { makeDocumentADirty } from "../workspace/test-support/actions-harness";
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
): GitFileStatus {
  return { path, indexStatus, worktreeStatus, originalPath: null };
}

function statusOf(...files: GitFileStatus[]): GitStatus {
  return { repositoryState: "ready", branch: null, files };
}

const STAGED = [file("a.md", "modified", "unmodified")];
const UNSTAGED_ONLY = [file("c.md", "unmodified", "modified")];
const CLEAN_AFTER_COMMIT = statusOf();
const MESSAGE = "feat: add a\n\nbody line";

const gitTab = () =>
  within(
    screen.getByRole("tablist", { name: "左パネルの表示切り替え" }),
  ).getByRole("tab", { name: "Git" });
const projectTab = () =>
  within(
    screen.getByRole("tablist", { name: "左パネルの表示切り替え" }),
  ).getByRole("tab", { name: "Project" });
const messageBox = () =>
  screen.getByRole("textbox", {
    name: GIT_MESSAGES.ja.commitMessageLabel,
  }) as HTMLTextAreaElement;
const commitButton = () =>
  screen.getByRole("button", {
    name: new RegExp(`^${GIT_MESSAGES.ja.commit}`),
  }) as HTMLButtonElement;
const refreshButton = () =>
  screen.getByRole("button", { name: GIT_MESSAGES.ja.refresh });
const noteElement = () =>
  screen.getByText(GIT_MESSAGES.ja.commitUnsavedNote, { exact: false });
const rowText = rowOf;

async function settled(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

async function openGit(
  files: GitFileStatus[],
  shell?: ShellHarness,
): Promise<ShellHarness> {
  const target = shell ?? (await renderShell());
  target.gitGateway.status = statusOf(...files);
  await target.openProjectInUi();
  await target.user.click(gitTab());
  await screen.findByRole("heading", { name: GIT_MESSAGES.ja.changeListLabel });
  return target;
}

async function typeMessage(shell: ShellHarness, text: string): Promise<void> {
  await shell.user.click(messageBox());
  await shell.user.paste(text);
}

describe("commit button state", () => {
  it("is disabled for an empty or whitespace-only message, enabled otherwise", async () => {
    const shell = await openGit(STAGED);
    expect(commitButton().disabled).toBe(true);
    await typeMessage(shell, " \n\t ");
    expect(commitButton().disabled).toBe(true);
    await typeMessage(shell, "x");
    expect(commitButton().disabled).toBe(false);
  });

  it("is disabled when nothing is staged", async () => {
    const shell = await openGit(UNSTAGED_ONLY);
    await typeMessage(shell, "message");
    expect(commitButton().disabled).toBe(true);
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
  });

  it("is not shown when the repository is not ready", async () => {
    const shell = await renderShell();
    shell.gitGateway.status = {
      repositoryState: "notRepository",
      branch: null,
      files: [],
    };
    await shell.openProjectInUi();
    await shell.user.click(gitTab());
    await screen.findByText(GIT_MESSAGES.ja.repositoryStates.notRepository);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: GIT_MESSAGES.ja.commit }),
    ).toBeNull();
  });

  it("is disabled while another Git operation runs", async () => {
    const shell = await openGit([...STAGED, ...UNSTAGED_ONLY]);
    await typeMessage(shell, "message");
    const release = shell.gitGateway.holdNextStage();
    await shell.user.click(
      within(headerOf("変更")).getByRole("button", {
        name: GIT_MESSAGES.ja.stageAll,
      }),
    );
    expect(commitButton().disabled).toBe(true);
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
    await act(async () => {
      release();
      await settle();
    });
    expect(commitButton().disabled).toBe(false);
  });
});

describe("committing", () => {
  it("commits the exact message on click, clears the draft and shows the new status", async () => {
    const shell = await openGit(STAGED);
    await typeMessage(shell, MESSAGE);
    shell.gitGateway.status = CLEAN_AFTER_COMMIT;
    await shell.user.click(commitButton());
    await settled();
    expect(shell.gitGateway.commitCalls.map((call) => call.message)).toEqual([
      MESSAGE,
    ]);
    expect(messageBox().value).toBe("");
    expect(shell.uiStateStore.getState().gitCommitMessage).toBe("");
    expect(screen.getByText(GIT_MESSAGES.ja.noChanges)).toBeTruthy();
    expect(shell.gitController.store.getState().lastCommit).toEqual({
      commitId: FAKE_COMMIT_ID,
    });
    expect(shell.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("commits with Ctrl+Enter and with Meta+Enter, and Enter alone adds a newline", async () => {
    const shell = await openGit(STAGED);
    await typeMessage(shell, "one");
    await shell.user.keyboard("{Enter}two");
    expect(messageBox().value).toBe("one\ntwo");
    expect(shell.gitGateway.commitCalls).toHaveLength(0);

    shell.gitGateway.status = statusOf(...STAGED);
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    await settled();
    expect(shell.gitGateway.commitCalls.map((call) => call.message)).toEqual([
      "one\ntwo",
    ]);

    await typeMessage(shell, "three");
    await shell.user.keyboard("{Meta>}{Enter}{/Meta}");
    await settled();
    expect(shell.gitGateway.commitCalls.map((call) => call.message)).toEqual([
      "one\ntwo",
      "three",
    ]);
  });

  it("commits once for two rapid triggers and keeps the field read-only meanwhile", async () => {
    const shell = await openGit(STAGED);
    await typeMessage(shell, MESSAGE);
    const release = shell.gitGateway.holdNextCommit();
    shell.gitGateway.status = CLEAN_AFTER_COMMIT;
    await shell.user.click(commitButton());
    await shell.user.click(commitButton());
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    expect(shell.gitGateway.commitCalls).toHaveLength(1);
    expect(messageBox().readOnly).toBe(true);
    await act(async () => {
      release();
      await settle();
    });
    expect(shell.gitGateway.commitCalls).toHaveLength(1);
    expect(messageBox().readOnly).toBe(false);
    expect(messageBox().value).toBe("");
  });

  it("closes the shown diff of a file that is no longer changed after the commit", async () => {
    const shell = await openGit(STAGED);
    shell.gitGateway.diffs["staged:a.md"] = {
      path: "a.md",
      side: "staged",
      outcome: "text",
      diff: "@@ -0,0 +1 @@\n+staged line\n",
    } satisfies GitDiff;
    await shell.user.click(
      rowText("ステージされている変更", "変更 a.md").querySelector(
        ".git-file-row__name",
      ) as HTMLElement,
    );
    await screen.findByText("staged line");
    await typeMessage(shell, MESSAGE);
    shell.gitGateway.status = CLEAN_AFTER_COMMIT;
    await shell.user.click(commitButton());
    await settled();
    expect(shell.uiStateStore.getState().diffTabs).toEqual([]);
    expect(shell.gitController.store.getState().diff).toBeNull();
    expect(screen.queryByText("staged line")).toBeNull();
  });

  it("keeps the draft on failure and reports exactly one commit failure", async () => {
    const shell = await openGit(STAGED);
    shell.gitGateway.commit = async (projectId, message, options) => {
      shell.gitGateway.commitCalls.push({ projectId, message, options });
      return operationErr("gitCommitRejected", "hook said no");
    };
    await typeMessage(shell, MESSAGE);
    await shell.user.click(commitButton());
    await settled();
    expect(messageBox().value).toBe(MESSAGE);
    expect(shell.uiStateStore.getState().gitCommitMessage).toBe(MESSAGE);
    expect(
      shell.uiStateStore
        .getState()
        .operationErrors.map((entry) => entry.operation),
    ).toEqual(["commitGitChanges"]);
    expect(commitButton().disabled).toBe(false);
  });

  it("clears the draft and reports only the status problem when the status was unavailable", async () => {
    const shell = await openGit(STAGED);
    shell.gitGateway.diffs["staged:a.md"] = {
      path: "a.md",
      side: "staged",
      outcome: "text",
      diff: "@@ -0,0 +1 @@\n+staged line\n",
    };
    await shell.user.click(
      rowText("ステージされている変更", "変更 a.md").querySelector(
        ".git-file-row__name",
      ) as HTMLElement,
    );
    await screen.findByText("staged line");
    await typeMessage(shell, MESSAGE);
    shell.gitGateway.commitResult = {
      commitId: FAKE_COMMIT_ID,
      status: { outcome: "unavailable", errorKind: "gitTimeout" },
    };
    await shell.user.click(commitButton());
    await settled();
    expect(shell.uiStateStore.getState().gitCommitMessage).toBe("");
    expect(
      shell.uiStateStore
        .getState()
        .operationErrors.map((entry) => entry.operation),
    ).toEqual(["refreshGitStatus"]);
    expect(shell.uiStateStore.getState().diffTabs).toEqual([]);
    expect(screen.getByText(GIT_MESSAGES.ja.statusFailed)).toBeTruthy();
  });

  it("does not clear the draft of another Project when the answer arrives late", async () => {
    const shell = await openGit(STAGED);
    await typeMessage(shell, MESSAGE);
    const release = shell.gitGateway.holdNextCommit();
    await shell.user.click(commitButton());
    await act(async () => {
      await shell.workspace.closeProject();
      await settle();
    });
    expect(shell.uiStateStore.getState().gitCommitMessage).toBe("");
    shell.uiStateStore.setState((state) => ({
      ...state,
      gitCommitMessage: "new project draft",
    }));
    await act(async () => {
      release();
      await settle();
    });
    expect(shell.uiStateStore.getState().gitCommitMessage).toBe(
      "new project draft",
    );
  });
});

describe("draft", () => {
  it("survives switching between Project and Git and is reset when the Project closes", async () => {
    const shell = await openGit(STAGED);
    await typeMessage(shell, "keep me");
    await shell.user.click(projectTab());
    await shell.user.click(gitTab());
    expect(messageBox().value).toBe("keep me");
    await act(async () => {
      await shell.workspace.closeProject();
      await settle();
    });
    expect(shell.uiStateStore.getState().gitCommitMessage).toBe("");
  });
});

describe("unsaved note", () => {
  it("always shows the note and links it to the field and the button", async () => {
    await openGit(STAGED);
    const note = noteElement();
    expect(note.className).not.toContain("emphasised");
    expect(screen.queryByText(GIT_MESSAGES.ja.commitUnsavedPrefix)).toBeNull();
    expect(messageBox().getAttribute("aria-describedby")).toBe(note.id);
    expect(commitButton().getAttribute("aria-describedby")).toBe(note.id);
  });

  it("is emphasised with a text prefix while a document has unsaved changes, and committing does not save", async () => {
    const shell = await renderShell();
    await act(async () => {
      await shell.autoSaveController.setEnabled(false);
    });
    shell.gitGateway.status = statusOf(...STAGED);
    await shell.openProjectInUi();
    await act(async () => {
      await shell.actions.openDocument(DOCUMENT_A);
      await makeDocumentADirty(shell);
      await settle();
    });
    await shell.user.click(gitTab());
    await screen.findByRole("heading", {
      name: GIT_MESSAGES.ja.changeListLabel,
    });
    expect(noteElement().className).toContain("emphasised");
    expect(screen.getByText(GIT_MESSAGES.ja.commitUnsavedPrefix)).toBeTruthy();

    shell.gateway.clearCalls();
    const undoDepthBefore = shell.store
      .getState()
      .documents.get(DOCUMENT_A)?.history;
    await typeMessage(shell, MESSAGE);
    shell.gitGateway.status = CLEAN_AFTER_COMMIT;
    await shell.user.click(commitButton());
    await settled();
    expect(shell.gitGateway.commitCalls).toHaveLength(1);
    const writes = shell.gateway.calls.filter((call) =>
      [
        "saveProject",
        "saveDocument",
        "saveSheet",
        "writeBlockContent",
      ].includes(call.method),
    );
    expect(writes).toEqual([]);
    expect(shell.store.getState().documents.get(DOCUMENT_A)?.history).toEqual(
      undoDepthBefore,
    );
    expect(noteElement().className).toContain("emphasised");
  });
});

describe("refresh button", () => {
  const sampleDiff = (path: string, text: string): GitDiff => ({
    path,
    side: "unstaged",
    outcome: "text",
    diff: `@@ -0,0 +1 @@\n${text}\n`,
  });

  async function openWithShownDiff() {
    const shell = await openGit([
      file("c.md", "unmodified", "modified"),
      file("e.md", "unmodified", "modified"),
    ]);
    shell.gitGateway.diffs["unstaged:c.md"] = sampleDiff("c.md", "+first c");
    shell.gitGateway.diffs["unstaged:e.md"] = sampleDiff("e.md", "+only e");
    await shell.user.click(
      rowText("変更", "変更 c.md").querySelector(
        ".git-file-row__name",
      ) as HTMLElement,
    );
    await screen.findByText("first c");
    return shell;
  }

  it("reads the status and then reloads the shown diff", async () => {
    const shell = await openWithShownDiff();
    const statusCallsBefore = shell.gitGateway.calls.length;
    shell.gitGateway.diffs["unstaged:c.md"] = sampleDiff("c.md", "+second c");
    await shell.user.click(refreshButton());
    await settled();
    expect(shell.gitGateway.calls.length).toBe(statusCallsBefore + 1);
    await screen.findByText("second c");
  });

  it("closes the diff when the file is no longer changed", async () => {
    const shell = await openWithShownDiff();
    shell.gitGateway.status = statusOf(file("e.md", "unmodified", "modified"));
    await shell.user.click(refreshButton());
    await settled();
    expect(shell.uiStateStore.getState().diffTabs).toEqual([]);
    expect(screen.queryByText("first c")).toBeNull();
  });

  it("starts one status read for a double click", async () => {
    const shell = await openGit(STAGED);
    const before = shell.gitGateway.calls.length;
    const release = shell.gitGateway.holdNextCall();
    await shell.user.click(refreshButton());
    await shell.user.click(refreshButton());
    await act(async () => {
      release();
      await settle();
    });
    expect(shell.gitGateway.calls.length).toBe(before + 1);
  });

  it("does not let an older diff answer overwrite a newer one", async () => {
    const shell = await openWithShownDiff();
    const release = shell.gitGateway.holdNextDiff();
    await shell.user.click(refreshButton());
    await settled();
    // The reload of c.md is now waiting; choosing e.md supersedes it.
    await shell.user.click(
      rowText("変更", "変更 e.md").querySelector(
        ".git-file-row__name",
      ) as HTMLElement,
    );
    await act(async () => {
      release();
      await settle();
    });
    await screen.findByText("only e");
    expect(screen.queryByText("first c")).toBeNull();
  });
});
