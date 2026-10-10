import { describe, expect, it } from "vitest";
import type { GitStatus } from "../../application/ports/git-gateway";
import { settle } from "../../application/test-support/fakes";
import {
  type ActionsHarness,
  openedActionsHarness,
} from "../workspace/test-support/actions-harness";
import { setGitCommitMessage } from "../workspace/ui-state/shell-ui-state";
import { runGitCommit, runUndoLastCommit } from "./git-commit-flow";

const MESSAGE = "feat: x";
const UPSTREAM = "origin/main";

const STAGED_STATUS: GitStatus = {
  repositoryState: "ready",
  branch: {
    head: "main",
    oid: "a".repeat(40),
    upstream: UPSTREAM,
    ahead: 1,
    behind: 0,
    headPushed: false,
  },
  files: [
    {
      path: "a.md",
      indexStatus: "modified",
      worktreeStatus: "unmodified",
      originalPath: null,
    },
  ],
};

async function opened(status: GitStatus = STAGED_STATUS) {
  const harness = await openedActionsHarness();
  harness.gitGateway.status = status;
  await harness.gitController.refreshGitStatus();
  return harness;
}

function draft(harness: ActionsHarness, message: string): void {
  harness.uiStateStore.setState((state) => setGitCommitMessage(state, message));
}

const draftOf = (harness: ActionsHarness) =>
  harness.uiStateStore.getState().gitCommitMessage;

const request = (
  overrides: Partial<Parameters<typeof runGitCommit>[1]> = {},
) => ({
  amend: false,
  stageAll: false,
  followUp: "none" as const,
  remote: null,
  ...overrides,
});

describe("runGitCommit", () => {
  it("commits the draft and clears it", async () => {
    const harness = await opened();
    draft(harness, MESSAGE);

    expect(await runGitCommit(harness.services, request())).toBe("done");

    expect(harness.gitGateway.commitCalls).toMatchObject([
      { message: MESSAGE, options: { amend: false, stageAll: false } },
    ]);
    expect(draftOf(harness)).toBe("");
    expect(harness.gitGateway.pushCalls).toEqual([]);
  });

  it("skips a blank draft and a commit without staged changes", async () => {
    const harness = await opened();
    expect(await runGitCommit(harness.services, request())).toBe("skipped");
    draft(harness, MESSAGE);
    harness.gitGateway.status = { ...STAGED_STATUS, files: [] };
    await harness.gitController.refreshGitStatus();
    expect(await runGitCommit(harness.services, request())).toBe("skipped");
    expect(harness.gitGateway.commitCalls).toEqual([]);
  });

  it("passes the options through; stageAll needs no staged change", async () => {
    const harness = await opened({ ...STAGED_STATUS, files: [] });
    draft(harness, MESSAGE);

    await runGitCommit(harness.services, request({ stageAll: true }));

    expect(harness.gitGateway.commitCalls[0]?.options).toEqual({
      amend: false,
      stageAll: true,
    });
  });

  it("amends with a blank draft by passing the blank message", async () => {
    const harness = await opened({ ...STAGED_STATUS, files: [] });

    expect(await runGitCommit(harness.services, request({ amend: true }))).toBe(
      "done",
    );

    expect(harness.gitGateway.commitCalls).toMatchObject([
      { message: "", options: { amend: true, stageAll: false } },
    ]);
  });

  it("keeps the draft and stops the chain when the commit fails", async () => {
    const harness = await opened();
    draft(harness, MESSAGE);
    harness.gitGateway.failure = { kind: "gitCommitRejected", detail: "x" };

    const outcome = await runGitCommit(
      harness.services,
      request({ followUp: "push" }),
    );

    expect(outcome).toBe("failed");
    expect(draftOf(harness)).toBe(MESSAGE);
    expect(harness.gitGateway.pushCalls).toEqual([]);
    expect(harness.gitGateway.publishCalls).toEqual([]);
  });

  it("pushes after the commit", async () => {
    const harness = await opened();
    draft(harness, MESSAGE);

    expect(
      await runGitCommit(harness.services, request({ followUp: "push" })),
    ).toBe("done");
    expect(harness.gitGateway.pushCalls).toHaveLength(1);
  });

  it("publishes to the remote when there is no upstream", async () => {
    const harness = await opened({
      ...STAGED_STATUS,
      branch: {
        head: "main",
        oid: "a".repeat(40),
        upstream: null,
        ahead: null,
        behind: null,
        headPushed: false,
      },
    });
    draft(harness, MESSAGE);

    const outcome = await runGitCommit(
      harness.services,
      request({ followUp: "push", remote: "origin" }),
    );

    expect(outcome).toBe("done");
    expect(harness.gitGateway.pushCalls).toEqual([]);
    expect(harness.gitGateway.publishCalls.map((c) => c.remote)).toEqual([
      "origin",
    ]);
  });

  it("pulls then pushes for sync", async () => {
    const harness = await opened();
    draft(harness, MESSAGE);

    await runGitCommit(harness.services, request({ followUp: "sync" }));

    expect(harness.gitGateway.pullCalls).toHaveLength(1);
    expect(harness.gitGateway.pushCalls).toHaveLength(1);
  });

  it("keeps the committed state when the push fails", async () => {
    const harness = await opened();
    draft(harness, MESSAGE);
    harness.gitGateway.pushResult = null;
    const original = harness.gitGateway.push;
    harness.gitGateway.push = async (projectId) => {
      harness.gitGateway.failure = { kind: "gitPushRejected", detail: "x" };
      const answer = await original(projectId);
      harness.gitGateway.failure = null;
      return answer;
    };

    const outcome = await runGitCommit(
      harness.services,
      request({ followUp: "push" }),
    );

    expect(outcome).toBe("failed");
    expect(draftOf(harness)).toBe("");
  });

  it("does not clear a draft edited meanwhile", async () => {
    const harness = await opened();
    draft(harness, MESSAGE);
    const release = harness.gitGateway.holdNextCommit();

    const pending = runGitCommit(harness.services, request());
    await settle();
    draft(harness, "something else");
    release();
    await pending;

    expect(draftOf(harness)).toBe("something else");
  });
});

describe("runUndoLastCommit", () => {
  it("puts the trimmed message into a blank draft", async () => {
    const harness = await opened();
    harness.gitGateway.undoResult = {
      message: "old message\n\n",
      status: { outcome: "updated", status: STAGED_STATUS },
    };

    expect(await runUndoLastCommit(harness.services)).toBe("done");

    expect(draftOf(harness)).toBe("old message");
  });

  it("leaves a draft the user has written", async () => {
    const harness = await opened();
    draft(harness, "mine");

    await runUndoLastCommit(harness.services);

    expect(draftOf(harness)).toBe("mine");
  });

  it("leaves the draft when the message is unknown", async () => {
    const harness = await opened();
    harness.gitGateway.undoResult = {
      message: null,
      status: { outcome: "updated", status: STAGED_STATUS },
    };

    await runUndoLastCommit(harness.services);

    expect(draftOf(harness)).toBe("");
  });

  it("returns failed and leaves the draft on failure", async () => {
    const harness = await opened();
    harness.gitGateway.failure = { kind: "gitCannotUndoCommit", detail: "x" };

    expect(await runUndoLastCommit(harness.services)).toBe("failed");
    expect(draftOf(harness)).toBe("");
  });
});
