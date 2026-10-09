// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitFileStatus,
  GitHistoryEntry,
  GitHistoryPage,
  GitStatus,
} from "../../application/ports/git-gateway";
import { settle } from "../../application/test-support/fakes";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { formatCommitDate } from "./git-history-format";
import { commitIdLabel, GIT_MESSAGES } from "./git-messages";

afterEach(cleanup);

const ID_ONE = "1".repeat(40);
const ID_TWO = "2".repeat(40);
const ID_THREE = "3".repeat(40);
const CURSOR_ONE = `${ID_TWO}:2`;

function entry(
  commitId: string,
  summary: string,
  authorName = "Alice",
  authorDate = "2026-01-02T03:04:05+00:00",
): GitHistoryEntry {
  return {
    commitId,
    parentIds: [],
    authorName,
    authorEmail: "secret@example.invalid",
    authorDate,
    summary,
  };
}

const FIRST_PAGE: GitHistoryPage = {
  entries: [entry(ID_ONE, "first"), entry(ID_TWO, "second")],
  nextCursor: CURSOR_ONE,
};
const LAST_PAGE: GitHistoryPage = {
  entries: [entry(ID_THREE, "third")],
  nextCursor: null,
};
const STAGED: GitFileStatus = {
  path: "a.md",
  indexStatus: "modified",
  worktreeStatus: "unmodified",
  originalPath: null,
};
const READY: GitStatus = { repositoryState: "ready", files: [STAGED] };

const toggle = () =>
  screen.getByRole("button", {
    name: GIT_MESSAGES.historyToggle,
  }) as HTMLButtonElement;
const list = () =>
  screen.getByRole("list", { name: GIT_MESSAGES.historyListLabel });
const summaries = () =>
  within(list())
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent);
const moreButton = () =>
  screen.queryByRole("button", {
    name: new RegExp(
      `^(${GIT_MESSAGES.historyLoadMore}|${GIT_MESSAGES.historyLoadingMore})$`,
    ),
  }) as HTMLButtonElement | null;
const refreshButton = () =>
  screen.getByRole("button", { name: GIT_MESSAGES.refresh });

async function settled(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

async function release(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await settle();
  });
}

async function openGit(
  pages: readonly GitHistoryPage[] = [FIRST_PAGE, LAST_PAGE],
): Promise<ShellHarness> {
  const shell = await renderShell();
  shell.gitGateway.status = READY;
  shell.gitGateway.historyPages = pages;
  await shell.openProjectInUi();
  await shell.user.click(
    within(
      screen.getByRole("tablist", { name: "左パネルの表示切り替え" }),
    ).getByRole("tab", { name: "Git" }),
  );
  await screen.findByRole("heading", { name: GIT_MESSAGES.changeListLabel });
  return shell;
}

async function expand(shell: ShellHarness): Promise<void> {
  await shell.user.click(toggle());
  await settled();
}

describe("expanding", () => {
  it("is collapsed first, loads the first page on expand and not again on re-expand", async () => {
    const shell = await openGit();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(shell.gitGateway.historyCalls).toHaveLength(0);

    await expand(shell);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(shell.gitGateway.historyCalls).toHaveLength(1);
    expect(shell.gitGateway.historyCalls[0]?.cursor).toBeNull();
    expect(summaries()).toEqual(["first", "second"]);

    await expand(shell);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await expand(shell);
    expect(shell.gitGateway.historyCalls).toHaveLength(1);
    expect(summaries()).toEqual(["first", "second"]);
  });

  it("keeps the expanded state when switching between Project and Git", async () => {
    const shell = await openGit();
    await expand(shell);
    const tabs = screen.getByRole("tablist", {
      name: "左パネルの表示切り替え",
    });
    await shell.user.click(within(tabs).getByRole("tab", { name: "Project" }));
    await shell.user.click(within(tabs).getByRole("tab", { name: "Git" }));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(summaries()).toEqual(["first", "second"]);
  });

  it("is reset with the Project", async () => {
    const shell = await openGit();
    await expand(shell);
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    expect(shell.uiStateStore.getState().gitHistoryExpanded).toBe(false);
  });
});

describe("states", () => {
  it("shows loading, then entries", async () => {
    const shell = await openGit();
    const hold = shell.gitGateway.holdNextHistory();
    await shell.user.click(toggle());
    const status = screen.getByText(GIT_MESSAGES.historyLoading);
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    await release(hold);
    expect(screen.queryByText(GIT_MESSAGES.historyLoading)).toBeNull();
    expect(summaries()).toEqual(["first", "second"]);
  });

  it("shows the empty text without a commit", async () => {
    const shell = await openGit([{ entries: [], nextCursor: null }]);
    await expand(shell);
    expect(screen.getByText(GIT_MESSAGES.historyEmpty)).toBeTruthy();
    expect(
      screen.queryByRole("list", { name: GIT_MESSAGES.historyListLabel }),
    ).toBeNull();
  });

  it("shows a failure distinct from empty and retries", async () => {
    const shell = await openGit();
    shell.gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    await expand(shell);
    expect(screen.getByText(GIT_MESSAGES.historyFailed)).toBeTruthy();
    expect(screen.queryByText(GIT_MESSAGES.historyEmpty)).toBeNull();

    shell.gitGateway.historyFailure = null;
    await shell.user.click(
      screen.getByRole("button", { name: GIT_MESSAGES.retry }),
    );
    await settled();
    expect(screen.queryByText(GIT_MESSAGES.historyFailed)).toBeNull();
    expect(summaries()).toEqual(["first", "second"]);
  });

  it("retries a failed first load when re-expanded", async () => {
    const shell = await openGit();
    shell.gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    await expand(shell);
    shell.gitGateway.historyFailure = null;
    await expand(shell);
    await expand(shell);
    expect(shell.gitGateway.historyCalls).toHaveLength(2);
    expect(summaries()).toEqual(["first", "second"]);
  });
});

describe("entries", () => {
  it("shows summary, author, local date and short id with the full id reachable, never the email", async () => {
    const shell = await openGit();
    await expand(shell);
    const item = within(list()).getAllByRole("listitem")[0] as HTMLElement;
    expect(within(item).getByText("first")).toBeTruthy();
    expect(within(item).getByText("Alice")).toBeTruthy();
    const id = within(item).getByLabelText(commitIdLabel(ID_ONE));
    expect(id.textContent).toBe(ID_ONE.slice(0, 7));
    expect(id.getAttribute("title")).toBe(ID_ONE);
    const time = item.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-01-02T03:04:05+00:00");
    expect(time?.getAttribute("title")).toBe("2026-01-02T03:04:05+00:00");
    expect(document.body.textContent).not.toContain("secret@example.invalid");
  });

  it("renders markup-like text literally", async () => {
    const shell = await openGit([
      {
        entries: [entry(ID_ONE, "<b>x</b> & <img src=y>", "<i>Eve</i>")],
        nextCursor: null,
      },
    ]);
    await expand(shell);
    const item = within(list()).getAllByRole("listitem")[0] as HTMLElement;
    expect(item.textContent).toContain("<b>x</b> & <img src=y>");
    expect(item.textContent).toContain("<i>Eve</i>");
    expect(item.querySelector("b, i, img")).toBeNull();
  });
});

describe("formatCommitDate", () => {
  it("converts to the given time zone", () => {
    const tokyo = formatCommitDate("2026-01-02T03:04:05+00:00", {
      timeZone: "Asia/Tokyo",
    });
    expect(tokyo).toBe("2026/01/02 12:04");
    expect(
      formatCommitDate("2026-01-02T23:30:00-05:00", { timeZone: "UTC" }),
    ).toBe("2026/01/03 04:30");
  });

  it("returns an unreadable date as it is", () => {
    expect(formatCommitDate("not a date")).toBe("not a date");
  });
});

describe("loading more", () => {
  it("shows the button only with a cursor and appends in order until the last page", async () => {
    const shell = await openGit();
    await expand(shell);
    expect(moreButton()).not.toBeNull();
    await shell.user.click(moreButton() as HTMLButtonElement);
    await settled();
    expect(summaries()).toEqual(["first", "second", "third"]);
    expect(shell.gitGateway.historyCalls[1]?.cursor).toBe(CURSOR_ONE);
    expect(moreButton()).toBeNull();
  });

  it("shows no button for a single page", async () => {
    const shell = await openGit([LAST_PAGE]);
    await expand(shell);
    expect(moreButton()).toBeNull();
  });

  it("disables the button while loading and sends one request", async () => {
    const shell = await openGit();
    await expand(shell);
    const hold = shell.gitGateway.holdNextHistory();
    await shell.user.click(moreButton() as HTMLButtonElement);
    const busy = moreButton() as HTMLButtonElement;
    expect(busy.textContent).toBe(GIT_MESSAGES.historyLoadingMore);
    expect(busy.disabled).toBe(true);
    expect(summaries()).toEqual(["first", "second"]);
    await shell.user.click(busy);
    await release(hold);
    expect(shell.gitGateway.historyCalls).toHaveLength(2);
    expect(summaries()).toEqual(["first", "second", "third"]);
  });

  it("never shows a commit twice", async () => {
    const shell = await openGit([
      FIRST_PAGE,
      {
        entries: [entry(ID_TWO, "again"), entry(ID_THREE, "third")],
        nextCursor: null,
      },
    ]);
    await expand(shell);
    await shell.user.click(moreButton() as HTMLButtonElement);
    await settled();
    expect(summaries()).toEqual(["first", "second", "third"]);
  });

  it("keeps the entries, the button and a note after a failure", async () => {
    const shell = await openGit();
    await expand(shell);
    shell.gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    await shell.user.click(moreButton() as HTMLButtonElement);
    await settled();
    expect(summaries()).toEqual(["first", "second"]);
    expect(screen.getByText(GIT_MESSAGES.historyMoreFailed)).toBeTruthy();
    expect(moreButton()?.disabled).toBe(false);

    shell.gitGateway.historyFailure = null;
    await shell.user.click(moreButton() as HTMLButtonElement);
    await settled();
    expect(summaries()).toEqual(["first", "second", "third"]);
    expect(screen.queryByText(GIT_MESSAGES.historyMoreFailed)).toBeNull();
  });

  it("shows a consistent result when collapsed and re-expanded during the load", async () => {
    const shell = await openGit();
    await expand(shell);
    const hold = shell.gitGateway.holdNextHistory();
    await shell.user.click(moreButton() as HTMLButtonElement);
    await shell.user.click(toggle());
    await shell.user.click(toggle());
    expect(moreButton()?.disabled).toBe(true);
    await release(hold);
    expect(summaries()).toEqual(["first", "second", "third"]);
    expect(shell.gitGateway.historyCalls).toHaveLength(2);
  });
});

describe("refresh", () => {
  it("reloads an expanded history from the first page and re-reads the status", async () => {
    const shell = await openGit();
    await expand(shell);
    await shell.user.click(moreButton() as HTMLButtonElement);
    await settled();
    const statusCalls = shell.gitGateway.calls.length;
    shell.gitGateway.historyPages = [LAST_PAGE];

    await shell.user.click(refreshButton());
    await settled();

    expect(shell.gitGateway.calls.length).toBe(statusCalls + 1);
    const calls = shell.gitGateway.historyCalls;
    expect(calls).toHaveLength(3);
    expect(calls[2]?.cursor).toBeNull();
    expect(summaries()).toEqual(["third"]);
  });

  it("does not load a collapsed history", async () => {
    const shell = await openGit();
    await shell.user.click(refreshButton());
    await settled();
    expect(shell.gitGateway.historyCalls).toHaveLength(0);
  });

  it("reloads an expanded history when a failed status is retried", async () => {
    const shell = await openGit();
    await expand(shell);
    shell.gitGateway.failure = {
      kind: "gitCommandFailed",
      detail: "status failed",
    };
    await shell.user.click(refreshButton());
    await settled();
    shell.gitGateway.failure = null;
    const historyCalls = shell.gitGateway.historyCalls.length;

    await shell.user.click(
      screen.getByRole("button", { name: GIT_MESSAGES.retry }),
    );
    await settled();

    expect(shell.gitGateway.historyCalls).toHaveLength(historyCalls + 1);
    expect(shell.gitGateway.historyCalls.at(-1)?.cursor).toBeNull();
    expect(summaries()).toEqual(["first", "second"]);
  });

  it("sends one history request for a double click", async () => {
    const shell = await openGit();
    await expand(shell);
    const hold = shell.gitGateway.holdNextCall();
    await shell.user.click(refreshButton());
    await shell.user.click(refreshButton());
    await release(hold);
    expect(shell.gitGateway.historyCalls).toHaveLength(2);
  });

  it("drops a stale load-more answer", async () => {
    const shell = await openGit();
    await expand(shell);
    const hold = shell.gitGateway.holdNextHistory();
    await shell.user.click(moreButton() as HTMLButtonElement);
    shell.gitGateway.historyPages = [
      { entries: [entry(ID_ONE, "fresh")], nextCursor: null },
    ];
    await shell.user.click(refreshButton());
    await release(hold);
    expect(summaries()).toEqual(["fresh"]);
  });
});

describe("after a commit", () => {
  async function commit(shell: ShellHarness): Promise<void> {
    await shell.user.click(
      screen.getByRole("textbox", { name: GIT_MESSAGES.commitMessageLabel }),
    );
    await shell.user.paste("message");
    await shell.user.click(
      screen.getByRole("button", {
        name: new RegExp(`^${GIT_MESSAGES.commit}`),
      }),
    );
    await settled();
  }

  it("reloads an expanded history from the first page", async () => {
    const shell = await openGit();
    await expand(shell);
    await shell.user.click(moreButton() as HTMLButtonElement);
    await settled();
    shell.gitGateway.historyPages = [
      { entries: [entry(ID_THREE, "new commit")], nextCursor: null },
    ];
    await commit(shell);
    expect(shell.gitGateway.historyCalls).toHaveLength(3);
    expect(shell.gitGateway.historyCalls[2]?.cursor).toBeNull();
    expect(summaries()).toEqual(["new commit"]);
  });

  it("does not load a collapsed history", async () => {
    const shell = await openGit();
    await commit(shell);
    expect(shell.gitGateway.commitCalls).toHaveLength(1);
    expect(shell.gitGateway.historyCalls).toHaveLength(0);
  });

  it("does not reload after a failed commit", async () => {
    const shell = await openGit();
    await expand(shell);
    shell.gitGateway.failure = { kind: "gitTimeout", detail: "x" };
    await commit(shell);
    expect(shell.gitGateway.historyCalls).toHaveLength(1);
  });

  it("keeps the commit outcome when the history reload fails", async () => {
    const shell = await openGit();
    await expand(shell);
    shell.gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    await commit(shell);
    expect(shell.uiStateStore.getState().gitCommitMessage).toBe("");
    const operations = shell.uiStateStore
      .getState()
      .operationErrors.map((error) => error.operation);
    expect(operations).toEqual(["loadGitHistory"]);
  });
});

describe("Project change", () => {
  it("drops the old history and ignores a late answer", async () => {
    const shell = await openGit();
    const hold = shell.gitGateway.holdNextHistory();
    await shell.user.click(toggle());
    await act(async () => {
      await shell.actions.closeProject();
      await settle();
    });
    await release(hold);
    expect(shell.gitController.store.getState().history).toBeNull();

    await act(async () => {
      await shell.actions.openProjectViaDialog();
      await settle();
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("first")).toBeNull();
  });
});
