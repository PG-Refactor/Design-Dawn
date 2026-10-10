import { describe, expect, it } from "vitest";
import { GATEWAY_METHOD_KINDS } from "../../application/git/project-write-signal";
import type { GitStatus } from "../../application/ports/git-gateway";
import { CLEAN_GIT_STATUS } from "../../application/test-support/fake-git";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
  type ActionsHarness,
  makeDocumentADirty,
  openedActionsHarness,
} from "../workspace/test-support/actions-harness";
import { openDiffPinned } from "./git-diff-session";
import {
  runGitFetch,
  runGitPull,
  runGitPush,
  runGitSync,
} from "./git-remote-flow";

const OLD_OID = "a".repeat(40);
const NEW_OID = "b".repeat(40);
const UPSTREAM = "origin/main";

function statusAt(oid: string, upstream: string | null): GitStatus {
  return {
    repositoryState: "ready",
    branch: {
      head: "main",
      oid,
      upstream,
      ahead: upstream === null ? null : 0,
      behind: upstream === null ? null : 1,
      headPushed: false,
    },
    files: [],
  };
}

const WRITE_METHOD_NAMES: readonly string[] = Object.entries(
  GATEWAY_METHOD_KINDS,
)
  .filter(([, kind]) => kind === "write")
  .map(([name]) => name);

function writesOf(harness: ActionsHarness): string[] {
  return harness.gateway.methods(...WRITE_METHOD_NAMES);
}

async function openedWithStatus(status: GitStatus): Promise<ActionsHarness> {
  const harness = await openedActionsHarness();
  await harness.actions.openDocument(DOCUMENT_A);
  await harness.actions.openDocument(DOCUMENT_B);
  await harness.actions.openDocument(DOCUMENT_A);
  harness.gitGateway.status = status;
  await harness.gitController.refreshGitStatus();
  return harness;
}

const openIds = (harness: ActionsHarness) => [
  ...harness.store.getState().documents.keys(),
];

function errorLabels(harness: ActionsHarness): string[] {
  return harness.uiStateStore
    .getState()
    .operationErrors.map((entry) => entry.operation);
}

describe("runGitFetch", () => {
  it("fetches and retargets the diff tabs", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    openDiffPinned(harness.services, { path: "gone.md", side: "unstaged" });
    await settle();

    const outcome = await runGitFetch(harness.services);

    expect(outcome).toBe("done");
    expect(harness.gitGateway.fetchCalls).toHaveLength(1);
    // The status lists no such file, so the tab is closed.
    expect(harness.uiStateStore.getState().diffTabs).toEqual([]);
  });

  it("reports a failure and returns failed", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    harness.gitGateway.failure = { kind: "gitNoRemote", detail: "none" };

    expect(await runGitFetch(harness.services)).toBe("failed");
    expect(errorLabels(harness)).toContain("fetchGit");
  });
});

describe("runGitPush", () => {
  it("pushes when there is an upstream", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));

    expect(await runGitPush(harness.services, "origin")).toBe("done");
    expect(harness.gitGateway.pushCalls).toHaveLength(1);
    expect(harness.gitGateway.publishCalls).toEqual([]);
  });

  it("publishes to the given remote when there is no upstream", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, null));

    expect(await runGitPush(harness.services, "origin")).toBe("done");
    expect(harness.gitGateway.pushCalls).toEqual([]);
    expect(harness.gitGateway.publishCalls.map((c) => c.remote)).toEqual([
      "origin",
    ]);
  });

  it("asks for a remote and does nothing without upstream and remote", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, null));

    expect(await runGitPush(harness.services, null)).toBe("remoteRequired");
    expect(harness.gitGateway.pushCalls).toEqual([]);
    expect(harness.gitGateway.publishCalls).toEqual([]);
  });

  it("returns failed and reports pushGit", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    harness.gitGateway.failure = { kind: "gitPushRejected", detail: "x" };

    expect(await runGitPush(harness.services, null)).toBe("failed");
    expect(errorLabels(harness)).toContain("pushGit");
  });
});

describe("runGitPull", () => {
  function pullMovesHead(harness: ActionsHarness): void {
    harness.gitGateway.pullResult = {
      status: { outcome: "updated", status: statusAt(NEW_OID, UPSTREAM) },
    };
  }

  it("does not reload anything when HEAD did not move", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    harness.gateway.clearCalls();

    expect(await runGitPull(harness.services)).toBe("done");

    expect(harness.gitGateway.pullCalls).toHaveLength(1);
    expect(harness.gateway.methods()).toEqual([]);
    expect(openIds(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
  });

  it("saves unsaved changes before pulling", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    await makeDocumentADirty(harness);
    harness.gateway.clearCalls();
    const release = harness.gitGateway.holdNextRemote();

    const pending = runGitPull(harness.services);
    await settle();

    // Held inside git: the save already happened.
    expect(harness.gitGateway.pullCalls).toHaveLength(1);
    expect(writesOf(harness).length).toBeGreaterThan(0);
    release();
    await pending;
  });

  it("does not pull when the save fails", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    await makeDocumentADirty(harness);
    harness.gateway.failAlways("saveSheet", "ioError");
    harness.gateway.failAlways("saveDocument", "ioError");

    expect(await runGitPull(harness.services)).toBe("failed");

    expect(harness.gitGateway.pullCalls).toEqual([]);
    expect(harness.uiStateStore.getState().busy).toBe(false);
  });

  it("reloads the Project and reopens Documents and view when HEAD moved", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A1);
    pullMovesHead(harness);
    harness.gateway.clearCalls();

    expect(await runGitPull(harness.services)).toBe("done");

    expect(harness.gateway.methods("reloadProject")).toEqual(["reloadProject"]);
    expect(harness.gateway.methods("closeDocument")).toHaveLength(2);
    expect(harness.gateway.methods("loadDocument")).toHaveLength(2);
    expect(openIds(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_A);
    expect(harness.uiStateStore.getState().busy).toBe(false);
  });

  it("writes nothing between the pull and the reload", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    await makeDocumentADirty(harness);
    pullMovesHead(harness);
    const release = harness.gitGateway.holdNextRemote();
    const pending = runGitPull(harness.services);
    await settle();
    // Saved and held inside git: from here on nothing may be written.
    harness.gateway.clearCalls();
    release();
    await pending;

    expect(harness.gateway.methods("reloadProject")).toEqual(["reloadProject"]);
    expect(writesOf(harness)).toEqual([]);
  });

  it("reloads after a conflicted pull although HEAD did not move", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    harness.gitGateway.failure = { kind: "gitPullConflicts", detail: "x" };
    const original = harness.gitGateway.pull;
    harness.gitGateway.pull = async (projectId) => {
      const answer = await original(projectId);
      harness.gitGateway.failure = null;
      return answer;
    };
    harness.gateway.clearCalls();

    expect(await runGitPull(harness.services)).toBe("failed");

    expect(errorLabels(harness)).toContain("pullGit");
    expect(harness.gateway.methods("reloadProject")).toEqual(["reloadProject"]);
    expect(writesOf(harness)).toEqual([]);
    expect(openIds(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
  });

  it("does not reload after another failed pull", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    harness.gitGateway.failure = {
      kind: "gitPullBlockedByLocalChanges",
      detail: "x",
    };
    const original = harness.gitGateway.pull;
    harness.gitGateway.pull = async (projectId) => {
      const answer = await original(projectId);
      harness.gitGateway.failure = null;
      return answer;
    };
    harness.gateway.clearCalls();

    expect(await runGitPull(harness.services)).toBe("failed");
    expect(harness.gateway.methods("reloadProject")).toEqual([]);
  });

  it("restores the diff tabs the reload cleared", async () => {
    const withFile = (oid: string): GitStatus => ({
      ...statusAt(oid, UPSTREAM),
      files: [
        {
          path: "kept.md",
          indexStatus: "unmodified",
          worktreeStatus: "modified",
          originalPath: null,
        },
      ],
    });
    const harness = await openedWithStatus(withFile(OLD_OID));
    openDiffPinned(harness.services, { path: "kept.md", side: "unstaged" });
    await settle();
    harness.gitGateway.pullResult = {
      status: { outcome: "updated", status: withFile(NEW_OID) },
    };

    await runGitPull(harness.services);

    expect(harness.uiStateStore.getState().diffTabs.map((t) => t.path)).toEqual(
      ["kept.md"],
    );
    expect(harness.uiStateStore.getState().activeMainTab.kind).toBe("diff");
  });

  it("ignores a second call while busy", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    const release = harness.gitGateway.holdNextRemote();

    const first = runGitPull(harness.services);
    await settle();
    expect(harness.uiStateStore.getState().busy).toBe(true);
    expect(await runGitPull(harness.services)).toBe("skipped");
    release();
    await first;

    expect(harness.gitGateway.pullCalls).toHaveLength(1);
  });

  it("does nothing without a Project", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.closeProject();
    harness.gitGateway.status = CLEAN_GIT_STATUS;

    expect(await runGitPull(harness.services)).toBe("skipped");
    expect(harness.gitGateway.pullCalls).toEqual([]);
  });
});

describe("runGitSync", () => {
  it("pushes after a successful pull", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));

    expect(await runGitSync(harness.services)).toBe("done");
    expect(harness.gitGateway.pullCalls).toHaveLength(1);
    expect(harness.gitGateway.pushCalls).toHaveLength(1);
    expect(harness.uiStateStore.getState().busy).toBe(false);
  });

  it("does not push when the pull fails", async () => {
    const harness = await openedWithStatus(statusAt(OLD_OID, UPSTREAM));
    harness.gitGateway.failure = { kind: "gitPullConflicts", detail: "x" };

    expect(await runGitSync(harness.services)).toBe("failed");
    expect(harness.gitGateway.pushCalls).toEqual([]);
  });
});
