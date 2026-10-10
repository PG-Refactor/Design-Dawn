// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitBranchInfo,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import { settle } from "../../application/test-support/fakes";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { GIT_MESSAGES } from "./git-messages";

afterEach(cleanup);

const ja = GIT_MESSAGES.ja;
const OID = "0123456789abcdef0123456789abcdef01234567";
const UPSTREAM = "origin/main";

const STAGED: GitFileStatus = {
  path: "a.md",
  indexStatus: "modified",
  worktreeStatus: "unmodified",
  originalPath: null,
};
const UNSTAGED: GitFileStatus = {
  path: "c.md",
  indexStatus: "unmodified",
  worktreeStatus: "modified",
  originalPath: null,
};

function branchOf(overrides: Partial<GitBranchInfo> = {}): GitBranchInfo {
  return {
    head: "main",
    oid: OID,
    upstream: UPSTREAM,
    ahead: 0,
    behind: 0,
    headPushed: false,
    ...overrides,
  };
}

function statusOf(
  files: GitFileStatus[],
  branch: Partial<GitBranchInfo> = {},
): GitStatus {
  return {
    repositoryState: "ready",
    branch: branchOf(branch),
    files,
  };
}

async function openGit(status: GitStatus): Promise<ShellHarness> {
  const shell = await renderShell();
  shell.gitGateway.status = status;
  await shell.openProjectInUi();
  await shell.user.click(screen.getByRole("tab", { name: "Git" }));
  await screen.findByRole("heading", { name: ja.changeListLabel });
  return shell;
}

async function typeMessage(shell: ShellHarness, text: string): Promise<void> {
  await shell.user.click(
    screen.getByRole("textbox", { name: ja.commitMessageLabel }),
  );
  await shell.user.paste(text);
}

const splitTrigger = () =>
  screen.getByRole("button", { name: ja.commitMenuLabel });
const moreTrigger = () => screen.getByRole("button", { name: ja.moreActions });
const menuItem = (name: string) => screen.getByRole("menuitem", { name });
const primaryButton = () =>
  document.querySelector(
    ".git-commit-split .git-primary-button",
  ) as HTMLButtonElement | null;

async function settled(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

describe("commit split menu", () => {
  it("opens with the keyboard, moves with the arrows and closes with Escape", async () => {
    const shell = await openGit(statusOf([STAGED]));
    expect(splitTrigger().getAttribute("aria-haspopup")).toBe("menu");
    splitTrigger().focus();
    await shell.user.keyboard("{ArrowDown}");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((entry) => entry.textContent)).toEqual([
      ja.commitActions.commit,
      ja.commitActions.amend,
      ja.commitActions.commitPush,
      ja.commitActions.commitSync,
    ]);
    expect(document.activeElement).toBe(items[0]);
    await shell.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await shell.user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(splitTrigger());
  });

  it("commits, amends, and commits and pushes / syncs with the right options", async () => {
    const shell = await openGit(statusOf([STAGED]));
    await typeMessage(shell, "msg");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.commit));
    await settled();
    expect(shell.gitGateway.commitCalls.at(-1)?.options).toEqual({
      amend: false,
      stageAll: false,
    });

    await typeMessage(shell, "again");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.amend));
    await settled();
    expect(shell.gitGateway.commitCalls.at(-1)?.options).toEqual({
      amend: true,
      stageAll: false,
    });

    await typeMessage(shell, "third");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.commitPush));
    await settled();
    expect(shell.gitGateway.pushCalls).toHaveLength(1);

    await typeMessage(shell, "fourth");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.commitSync));
    await settled();
    expect(shell.gitGateway.pullCalls).toHaveLength(1);
    expect(shell.gitGateway.pushCalls).toHaveLength(2);
  });

  it("explains why an item is disabled and does nothing when it is chosen", async () => {
    const shell = await openGit(
      statusOf([STAGED], { upstream: null, ahead: null, behind: null }),
    );
    await typeMessage(shell, "msg");
    await shell.user.click(splitTrigger());
    const sync = menuItem(ja.commitActions.commitSync);
    expect(sync.getAttribute("aria-disabled")).toBe("true");
    expect(sync.title).toBe(ja.disabledReasons.noUpstream);
    await shell.user.click(sync);
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
  });

  it("disables Amend for a pushed commit, and push items when detached", async () => {
    const pushed = await openGit(statusOf([STAGED], { headPushed: true }));
    await pushed.user.click(splitTrigger());
    expect(menuItem(ja.commitActions.amend).title).toBe(
      ja.disabledReasons.alreadyPushed,
    );
    cleanup();
    const detached = await openGit(statusOf([STAGED], { head: null }));
    await detached.user.click(splitTrigger());
    expect(menuItem(ja.commitActions.commitPush).title).toBe(
      ja.disabledReasons.detached,
    );
    expect(menuItem(ja.commitActions.commitSync).title).toBe(
      ja.disabledReasons.detached,
    );
  });

  it("says there are no commits when Amend has no HEAD", async () => {
    const shell = await openGit(statusOf([STAGED], { oid: null }));
    await shell.user.click(splitTrigger());
    expect(menuItem(ja.commitActions.amend).title).toBe(
      ja.disabledReasons.noCommits,
    );
  });

  it("disables every item while a Git operation runs", async () => {
    const shell = await openGit(statusOf([STAGED]));
    await typeMessage(shell, "msg");
    const release = shell.gitGateway.holdNextCommit();
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    await shell.user.click(splitTrigger());
    for (const entry of screen.getAllByRole("menuitem")) {
      expect(entry.getAttribute("aria-disabled")).toBe("true");
    }
    await act(async () => {
      release();
      await settle();
    });
  });

  it("uses the English texts", async () => {
    const shell = await openGit(statusOf([STAGED]));
    act(() => shell.services.languageController.applyExternal("en"));
    await shell.user.click(
      await screen.findByRole("button", {
        name: GIT_MESSAGES.en.commitMenuLabel,
      }),
    );
    expect(
      screen.getAllByRole("menuitem").map((entry) => entry.textContent),
    ).toEqual(["Commit", "Commit (Amend)", "Commit & Push", "Commit & Sync"]);
  });
});

describe("smart commit", () => {
  it("asks before staging everything; Yes commits with stageAll", async () => {
    const shell = await openGit(statusOf([UNSTAGED]));
    await typeMessage(shell, "msg");
    await shell.user.click(
      screen.getByRole("button", { name: new RegExp(`^${ja.commit}`) }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(ja.stageAllDialog.title)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
    await shell.user.click(
      within(dialog).getByRole("button", { name: ja.stageAllDialog.confirm }),
    );
    await settled();
    expect(shell.gitGateway.commitCalls).toHaveLength(1);
    expect(shell.gitGateway.commitCalls[0]?.options).toEqual({
      amend: false,
      stageAll: true,
    });
  });

  it("does nothing on Cancel and on Escape", async () => {
    const shell = await openGit(statusOf([UNSTAGED]));
    await typeMessage(shell, "msg");
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    await shell.user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    await shell.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
  });

  it("never asks for an Amend", async () => {
    const shell = await openGit(statusOf([UNSTAGED]));
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.amend));
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.gitGateway.commitCalls[0]?.options.amend).toBe(true);
  });
});

describe("choosing a remote", () => {
  it("reports a missing remote and commits nothing", async () => {
    const shell = await openGit(
      statusOf([STAGED], { upstream: null, ahead: null, behind: null }),
    );
    shell.gitGateway.remoteNames = [];
    await typeMessage(shell, "msg");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.commitPush));
    await settled();
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
    const errors = shell.uiStateStore.getState().operationErrors;
    expect(errors.map((entry) => [entry.operation, entry.error.kind])).toEqual([
      ["publishGit", "gitNoRemote"],
    ]);
  });

  it("uses the only remote without asking", async () => {
    const shell = await openGit(
      statusOf([STAGED], { upstream: null, ahead: null, behind: null }),
    );
    shell.gitGateway.remoteNames = ["origin"];
    await typeMessage(shell, "msg");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.commitPush));
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.gitGateway.commitCalls).toHaveLength(1);
    expect(shell.gitGateway.publishCalls.map((call) => call.remote)).toEqual([
      "origin",
    ]);
  });

  it("asks among several remotes before committing; cancel changes nothing", async () => {
    const shell = await openGit(
      statusOf([STAGED], { upstream: null, ahead: null, behind: null }),
    );
    shell.gitGateway.remoteNames = ["origin", "backup"];
    await typeMessage(shell, "msg");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.commitPush));
    await settled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(ja.remoteDialog.title)).toBeTruthy();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
    await shell.user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.gitGateway.commitCalls).toHaveLength(0);
    expect(shell.gitGateway.publishCalls).toHaveLength(0);
  });

  it("commits and publishes to the picked remote", async () => {
    const shell = await openGit(
      statusOf([STAGED], { upstream: null, ahead: null, behind: null }),
    );
    shell.gitGateway.remoteNames = ["origin", "backup"];
    await typeMessage(shell, "msg");
    await shell.user.click(splitTrigger());
    await shell.user.click(menuItem(ja.commitActions.commitPush));
    await settled();
    await shell.user.click(screen.getByRole("radio", { name: "backup" }));
    await shell.user.click(
      screen.getByRole("button", { name: ja.remoteDialog.confirm }),
    );
    await settled();
    expect(shell.gitGateway.commitCalls).toHaveLength(1);
    expect(shell.gitGateway.publishCalls.map((call) => call.remote)).toEqual([
      "backup",
    ]);
  });
});

describe("primary button without changes", () => {
  it("becomes Sync Changes with the counts and runs a sync", async () => {
    const shell = await openGit(statusOf([], { ahead: 1, behind: 2 }));
    const button = primaryButton();
    expect(button?.textContent).toBe(ja.syncChangesWithCounts(2, 1));
    expect(button?.getAttribute("aria-label")).toBe(ja.syncCountsLabel(2, 1));
    await shell.user.click(button as HTMLButtonElement);
    await settled();
    expect(shell.gitGateway.pullCalls).toHaveLength(1);
    expect(shell.gitGateway.pushCalls).toHaveLength(1);
  });

  it("becomes Publish Branch without an upstream", async () => {
    const shell = await openGit(
      statusOf([], { upstream: null, ahead: null, behind: null }),
    );
    shell.gitGateway.remoteNames = ["origin"];
    const button = primaryButton();
    expect(button?.textContent).toBe(ja.publishBranch);
    await shell.user.click(button as HTMLButtonElement);
    await settled();
    expect(shell.gitGateway.publishCalls.map((call) => call.remote)).toEqual([
      "origin",
    ]);
  });

  it("stays a disabled Commit button when there is nothing to synchronize", async () => {
    await openGit(statusOf([]));
    expect(primaryButton()?.textContent).toBe(ja.commit);
    expect(primaryButton()?.disabled).toBe(true);
  });
});

describe("header More Actions menu", () => {
  it("lists the actions in order with separators", async () => {
    const shell = await openGit(statusOf([STAGED]));
    await shell.user.click(moreTrigger());
    expect(
      screen.getAllByRole("menuitem").map((entry) => entry.textContent),
    ).toEqual([
      ja.headerActions.pull,
      ja.headerActions.push,
      ja.headerActions.fetch,
      ja.headerActions.sync,
      ja.headerActions.undoLastCommit,
      ja.commitActions.commit,
      ja.commitActions.amend,
      ja.commitActions.commitPush,
      ja.commitActions.commitSync,
    ]);
    expect(
      within(screen.getByRole("menu")).getAllByRole("separator"),
    ).toHaveLength(2);
  });

  it("runs Fetch, Pull, Push and Sync", async () => {
    const shell = await openGit(statusOf([]));
    for (const name of [
      ja.headerActions.fetch,
      ja.headerActions.pull,
      ja.headerActions.push,
      ja.headerActions.sync,
    ]) {
      await shell.user.click(moreTrigger());
      await shell.user.click(menuItem(name));
      await settled();
    }
    expect(shell.gitGateway.fetchCalls).toHaveLength(1);
    expect(shell.gitGateway.pullCalls).toHaveLength(2);
    expect(shell.gitGateway.pushCalls).toHaveLength(2);
  });

  it("disables Pull and Sync without an upstream or when detached, but not Fetch", async () => {
    const shell = await openGit(
      statusOf([], { upstream: null, ahead: null, behind: null }),
    );
    await shell.user.click(moreTrigger());
    expect(menuItem(ja.headerActions.pull).title).toBe(
      ja.disabledReasons.noUpstream,
    );
    expect(menuItem(ja.headerActions.sync).title).toBe(
      ja.disabledReasons.noUpstream,
    );
    expect(menuItem(ja.headerActions.push).getAttribute("aria-disabled")).toBe(
      null,
    );
    expect(menuItem(ja.headerActions.fetch).getAttribute("aria-disabled")).toBe(
      null,
    );
    cleanup();
    const detached = await openGit(statusOf([], { head: null }));
    await detached.user.click(moreTrigger());
    expect(menuItem(ja.headerActions.push).title).toBe(
      ja.disabledReasons.detached,
    );
    expect(menuItem(ja.headerActions.pull).title).toBe(
      ja.disabledReasons.detached,
    );
  });

  it("undoes the last commit and fills a blank draft only", async () => {
    const shell = await openGit(statusOf([]));
    const box = () =>
      screen.getByRole("textbox", {
        name: ja.commitMessageLabel,
      }) as HTMLTextAreaElement;
    await shell.user.click(moreTrigger());
    await shell.user.click(menuItem(ja.headerActions.undoLastCommit));
    await settled();
    expect(shell.gitGateway.undoCalls).toHaveLength(1);
    expect(box().value).not.toBe("");
    await shell.user.clear(box());
    await typeMessage(shell, "mine");
    await shell.user.click(moreTrigger());
    await shell.user.click(menuItem(ja.headerActions.undoLastCommit));
    await settled();
    expect(shell.gitGateway.undoCalls).toHaveLength(2);
    expect(box().value).toBe("mine");
  });

  it("disables Undo Last Commit for a pushed or missing HEAD", async () => {
    const shell = await openGit(statusOf([], { headPushed: true }));
    await shell.user.click(moreTrigger());
    expect(menuItem(ja.headerActions.undoLastCommit).title).toBe(
      ja.disabledReasons.alreadyPushed,
    );
  });
});

describe("branch indicator", () => {
  it("shows the counts as a Sync button and omits zeros", async () => {
    const shell = await openGit(statusOf([], { ahead: 0, behind: 3 }));
    const button = screen.getByTitle(ja.syncChanges);
    expect(button.textContent).toBe("3↓");
    await shell.user.click(button);
    await settled();
    expect(shell.gitGateway.pullCalls).toHaveLength(1);
  });

  it("shows both counts, and nothing when both are zero", async () => {
    await openGit(statusOf([], { ahead: 1, behind: 2 }));
    expect(screen.getByTitle(ja.syncChanges).textContent).toBe("2↓ 1↑");
    cleanup();
    await openGit(statusOf([], { ahead: 0, behind: 0 }));
    expect(screen.queryByTitle(ja.syncChanges)).toBeNull();
  });

  it("offers a publish icon button without an upstream, and neither when detached", async () => {
    const shell = await openGit(
      statusOf([], { upstream: null, ahead: null, behind: null }),
    );
    shell.gitGateway.remoteNames = ["origin"];
    const publish = screen.getByTitle(ja.publishBranch);
    expect(publish.tagName).toBe("BUTTON");
    await shell.user.click(publish);
    await settled();
    expect(shell.gitGateway.publishCalls).toHaveLength(1);
    cleanup();
    await openGit(
      statusOf([], { head: null, upstream: null, ahead: null, behind: null }),
    );
    expect(screen.queryByTitle(ja.publishBranch)).toBeNull();
  });
});

describe("progress", () => {
  it("shows the running operation in a live region and clears it afterwards", async () => {
    const shell = await openGit(statusOf([STAGED]));
    await typeMessage(shell, "msg");
    const release = shell.gitGateway.holdNextCommit();
    await shell.user.keyboard("{Control>}{Enter}{/Control}");
    const text = screen.getByText(ja.runningOperation.commit);
    expect(text.getAttribute("role")).toBe("status");
    await act(async () => {
      release();
      await settle();
    });
    expect(screen.queryByText(ja.runningOperation.commit)).toBeNull();
  });
});
