import { describe, expect, it } from "vitest";
import { HISTORY_PAGE_SIZE } from "../../config/git-config";
import { DOCUMENT_ID, PROJECT_ID } from "../../domain/shared/test-fixtures";
import type { GitDiff, GitHistoryPage, GitStatus } from "../ports/git-gateway";
import type { OperationError } from "../ports/operation-error";
import {
  CLEAN_GIT_STATUS,
  createFakeGitGateway,
} from "../test-support/fake-git";
import { settle } from "../test-support/fakes";
import {
  createWorkspaceHarness,
  openedWorkspace,
  SELECTION_ID,
} from "../test-support/workspace-harness";
import { createGitController, type GitOperationLabel } from "./git-controller";

const MODIFIED_STATUS: GitStatus = {
  repositoryState: "ready",
  branch: null,
  files: [
    {
      path: "project.json",
      indexStatus: "unmodified",
      worktreeStatus: "modified",
      originalPath: null,
    },
  ],
};

function setup() {
  const harness = createWorkspaceHarness();
  const gitGateway = createFakeGitGateway();
  const failures: OperationError[] = [];
  const failureLabels: GitOperationLabel[] = [];
  const controller = createGitController({
    gateway: gitGateway,
    applicationStore: harness.store,
    reportFailure: (operation, error) => {
      failureLabels.push(operation);
      failures.push(error);
    },
  });
  return { ...harness, gitGateway, controller, failures, failureLabels };
}

describe("following the open Project", () => {
  it("has no status and does not call git without a Project", async () => {
    const { controller, gitGateway } = setup();

    expect(controller.store.getState()).toEqual({
      projectId: null,
      status: null,
      statusError: null,
      refreshing: false,
      operating: false,
      runningOperation: null,
      diff: null,
      history: null,
      historyError: null,
      lastCommit: null,
    });
    expect(await controller.refreshGitStatus()).toEqual({
      ok: true,
      value: undefined,
    });
    expect(gitGateway.calls).toEqual([]);
  });

  it("refreshes once the Project is installed", async () => {
    const { workspace, gitGateway, controller } = setup();
    gitGateway.status = MODIFIED_STATUS;

    await workspace.openProject(SELECTION_ID);
    await settle();

    expect(gitGateway.calls).toEqual([PROJECT_ID]);
    expect(controller.store.getState()).toEqual({
      projectId: PROJECT_ID,
      status: MODIFIED_STATUS,
      statusError: null,
      refreshing: false,
      operating: false,
      runningOperation: null,
      diff: null,
      history: null,
      historyError: null,
      lastCommit: null,
    });
  });

  it("starts from the Project that is already open", async () => {
    const harness = await openedWorkspace();
    const gitGateway = createFakeGitGateway();

    const controller = createGitController({
      gateway: gitGateway,
      applicationStore: harness.store,
      reportFailure: () => undefined,
    });
    await settle();

    expect(controller.store.getState().status).toEqual(CLEAN_GIT_STATUS);
  });

  it("drops the status when the Project is closed", async () => {
    const { workspace, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();

    await workspace.closeProject();

    expect(controller.store.getState()).toEqual({
      projectId: null,
      status: null,
      statusError: null,
      refreshing: false,
      operating: false,
      runningOperation: null,
      diff: null,
      history: null,
      historyError: null,
      lastCommit: null,
    });
  });

  it("does not touch the Project's files or the application state", async () => {
    const { workspace, gateway, gitGateway, store } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const stateAfterOpen = store.getState();
    gateway.clearCalls();

    await gitGateway.gitStatus(PROJECT_ID);

    expect(gateway.calls).toEqual([]);
    expect(store.getState()).toBe(stateAfterOpen);
  });
});

describe("refreshGitStatus", () => {
  it("reads the status again on demand", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = MODIFIED_STATUS;

    const result = await controller.refreshGitStatus();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(gitGateway.calls).toHaveLength(2);
    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
  });

  it("shows refreshing while the request is open", async () => {
    const { workspace, gitGateway, controller } = setup();
    const release = gitGateway.holdNextCall();

    await workspace.openProject(SELECTION_ID);
    await settle();
    expect(controller.store.getState().refreshing).toBe(true);
    release();
    await settle();

    expect(controller.store.getState().refreshing).toBe(false);
  });

  it("records a failure, clears the stale status and reports it", async () => {
    const { workspace, gitGateway, controller, failures } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "gitTimeout", detail: "slow" };

    const result = await controller.refreshGitStatus();

    expect(!result.ok && result.error.kind).toBe("gitTimeout");
    expect(failures).toEqual([{ kind: "gitTimeout", detail: "slow" }]);
    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().refreshing).toBe(false);
  });

  it("reports a rejecting gateway as an error result", async () => {
    const { workspace, gitGateway, controller, failures } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.gitStatus = () => Promise.reject(new Error("boom"));

    const result = await controller.refreshGitStatus();

    expect(!result.ok && result.error.kind).toBe("unexpectedCommandError");
    expect(failures).toHaveLength(1);
  });

  it("runs a refresh requested meanwhile after the open one, newest answer wins", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = CLEAN_GIT_STATUS;
    const releaseOlder = gitGateway.holdNextCall();
    const older = controller.refreshGitStatus();
    gitGateway.status = MODIFIED_STATUS;
    const newer = controller.refreshGitStatus();

    releaseOlder();
    await older;
    await newer;

    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
  });

  it("shares one waiting refresh between callers", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.calls.length = 0;
    const release = gitGateway.holdNextCall();
    const running = controller.refreshGitStatus();
    await settle();
    const waitingA = controller.refreshGitStatus();
    const waitingB = controller.refreshGitStatus();

    release();
    await Promise.all([running, waitingA, waitingB]);

    expect(gitGateway.calls).toHaveLength(2);
  });

  it("does not apply an answer for a Project that was closed meanwhile", async () => {
    const { workspace, gitGateway, controller } = setup();
    const release = gitGateway.holdNextCall();
    await workspace.openProject(SELECTION_ID);
    await settle();

    await workspace.closeProject();
    release();
    await settle();

    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().projectId).toBeNull();
  });
});

describe("statusError", () => {
  it("is null before the first refresh and while it runs", async () => {
    const { workspace, gitGateway, controller } = setup();
    expect(controller.store.getState().statusError).toBeNull();
    const release = gitGateway.holdNextCall();

    await workspace.openProject(SELECTION_ID);
    await settle();
    expect(controller.store.getState().refreshing).toBe(true);
    expect(controller.store.getState().statusError).toBeNull();
    release();
    await settle();

    expect(controller.store.getState().statusError).toBeNull();
  });

  it("is set with the kind after a failed refresh and cleared by a later success", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "gitTimeout", detail: "slow" };

    await controller.refreshGitStatus();
    expect(controller.store.getState().statusError).toBe("gitTimeout");
    expect(controller.store.getState().status).toBeNull();

    gitGateway.failure = null;
    await controller.refreshGitStatus();
    expect(controller.store.getState().statusError).toBeNull();
    expect(controller.store.getState().status).toEqual(CLEAN_GIT_STATUS);
  });

  it("is set when the first refresh of a Project fails", async () => {
    const { workspace, gitGateway, controller } = setup();
    gitGateway.failure = { kind: "gitNotReady", detail: "no git" };

    await workspace.openProject(SELECTION_ID);
    await settle();

    expect(controller.store.getState().statusError).toBe("gitNotReady");
  });

  it("is set when the refresh after a failed stage fails, and cleared by a successful stage", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "gitCommandFailed", detail: "boom" };

    await controller.stage(["project.json"]);
    expect(controller.store.getState().statusError).toBe("gitCommandFailed");

    gitGateway.failure = null;
    gitGateway.status = MODIFIED_STATUS;
    await controller.stage(["project.json"]);
    expect(controller.store.getState().statusError).toBeNull();
    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
  });

  it("is set when a commit's status is unavailable, and cleared by a refresh", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.commitResult = {
      commitId: "0123456789abcdef0123456789abcdef01234567",
      status: { outcome: "unavailable", errorKind: "gitTimeout" },
    };

    await controller.commit("message");
    expect(controller.store.getState().statusError).toBe("gitTimeout");

    await controller.refreshGitStatus();
    expect(controller.store.getState().statusError).toBeNull();
  });

  it("is reset by a Project change and not carried over", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "gitTimeout", detail: "slow" };
    await controller.refreshGitStatus();
    expect(controller.store.getState().statusError).toBe("gitTimeout");
    const release = gitGateway.holdNextCall();

    await workspace.closeProject();
    expect(controller.store.getState().statusError).toBeNull();
    gitGateway.failure = null;
    await workspace.openProject(SELECTION_ID);
    await settle();

    expect(controller.store.getState().statusError).toBeNull();
    release();
  });

  it("is not set by a stale failed refresh answering after a Project switch", async () => {
    const { workspace, gitGateway, controller } = setup();
    gitGateway.failure = { kind: "gitTimeout", detail: "slow" };
    const release = gitGateway.holdNextCall();
    await workspace.openProject(SELECTION_ID);
    await settle();

    await workspace.closeProject();
    gitGateway.failure = null;
    await workspace.openProject(SELECTION_ID);
    await settle();
    release();
    await settle();

    const state = controller.store.getState();
    expect(state.statusError).toBeNull();
    expect(state.status).toEqual(CLEAN_GIT_STATUS);
  });
});

describe("discard", () => {
  const PATHS = ["project.json"];

  it("replaces the status by the returned one and does not read it again", async () => {
    const { workspace, gitGateway, controller } = setup();
    gitGateway.status = MODIFIED_STATUS;
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = CLEAN_GIT_STATUS;

    const result = await controller.discard(PATHS);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(controller.store.getState().status).toEqual(CLEAN_GIT_STATUS);
    expect(controller.store.getState().operating).toBe(false);
    expect(gitGateway.discardCalls).toEqual([
      { projectId: PROJECT_ID, paths: PATHS },
    ]);
    expect(gitGateway.calls).toHaveLength(1);
  });

  it("does nothing without a Project", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.discard(PATHS)).toEqual({
      ok: true,
      value: undefined,
    });

    expect(gitGateway.discardCalls).toEqual([]);
  });

  it("reports a failure as discardGitChanges, then reads the status again", async () => {
    const { workspace, gitGateway, controller, failures, failureLabels } =
      setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.calls.length = 0;
    gitGateway.nextDiscardResult = {
      ok: false,
      error: { kind: "gitDiscardRejected", detail: "no" },
    };
    gitGateway.status = MODIFIED_STATUS;

    const result = await controller.discard(PATHS);

    expect(!result.ok && result.error.kind).toBe("gitDiscardRejected");
    expect(failureLabels).toEqual(["discardGitChanges"]);
    expect(failures).toEqual([{ kind: "gitDiscardRejected", detail: "no" }]);
    expect(gitGateway.calls).toHaveLength(1);
    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
    expect(controller.store.getState().operating).toBe(false);
  });

  it("labels a rejecting gateway", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.discard = () => Promise.reject(new Error("boom"));

    const result = await controller.discard(PATHS);

    expect(!result.ok && result.error.kind).toBe("unexpectedCommandError");
    expect(failureLabels).toEqual(["discardGitChanges"]);
    expect(gitGateway.calls).toHaveLength(2);
  });

  it("ignores an answer that arrives after the Project was closed", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const release = gitGateway.holdNextDiscard();
    const pending = controller.discard(PATHS);
    await settle();
    expect(controller.store.getState().operating).toBe(true);

    await workspace.closeProject();
    release();
    await pending;

    expect(controller.store.getState().projectId).toBeNull();
    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().operating).toBe(false);
    expect(failureLabels).toEqual([]);
  });

  it("runs after a pending stage, not alongside it", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const releaseStage = gitGateway.holdNextStage();

    const staging = controller.stage(PATHS);
    const discarding = controller.discard(PATHS);
    await settle();
    expect(gitGateway.stageCalls).toHaveLength(1);
    expect(gitGateway.discardCalls).toHaveLength(0);
    releaseStage();
    await Promise.all([staging, discarding]);

    expect(gitGateway.discardCalls).toHaveLength(1);
  });

  it("passes the impact request through for the open Project", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.impactResult = {
      documentIds: [DOCUMENT_ID],
      projectFilesAffected: true,
    };

    const result = await controller.discardImpact(PATHS);

    expect(result).toEqual({ ok: true, value: gitGateway.impactResult });
    expect(gitGateway.discardImpactCalls).toEqual([
      { projectId: PROJECT_ID, paths: PATHS },
    ]);
  });

  it("answers an empty impact without a Project and reports no failure state", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.discardImpact(PATHS)).toEqual({
      ok: true,
      value: { documentIds: [], projectFilesAffected: false },
    });
    expect(gitGateway.discardImpactCalls).toEqual([]);
  });

  it("returns an impact failure as a result and a rejecting gateway as unexpectedCommandError", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "invalidGitPath", detail: "bad" };

    const failed = await controller.discardImpact(["../x"]);
    gitGateway.failure = null;
    gitGateway.discardImpact = () => Promise.reject(new Error("boom"));
    const rejected = await controller.discardImpact(PATHS);

    expect(!failed.ok && failed.error.kind).toBe("invalidGitPath");
    expect(!rejected.ok && rejected.error.kind).toBe("unexpectedCommandError");
    expect(failureLabels).toEqual([]);
    expect(controller.store.getState().operating).toBe(false);
  });
});

describe("stage / unstage", () => {
  const PATHS = ["project.json"];

  it("replaces the status by the returned one, in order, for the open Project", async () => {
    const { workspace, gitGateway, controller } = setup();
    gitGateway.status = MODIFIED_STATUS;
    await workspace.openProject(SELECTION_ID);
    await settle();
    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
    const staged: GitStatus = {
      repositoryState: "ready",
      branch: null,
      files: [
        {
          path: "project.json",
          indexStatus: "modified",
          worktreeStatus: "unmodified",
          originalPath: null,
        },
      ],
    };
    gitGateway.status = staged;

    const stageResult = await controller.stage(PATHS);
    expect(stageResult).toEqual({ ok: true, value: undefined });
    expect(controller.store.getState().status).toEqual(staged);

    gitGateway.status = MODIFIED_STATUS;
    await controller.unstage(PATHS);
    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);

    expect(gitGateway.stageCalls).toEqual([
      { projectId: PROJECT_ID, paths: PATHS },
    ]);
    expect(gitGateway.unstageCalls).toEqual([
      { projectId: PROJECT_ID, paths: PATHS },
    ]);
    expect(controller.store.getState().operating).toBe(false);
    // Only the refresh at install: Stage / Unstage did not read the status separately.
    expect(gitGateway.calls).toHaveLength(1);
  });

  it("does nothing without a Project", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.stage(PATHS)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await controller.unstage(PATHS)).toEqual({
      ok: true,
      value: undefined,
    });

    expect(gitGateway.stageCalls).toEqual([]);
    expect(gitGateway.unstageCalls).toEqual([]);
  });

  it("reports a stage failure, then reads the status again", async () => {
    const { workspace, gitGateway, controller, failures, failureLabels } =
      setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.calls.length = 0;
    gitGateway.failure = { kind: "gitCommandFailed", detail: "boom" };
    const releaseStatusFailure = () => {
      gitGateway.failure = null;
      gitGateway.status = MODIFIED_STATUS;
    };
    const original = gitGateway.stage;
    gitGateway.stage = async (projectId, paths) => {
      const result = await original(projectId, paths);
      // git may have changed the index partly; the following read succeeds.
      releaseStatusFailure();
      return result;
    };

    const result = await controller.stage(PATHS);

    expect(!result.ok && result.error.kind).toBe("gitCommandFailed");
    expect(failureLabels).toEqual(["stageGitFiles"]);
    expect(failures).toEqual([{ kind: "gitCommandFailed", detail: "boom" }]);
    expect(gitGateway.calls).toHaveLength(1);
    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
    expect(controller.store.getState().operating).toBe(false);
  });

  it("labels an unstage failure and rejecting gateways", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.unstage = () => Promise.reject(new Error("boom"));

    const result = await controller.unstage(PATHS);

    expect(!result.ok && result.error.kind).toBe("unexpectedCommandError");
    expect(failureLabels).toEqual(["unstageGitFiles"]);
    expect(gitGateway.calls).toHaveLength(2);
  });

  it("ignores a stage answer that arrives after the Project was closed", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const original = gitGateway.stage;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    gitGateway.stage = async (projectId, paths) => {
      await held;
      return original(projectId, paths);
    };
    gitGateway.status = MODIFIED_STATUS;
    const pending = controller.stage(PATHS);
    await settle();
    expect(controller.store.getState().operating).toBe(true);

    await workspace.closeProject();
    release();
    await pending;

    expect(controller.store.getState()).toEqual({
      projectId: null,
      status: null,
      statusError: null,
      refreshing: false,
      operating: false,
      runningOperation: null,
      diff: null,
      history: null,
      historyError: null,
      lastCommit: null,
    });
  });

  it("runs concurrent stage, unstage and refresh one after another", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.calls.length = 0;
    const events: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalStage = gitGateway.stage;
    const originalUnstage = gitGateway.unstage;
    const originalStatus = gitGateway.gitStatus;
    gitGateway.stage = async (projectId, paths) => {
      events.push("stage:start");
      await held;
      events.push("stage:end");
      return originalStage(projectId, paths);
    };
    gitGateway.unstage = async (projectId, paths) => {
      events.push("unstage:start");
      const result = await originalUnstage(projectId, paths);
      events.push("unstage:end");
      return result;
    };
    gitGateway.gitStatus = async (projectId) => {
      events.push("status");
      return originalStatus(projectId);
    };

    const all = Promise.all([
      controller.stage(PATHS),
      controller.unstage(PATHS),
      controller.refreshGitStatus(),
    ]);
    await settle();
    expect(events).toEqual(["stage:start"]);
    release();
    await all;

    expect(events).toEqual([
      "stage:start",
      "stage:end",
      "unstage:start",
      "unstage:end",
      "status",
    ]);
  });

  it("neither saves the workspace nor touches the undo history", async () => {
    const { workspace, gateway, gitGateway, store, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const stateBefore = store.getState();
    gateway.clearCalls();

    await controller.stage(PATHS);
    await controller.unstage(PATHS);
    gitGateway.failure = { kind: "gitCommandFailed", detail: "x" };
    await controller.stage(PATHS);

    expect(gateway.calls).toEqual([]);
    expect(store.getState()).toBe(stateBefore);
  });
});

describe("loadDiff", () => {
  const PATH = "project.json";
  const UNSTAGED_DIFF: GitDiff = {
    path: PATH,
    side: "unstaged",
    outcome: "text",
    diff: "unstaged text",
  };
  const STAGED_DIFF: GitDiff = {
    path: PATH,
    side: "staged",
    outcome: "text",
    diff: "staged text",
  };

  async function openedSetup() {
    const context = setup();
    await context.workspace.openProject(SELECTION_ID);
    await settle();
    return context;
  }

  it("does nothing without a Project", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.loadDiff(PATH, "unstaged")).toEqual({
      ok: true,
      value: undefined,
    });

    expect(gitGateway.diffCalls).toEqual([]);
    expect(controller.store.getState().diff).toBeNull();
  });

  it("shows loading, then the loaded result, and sends the requested side", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.diffs = {
      [`unstaged:${PATH}`]: UNSTAGED_DIFF,
      [`staged:${PATH}`]: STAGED_DIFF,
    };
    const release = gitGateway.holdNextDiff();

    const pending = controller.loadDiff(PATH, "unstaged");
    expect(controller.store.getState().diff).toEqual({
      path: PATH,
      side: "unstaged",
      status: "loading",
    });
    release();
    await pending;
    expect(controller.store.getState().diff).toEqual({
      path: PATH,
      side: "unstaged",
      status: "loaded",
      result: UNSTAGED_DIFF,
    });

    await controller.loadDiff(PATH, "staged");
    expect(controller.store.getState().diff).toEqual({
      path: PATH,
      side: "staged",
      status: "loaded",
      result: STAGED_DIFF,
    });
    expect(gitGateway.diffCalls).toEqual([
      { projectId: PROJECT_ID, path: PATH, side: "unstaged" },
      { projectId: PROJECT_ID, path: PATH, side: "staged" },
    ]);
  });

  it("keeps only the latest request even when an older one answers later", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.diffs = {
      [`unstaged:${PATH}`]: UNSTAGED_DIFF,
      [`staged:${PATH}`]: STAGED_DIFF,
    };
    const releaseFirst = gitGateway.holdNextDiff();
    const first = controller.loadDiff(PATH, "unstaged");
    await settle();
    const second = controller.loadDiff(PATH, "staged");

    releaseFirst();
    await Promise.all([first, second]);

    expect(controller.store.getState().diff).toEqual({
      path: PATH,
      side: "staged",
      status: "loaded",
      result: STAGED_DIFF,
    });
  });

  it("drops a result that arrives after the Project was closed", async () => {
    const { workspace, gitGateway, controller, failures } = await openedSetup();
    gitGateway.diffs = { [`unstaged:${PATH}`]: UNSTAGED_DIFF };
    const release = gitGateway.holdNextDiff();
    const pending = controller.loadDiff(PATH, "unstaged");
    await settle();

    await workspace.closeProject();
    release();
    await pending;

    expect(controller.store.getState().diff).toBeNull();
    expect(failures).toEqual([]);
  });

  it("reports a failure and clears the diff", async () => {
    const { gitGateway, controller, failures, failureLabels } =
      await openedSetup();
    await controller.loadDiff(PATH, "unstaged");
    gitGateway.failure = { kind: "gitCommandFailed", detail: "boom" };

    const result = await controller.loadDiff(PATH, "unstaged");

    expect(result.ok).toBe(false);
    expect(controller.store.getState().diff).toBeNull();
    expect(failureLabels).toEqual(["loadGitDiff"]);
    expect(failures).toEqual([{ kind: "gitCommandFailed", detail: "boom" }]);
  });

  it("reports a rejecting gateway as an error result", async () => {
    const { gitGateway, controller, failures } = await openedSetup();
    gitGateway.diff = async () => {
      throw new Error("ipc down");
    };

    const result = await controller.loadDiff(PATH, "unstaged");

    expect(result.ok).toBe(false);
    expect(controller.store.getState().diff).toBeNull();
    expect(failures).toEqual([
      { kind: "unexpectedCommandError", detail: "ipc down" },
    ]);
  });

  it.each<GitDiff>([
    { path: PATH, side: "unstaged", outcome: "empty" },
    { path: PATH, side: "unstaged", outcome: "untracked" },
    { path: PATH, side: "unstaged", outcome: "binary" },
    { path: PATH, side: "unstaged", outcome: "tooLarge", limitBytes: 1024 },
    { path: PATH, side: "unstaged", outcome: "notUtf8" },
  ])(
    "treats the $outcome outcome as a result, not a failure",
    async (outcome) => {
      const { gitGateway, controller, failures } = await openedSetup();
      gitGateway.diffs = { [`unstaged:${PATH}`]: outcome };

      await controller.loadDiff(PATH, "unstaged");

      expect(controller.store.getState().diff).toEqual({
        path: PATH,
        side: "unstaged",
        status: "loaded",
        result: outcome,
      });
      expect(failures).toEqual([]);
    },
  );

  it("clearDiff drops the diff and ignores a load in flight", async () => {
    const { gitGateway, controller } = await openedSetup();
    const release = gitGateway.holdNextDiff();
    const pending = controller.loadDiff(PATH, "unstaged");
    await settle();

    controller.clearDiff();
    release();
    await pending;

    expect(controller.store.getState().diff).toBeNull();
  });

  it("runs after a queued stage and before a later refresh", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.calls.length = 0;
    const events: string[] = [];
    const release = (() => {
      let resolve: () => void = () => undefined;
      const held = new Promise<void>((done) => {
        resolve = done;
      });
      const originalStage = gitGateway.stage;
      gitGateway.stage = async (projectId, paths) => {
        events.push("stage:start");
        await held;
        events.push("stage:end");
        return originalStage(projectId, paths);
      };
      return resolve;
    })();
    const originalDiff = gitGateway.diff;
    gitGateway.diff = async (projectId, path, side) => {
      events.push("diff");
      return originalDiff(projectId, path, side);
    };
    const originalStatus = gitGateway.gitStatus;
    gitGateway.gitStatus = async (projectId) => {
      events.push("status");
      return originalStatus(projectId);
    };

    const all = Promise.all([
      controller.stage([PATH]),
      controller.loadDiff(PATH, "unstaged"),
      controller.refreshGitStatus(),
    ]);
    await settle();
    expect(events).toEqual(["stage:start"]);
    release();
    await all;

    expect(events).toEqual(["stage:start", "stage:end", "diff", "status"]);
  });

  it("is left as is by a stage (the UI reloads it)", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.diffs = { [`unstaged:${PATH}`]: UNSTAGED_DIFF };
    await controller.loadDiff(PATH, "unstaged");
    const shown = controller.store.getState().diff;

    await controller.stage([PATH]);

    expect(controller.store.getState().diff).toBe(shown);
  });

  it("neither saves the workspace nor touches the undo history", async () => {
    const { gateway, gitGateway, store, controller } = await openedSetup();
    const stateBefore = store.getState();
    gateway.clearCalls();

    await controller.loadDiff(PATH, "unstaged");
    gitGateway.failure = { kind: "gitCommandFailed", detail: "x" };
    await controller.loadDiff(PATH, "staged");
    controller.clearDiff();

    expect(gateway.calls).toEqual([]);
    expect(store.getState()).toBe(stateBefore);
  });
});

describe("commit", () => {
  const MESSAGE = "設計を更新\n\n詳細";
  const NEW_COMMIT_ID = "abcdef0123456789abcdef0123456789abcdef01";

  it("passes the message untouched and replaces the status and lastCommit", async () => {
    const { workspace, gitGateway, controller, failures } = setup();
    gitGateway.status = MODIFIED_STATUS;
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = CLEAN_GIT_STATUS;
    gitGateway.commitResult = {
      commitId: NEW_COMMIT_ID,
      status: { outcome: "updated", status: CLEAN_GIT_STATUS },
    };

    const result = await controller.commit(MESSAGE);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(gitGateway.commitCalls).toEqual([
      {
        projectId: PROJECT_ID,
        message: MESSAGE,
        options: { amend: false, stageAll: false },
      },
    ]);
    const state = controller.store.getState();
    expect(state.status).toEqual(CLEAN_GIT_STATUS);
    expect(state.lastCommit).toEqual({ commitId: NEW_COMMIT_ID });
    expect(state.operating).toBe(false);
    expect(failures).toEqual([]);
    // Only the refresh at install: the commit did not read the status separately.
    expect(gitGateway.calls).toHaveLength(1);
  });

  it("keeps a null commit id as a success", async () => {
    const { workspace, gitGateway, controller, failures } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.commitResult = {
      commitId: null,
      status: { outcome: "updated", status: CLEAN_GIT_STATUS },
    };

    await controller.commit(MESSAGE);

    expect(controller.store.getState().lastCommit).toEqual({ commitId: null });
    expect(failures).toEqual([]);
  });

  it("does nothing without a Project", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.commit(MESSAGE)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(gitGateway.commitCalls).toEqual([]);
  });

  it("reports a status that could not be read as a refresh problem, not a commit failure", async () => {
    const { workspace, gitGateway, controller, failures, failureLabels } =
      setup();
    gitGateway.status = MODIFIED_STATUS;
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.commitResult = {
      commitId: NEW_COMMIT_ID,
      status: { outcome: "unavailable", errorKind: "gitTimeout" },
    };

    const result = await controller.commit(MESSAGE);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(failureLabels).toEqual(["refreshGitStatus"]);
    expect(failures.map((failure) => failure.kind)).toEqual(["gitTimeout"]);
    const state = controller.store.getState();
    expect(state.status).toBeNull();
    expect(state.lastCommit).toEqual({ commitId: NEW_COMMIT_ID });
    expect(state.operating).toBe(false);
    // No automatic retry.
    expect(gitGateway.calls).toHaveLength(1);
  });

  it.each([
    "invalidCommitMessage",
    "nothingToCommit",
    "gitUnmergedChanges",
    "gitOperationInProgress",
    "gitIdentityMissing",
    "gitCommitRejected",
  ] as const)(
    "reports %s as a commit failure and reads the status again",
    async (kind) => {
      const { workspace, gitGateway, controller, failures, failureLabels } =
        setup();
      await workspace.openProject(SELECTION_ID);
      await settle();
      gitGateway.calls.length = 0;
      gitGateway.failure = { kind, detail: "refused" };
      const original = gitGateway.commit;
      gitGateway.commit = async (projectId, message, options) => {
        const answer = await original(projectId, message, options);
        // Hooks may have changed the index; the following read succeeds.
        gitGateway.failure = null;
        gitGateway.status = MODIFIED_STATUS;
        return answer;
      };

      const result = await controller.commit(MESSAGE);

      expect(!result.ok && result.error.kind).toBe(kind);
      expect(failureLabels).toEqual(["commitGitChanges"]);
      expect(failures).toEqual([{ kind, detail: "refused" }]);
      expect(gitGateway.calls).toHaveLength(1);
      const state = controller.store.getState();
      expect(state.status).toEqual(MODIFIED_STATUS);
      expect(state.lastCommit).toBeNull();
      expect(state.operating).toBe(false);
    },
  );

  it("labels a rejecting gateway as a commit failure", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.commit = () => Promise.reject(new Error("boom"));

    const result = await controller.commit(MESSAGE);

    expect(!result.ok && result.error.kind).toBe("unexpectedCommandError");
    expect(failureLabels).toEqual(["commitGitChanges"]);
    expect(controller.store.getState().operating).toBe(false);
  });

  it("ignores a commit answer that arrives after the Project was closed", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const original = gitGateway.commit;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    gitGateway.commit = async (projectId, message, options) => {
      await held;
      return original(projectId, message, options);
    };
    const pending = controller.commit(MESSAGE);
    await settle();
    expect(controller.store.getState().operating).toBe(true);

    await workspace.closeProject();
    release();
    await pending;

    expect(controller.store.getState()).toEqual({
      projectId: null,
      status: null,
      statusError: null,
      refreshing: false,
      operating: false,
      runningOperation: null,
      diff: null,
      history: null,
      historyError: null,
      lastCommit: null,
    });
    expect(failureLabels).toEqual([]);
  });

  it("runs after stage and before a later refresh, one at a time", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.calls.length = 0;
    const events: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalStage = gitGateway.stage;
    const originalCommit = gitGateway.commit;
    const originalStatus = gitGateway.gitStatus;
    gitGateway.stage = async (projectId, paths) => {
      events.push("stage:start");
      await held;
      events.push("stage:end");
      return originalStage(projectId, paths);
    };
    gitGateway.commit = async (projectId, message, options) => {
      events.push("commit:start");
      const result = await originalCommit(projectId, message, options);
      events.push("commit:end");
      return result;
    };
    gitGateway.gitStatus = async (projectId) => {
      events.push("status");
      return originalStatus(projectId);
    };

    const all = Promise.all([
      controller.stage(["project.json"]),
      controller.commit(MESSAGE),
      controller.refreshGitStatus(),
    ]);
    await settle();
    expect(events).toEqual(["stage:start"]);
    release();
    await all;

    expect(events).toEqual([
      "stage:start",
      "stage:end",
      "commit:start",
      "commit:end",
      "status",
    ]);
  });

  it("neither saves the workspace nor touches the undo history", async () => {
    const { workspace, gateway, gitGateway, store, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const stateBefore = store.getState();
    gateway.clearCalls();

    await controller.commit(MESSAGE);
    gitGateway.failure = { kind: "nothingToCommit", detail: "x" };
    await controller.commit(MESSAGE);

    expect(gateway.calls).toEqual([]);
    expect(store.getState()).toBe(stateBefore);
  });
});

describe("history", () => {
  const ID_ONE = "1".repeat(40);
  const ID_TWO = "2".repeat(40);
  const ID_THREE = "3".repeat(40);
  const CURSOR_ONE = `${ID_ONE}:2`;

  function entry(commitId: string, summary: string) {
    return {
      commitId,
      parentIds: [],
      authorName: "A",
      authorEmail: "a@example.invalid",
      authorDate: "2026-01-02T03:04:05+00:00",
      summary,
    };
  }

  const FIRST_PAGE: GitHistoryPage = {
    entries: [entry(ID_ONE, "one"), entry(ID_TWO, "two")],
    nextCursor: CURSOR_ONE,
  };
  const LAST_PAGE: GitHistoryPage = {
    entries: [entry(ID_THREE, "three")],
    nextCursor: null,
  };

  async function openedSetup() {
    const context = setup();
    context.gitGateway.historyPages = [FIRST_PAGE, LAST_PAGE];
    await context.workspace.openProject(SELECTION_ID);
    await settle();
    return context;
  }

  it("does nothing without a Project", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.loadHistory()).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await controller.loadMoreHistory()).toEqual({
      ok: true,
      value: undefined,
    });

    expect(gitGateway.historyCalls).toEqual([]);
    expect(controller.store.getState().history).toBeNull();
  });

  it("loads the first page with the configured page size", async () => {
    const { gitGateway, controller } = await openedSetup();
    const release = gitGateway.holdNextHistory();

    const pending = controller.loadHistory();
    expect(controller.store.getState().history).toEqual({
      status: "loading",
      entries: [],
      nextCursor: null,
    });
    release();
    await pending;

    expect(controller.store.getState().history).toEqual({
      status: "loaded",
      entries: FIRST_PAGE.entries,
      nextCursor: CURSOR_ONE,
    });
    expect(gitGateway.historyCalls).toEqual([
      { projectId: PROJECT_ID, limit: HISTORY_PAGE_SIZE, cursor: null },
    ]);
  });

  it("appends the next page and keeps earlier entries while it loads", async () => {
    const { gitGateway, controller } = await openedSetup();
    await controller.loadHistory();
    const release = gitGateway.holdNextHistory();

    const pending = controller.loadMoreHistory();
    expect(controller.store.getState().history).toEqual({
      status: "loading",
      entries: FIRST_PAGE.entries,
      nextCursor: CURSOR_ONE,
    });
    release();
    await pending;

    expect(controller.store.getState().history).toEqual({
      status: "loaded",
      entries: [...FIRST_PAGE.entries, ...LAST_PAGE.entries],
      nextCursor: null,
    });
    expect(gitGateway.historyCalls[1]).toEqual({
      projectId: PROJECT_ID,
      limit: HISTORY_PAGE_SIZE,
      cursor: CURSOR_ONE,
    });
  });

  it("loadMoreHistory does nothing without a cursor, before a load or while loading", async () => {
    const { gitGateway, controller } = await openedSetup();

    await controller.loadMoreHistory();
    expect(gitGateway.historyCalls).toEqual([]);

    gitGateway.historyPages = [LAST_PAGE];
    await controller.loadHistory();
    await controller.loadMoreHistory();
    expect(gitGateway.historyCalls).toHaveLength(1);

    gitGateway.historyPages = [FIRST_PAGE, LAST_PAGE];
    await controller.loadHistory();
    const release = gitGateway.holdNextHistory();
    const first = controller.loadMoreHistory();
    const second = controller.loadMoreHistory();
    release();
    await Promise.all([first, second]);

    expect(gitGateway.historyCalls).toHaveLength(3);
    expect(controller.store.getState().history?.entries).toHaveLength(3);
  });

  it("a newer loadHistory supersedes an older one that answers later", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.historyPages = [FIRST_PAGE];
    const release = gitGateway.holdNextHistory();
    const older = controller.loadHistory();
    await settle();
    gitGateway.historyPages = [LAST_PAGE];

    const newer = controller.loadHistory();
    release();
    await Promise.all([older, newer]);

    expect(controller.store.getState().history).toEqual({
      status: "loaded",
      entries: LAST_PAGE.entries,
      nextCursor: null,
    });
  });

  it("drops a loadMore answer when a newer loadHistory started", async () => {
    const { gitGateway, controller } = await openedSetup();
    await controller.loadHistory();
    const release = gitGateway.holdNextHistory();
    const more = controller.loadMoreHistory();
    await settle();

    const reload = controller.loadHistory();
    release();
    await Promise.all([more, reload]);

    expect(controller.store.getState().history).toEqual({
      status: "loaded",
      entries: FIRST_PAGE.entries,
      nextCursor: CURSOR_ONE,
    });
  });

  it("drops an answer that arrives after the Project was closed", async () => {
    const { workspace, gitGateway, controller, failureLabels } =
      await openedSetup();
    const release = gitGateway.holdNextHistory();
    const pending = controller.loadHistory();
    await settle();

    await workspace.closeProject();
    release();
    await pending;

    expect(controller.store.getState().history).toBeNull();
    expect(controller.store.getState().projectId).toBeNull();
    expect(failureLabels).toEqual([]);
  });

  it("resets the history when the Project changes", async () => {
    const { workspace, controller } = await openedSetup();
    await controller.loadHistory();

    await workspace.closeProject();

    expect(controller.store.getState().history).toBeNull();
  });

  it("reports a failed first load and clears the history", async () => {
    const { gitGateway, controller, failures, failureLabels } =
      await openedSetup();
    gitGateway.failure = { kind: "invalidHistoryRequest", detail: "x" };

    const result = await controller.loadHistory();

    expect(!result.ok && result.error.kind).toBe("invalidHistoryRequest");
    expect(failureLabels).toEqual(["loadGitHistory"]);
    expect(failures[0]?.kind).toBe("invalidHistoryRequest");
    expect(controller.store.getState().history).toBeNull();
  });

  it("restores the last loaded state after a failed load of more", async () => {
    const { gitGateway, controller, failureLabels } = await openedSetup();
    await controller.loadHistory();
    gitGateway.failure = { kind: "gitTimeout", detail: "x" };

    await controller.loadMoreHistory();

    expect(failureLabels).toEqual(["loadGitHistory"]);
    expect(controller.store.getState().history).toEqual({
      status: "loaded",
      entries: FIRST_PAGE.entries,
      nextCursor: CURSOR_ONE,
    });
  });

  it("restores the previous history after a failed reload", async () => {
    const { gitGateway, controller } = await openedSetup();
    await controller.loadHistory();
    gitGateway.failure = { kind: "gitTimeout", detail: "x" };

    await controller.loadHistory();

    expect(controller.store.getState().history?.entries).toEqual(
      FIRST_PAGE.entries,
    );
    expect(controller.store.getState().history?.status).toBe("loaded");
  });

  it("reports a rejecting gateway as an unexpected error", async () => {
    const { gitGateway, controller, failureLabels } = await openedSetup();
    gitGateway.history = async () => {
      throw new Error("boom");
    };

    const result = await controller.loadHistory();

    expect(!result.ok && result.error.kind).toBe("unexpectedCommandError");
    expect(failureLabels).toEqual(["loadGitHistory"]);
    expect(controller.store.getState().history).toBeNull();
  });

  it("clearHistory drops the history and ignores a load in flight", async () => {
    const { gitGateway, controller } = await openedSetup();
    await controller.loadHistory();
    controller.clearHistory();
    expect(controller.store.getState().history).toBeNull();

    const release = gitGateway.holdNextHistory();
    const pending = controller.loadHistory();
    await settle();
    controller.clearHistory();
    release();
    await pending;

    expect(controller.store.getState().history).toBeNull();
  });

  it("sets historyError for a failed first load and clears it on the next start", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    await controller.loadHistory();
    expect(controller.store.getState().history).toBeNull();
    expect(controller.store.getState().historyError).toBe("gitTimeout");

    gitGateway.historyFailure = null;
    const release = gitGateway.holdNextHistory();
    const pending = controller.loadHistory();
    expect(controller.store.getState().historyError).toBeNull();
    release();
    await pending;
    expect(controller.store.getState().historyError).toBeNull();
    expect(controller.store.getState().history?.entries).toHaveLength(2);
  });

  it("keeps the entries and sets historyError when loading more fails, then clears it on retry", async () => {
    const { gitGateway, controller } = await openedSetup();
    await controller.loadHistory();
    gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    await controller.loadMoreHistory();
    expect(controller.store.getState().historyError).toBe("gitTimeout");
    expect(controller.store.getState().history?.entries).toHaveLength(2);

    gitGateway.historyFailure = null;
    const release = gitGateway.holdNextHistory();
    const pending = controller.loadMoreHistory();
    expect(controller.store.getState().historyError).toBeNull();
    release();
    await pending;
    expect(controller.store.getState().history?.entries).toHaveLength(3);
  });

  it("does not set historyError for a superseded failure", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    const release = gitGateway.holdNextHistory();
    const older = controller.loadHistory();
    await settle();
    gitGateway.historyFailure = null;
    const newer = controller.loadHistory();
    release();
    await Promise.all([older, newer]);
    expect(controller.store.getState().historyError).toBeNull();
    expect(controller.store.getState().history?.entries).toHaveLength(2);
  });

  it("clears historyError on clearHistory and on a Project change", async () => {
    const { workspace, gitGateway, controller } = await openedSetup();
    gitGateway.historyFailure = { kind: "gitTimeout", detail: "x" };
    await controller.loadHistory();
    controller.clearHistory();
    expect(controller.store.getState().historyError).toBeNull();

    await controller.loadHistory();
    expect(controller.store.getState().historyError).toBe("gitTimeout");
    await workspace.closeProject();
    expect(controller.store.getState().historyError).toBeNull();
  });

  it("never appends a commit that is already listed", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.historyPages = [
      FIRST_PAGE,
      {
        entries: [entry(ID_TWO, "two again"), entry(ID_THREE, "three")],
        nextCursor: null,
      },
    ];
    await controller.loadHistory();
    await controller.loadMoreHistory();
    expect(
      controller.store
        .getState()
        .history?.entries.map((listed) => listed.commitId),
    ).toEqual([ID_ONE, ID_TWO, ID_THREE]);
    expect(controller.store.getState().history?.entries[1]?.summary).toBe(
      "two",
    );
  });

  it("leaves the status untouched and does not reload after a commit", async () => {
    const { gitGateway, controller } = await openedSetup();
    gitGateway.status = MODIFIED_STATUS;
    await controller.refreshGitStatus();
    const statusBefore = controller.store.getState().status;
    const statusCallsBefore = gitGateway.calls.length;

    await controller.loadHistory();
    expect(controller.store.getState().status).toBe(statusBefore);
    expect(gitGateway.calls).toHaveLength(statusCallsBefore);

    await controller.commit("message");
    expect(gitGateway.historyCalls).toHaveLength(1);
    expect(controller.store.getState().history?.entries).toEqual(
      FIRST_PAGE.entries,
    );
  });

  it("runs after earlier operations, one at a time", async () => {
    const { gitGateway, controller } = await openedSetup();
    const events: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalStage = gitGateway.stage;
    const originalHistory = gitGateway.history;
    const originalStatus = gitGateway.gitStatus;
    gitGateway.stage = async (projectId, paths) => {
      events.push("stage:start");
      await held;
      events.push("stage:end");
      return originalStage(projectId, paths);
    };
    gitGateway.history = async (projectId, limit, cursor) => {
      events.push("history");
      return originalHistory(projectId, limit, cursor);
    };
    gitGateway.gitStatus = async (projectId) => {
      events.push("status");
      return originalStatus(projectId);
    };

    const all = Promise.all([
      controller.stage(["project.json"]),
      controller.loadHistory(),
      controller.refreshGitStatus(),
    ]);
    await settle();
    expect(events).toEqual(["stage:start"]);
    release();
    await all;

    expect(events).toEqual(["stage:start", "stage:end", "history", "status"]);
  });

  it("neither saves the workspace nor touches the undo history", async () => {
    const { workspace, gateway, gitGateway, store, controller } = setup();
    gitGateway.historyPages = [FIRST_PAGE, LAST_PAGE];
    await workspace.openProject(SELECTION_ID);
    await settle();
    const stateBefore = store.getState();
    gateway.clearCalls();

    await controller.loadHistory();
    await controller.loadMoreHistory();
    controller.clearHistory();

    expect(gateway.calls).toEqual([]);
    expect(store.getState()).toBe(stateBefore);
  });
});

describe("dispose", () => {
  it("stops following the Project", async () => {
    const { workspace, gitGateway, controller } = setup();

    controller.dispose();
    await workspace.openProject(SELECTION_ID);
    await settle();

    expect(gitGateway.calls).toEqual([]);
  });
});

describe("refreshGitStatusInBackground", () => {
  it("updates the status without showing refreshing or reporting", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = MODIFIED_STATUS;
    const release = gitGateway.holdNextCall();
    const observed: boolean[] = [];
    const unsubscribe = controller.store.subscribe(() =>
      observed.push(controller.store.getState().refreshing),
    );

    const refresh = controller.refreshGitStatusInBackground();
    await settle();
    release();
    const result = await refresh;
    unsubscribe();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(observed).not.toContain(true);
    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
  });

  it("records a failure silently", async () => {
    const { workspace, gitGateway, controller, failures } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "gitTimeout", detail: "slow" };

    const result = await controller.refreshGitStatusInBackground();

    expect(!result.ok && result.error.kind).toBe("gitTimeout");
    expect(failures).toEqual([]);
    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().statusError).toBe("gitTimeout");
  });

  it("shares a refresh that is still waiting", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const release = gitGateway.holdNextCall();
    const running = controller.refreshGitStatus();
    await settle();
    const waiting = controller.refreshGitStatus();
    const background = controller.refreshGitStatusInBackground();
    release();
    await Promise.all([running, waiting, background]);

    // The initial open, the running one and the shared waiting one.
    expect(gitGateway.calls).toHaveLength(3);
  });

  it("becomes a normal refresh when the button joins a waiting background one", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const release = gitGateway.holdNextCall();
    const running = controller.refreshGitStatusInBackground();
    await settle();
    const background = controller.refreshGitStatusInBackground();
    const asked = controller.refreshGitStatus();
    gitGateway.failure = { kind: "gitTimeout", detail: "slow" };
    release();
    await Promise.all([running, background, asked]);

    // The running read was silent; the shared waiting one reports, as the button asked.
    expect(failureLabels).toEqual(["refreshGitStatus"]);
  });

  it("does nothing without a Project", async () => {
    const { controller, gitGateway } = setup();

    await controller.refreshGitStatusInBackground();

    expect(gitGateway.calls).toEqual([]);
  });

  it("drops the answer when the Project changed meanwhile", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = MODIFIED_STATUS;
    const release = gitGateway.holdNextCall();
    const refresh = controller.refreshGitStatusInBackground();
    await settle();

    await workspace.closeProject();
    release();
    await refresh;

    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().projectId).toBeNull();
  });
});

describe("commit options", () => {
  it("passes both options as false by default", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();

    await controller.commit("message");

    expect(gitGateway.commitCalls).toEqual([
      {
        projectId: PROJECT_ID,
        message: "message",
        options: { amend: false, stageAll: false },
      },
    ]);
  });

  it("passes the given options on unchanged", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();

    await controller.commit("", { amend: true, stageAll: true });

    expect(gitGateway.commitCalls[0]?.options).toEqual({
      amend: true,
      stageAll: true,
    });
    expect(gitGateway.commitCalls[0]?.message).toBe("");
  });

  it.each(["gitNoCommitToAmend", "gitCommitAlreadyPushed"] as const)(
    "reports %s as a commit failure and reads the status again",
    async (kind) => {
      const { workspace, gitGateway, controller, failureLabels } = setup();
      await workspace.openProject(SELECTION_ID);
      await settle();
      gitGateway.calls.length = 0;
      gitGateway.failure = { kind, detail: "refused" };
      const original = gitGateway.commit;
      gitGateway.commit = async (projectId, message, options) => {
        const answer = await original(projectId, message, options);
        gitGateway.failure = null;
        return answer;
      };

      const result = await controller.commit("m", {
        amend: true,
        stageAll: false,
      });

      expect(!result.ok && result.error.kind).toBe(kind);
      expect(failureLabels).toEqual(["commitGitChanges"]);
      expect(gitGateway.calls).toHaveLength(1);
      expect(controller.store.getState().operating).toBe(false);
    },
  );
});

describe("undoLastCommit", () => {
  it("replaces the status and returns the message of the undone commit", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.undoResult = {
      message: "元のメッセージ\n",
      status: { outcome: "updated", status: MODIFIED_STATUS },
    };

    const result = await controller.undoLastCommit();

    expect(result).toEqual({
      ok: true,
      value: { message: "元のメッセージ\n" },
    });
    expect(gitGateway.undoCalls).toEqual([{ projectId: PROJECT_ID }]);
    const state = controller.store.getState();
    expect(state.status).toEqual(MODIFIED_STATUS);
    expect(state.statusError).toBeNull();
    expect(state.operating).toBe(false);
    expect(failureLabels).toEqual([]);
  });

  it("does nothing without a Project", async () => {
    const { gitGateway, controller } = setup();

    const result = await controller.undoLastCommit();

    expect(result).toEqual({ ok: true, value: { message: null } });
    expect(gitGateway.undoCalls).toEqual([]);
  });

  it("drops the status when it could not be read afterwards and reports it", async () => {
    const { workspace, gitGateway, controller, failureLabels, failures } =
      setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.undoResult = {
      message: "m",
      status: { outcome: "unavailable", errorKind: "gitTimeout" },
    };

    const result = await controller.undoLastCommit();

    expect(result).toEqual({ ok: true, value: { message: "m" } });
    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().statusError).toBe("gitTimeout");
    expect(failureLabels).toEqual(["refreshGitStatus"]);
    expect(failures.map((failure) => failure.kind)).toEqual(["gitTimeout"]);
  });

  it.each([
    "gitCannotUndoCommit",
    "gitCommitAlreadyPushed",
    "gitOperationInProgress",
  ] as const)(
    "reports %s with the undo label and reads the status again",
    async (kind) => {
      const { workspace, gitGateway, controller, failureLabels } = setup();
      await workspace.openProject(SELECTION_ID);
      await settle();
      gitGateway.calls.length = 0;
      gitGateway.failure = { kind, detail: "refused" };
      const original = gitGateway.undoLastCommit;
      gitGateway.undoLastCommit = async (projectId) => {
        const answer = await original(projectId);
        gitGateway.failure = null;
        return answer;
      };

      const result = await controller.undoLastCommit();

      expect(!result.ok && result.error.kind).toBe(kind);
      expect(failureLabels).toEqual(["undoGitCommit"]);
      expect(gitGateway.calls).toHaveLength(1);
      expect(controller.store.getState().operating).toBe(false);
    },
  );

  it("reports a rejecting gateway as an unexpected error", async () => {
    const { workspace, gitGateway, controller, failures } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.undoLastCommit = async () => {
      throw new Error("boom");
    };

    const result = await controller.undoLastCommit();

    expect(!result.ok && result.error.kind).toBe("unexpectedCommandError");
    expect(failures[0]?.kind).toBe("unexpectedCommandError");
  });

  it("drops the answer when the Project changed meanwhile", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = MODIFIED_STATUS;
    const release = gitGateway.holdNextUndo();
    const pending = controller.undoLastCommit();
    await settle();

    await workspace.closeProject();
    release();
    const result = await pending;

    expect(result).toEqual({ ok: true, value: { message: null } });
    expect(controller.store.getState().status).toBeNull();
  });
});

describe("remote operations", () => {
  const REMOTE_CASES = [
    ["fetch", "fetchGit", "fetchCalls"],
    ["pull", "pullGit", "pullCalls"],
    ["push", "pushGit", "pushCalls"],
  ] as const;

  it.each(REMOTE_CASES)(
    "%s replaces the status and tracks the running operation",
    async (operation, _label, calls) => {
      const { workspace, gitGateway, controller, failureLabels } = setup();
      await workspace.openProject(SELECTION_ID);
      await settle();
      gitGateway.status = MODIFIED_STATUS;
      const release = gitGateway.holdNextRemote();

      const pending = controller[operation]();
      await settle();
      expect(controller.store.getState().runningOperation).toBe(operation);
      expect(controller.store.getState().operating).toBe(true);
      release();
      const result = await pending;

      expect(result).toEqual({ ok: true, value: undefined });
      expect(gitGateway[calls]).toEqual([{ projectId: PROJECT_ID }]);
      const state = controller.store.getState();
      expect(state.status).toEqual(MODIFIED_STATUS);
      expect(state.runningOperation).toBeNull();
      expect(state.operating).toBe(false);
      expect(failureLabels).toEqual([]);
    },
  );

  it("publish passes the remote and tracks the running operation", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const release = gitGateway.holdNextRemote();

    const pending = controller.publish("origin");
    await settle();
    expect(controller.store.getState().runningOperation).toBe("publish");
    release();
    await pending;

    expect(gitGateway.publishCalls).toEqual([
      { projectId: PROJECT_ID, remote: "origin" },
    ]);
    expect(controller.store.getState().runningOperation).toBeNull();
  });

  it("tracks commit, amend and undo as running operations too", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const seen: (string | null)[] = [];
    controller.store.subscribe(() =>
      seen.push(controller.store.getState().runningOperation),
    );

    await controller.commit("m");
    await controller.commit("m", { amend: true, stageAll: false });
    await controller.undoLastCommit();

    expect(seen).toContain("commit");
    expect(seen).toContain("amend");
    expect(seen).toContain("undo");
    expect(controller.store.getState().runningOperation).toBeNull();
    expect(gitGateway.commitCalls).toHaveLength(2);
  });

  it.each([
    ["fetch", "fetchGit"],
    ["pull", "pullGit"],
    ["push", "pushGit"],
  ] as const)(
    "%s reports its label on failure and reads the status again",
    async (operation, label) => {
      const { workspace, gitGateway, controller, failureLabels } = setup();
      await workspace.openProject(SELECTION_ID);
      await settle();
      gitGateway.calls.length = 0;
      gitGateway.failure = { kind: "gitNetworkUnavailable", detail: "down" };
      const original = gitGateway[operation];
      gitGateway[operation] = async (projectId) => {
        const answer = await original(projectId);
        gitGateway.failure = null;
        return answer;
      };

      const result = await controller[operation]();

      expect(!result.ok && result.error.kind).toBe("gitNetworkUnavailable");
      expect(failureLabels).toEqual([label]);
      expect(gitGateway.calls).toHaveLength(1);
      expect(controller.store.getState().runningOperation).toBeNull();
      expect(controller.store.getState().operating).toBe(false);
    },
  );

  it("publish reports publishGit on failure", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "gitRemoteNotFound", detail: "x" };

    const result = await controller.publish("nope");

    expect(!result.ok && result.error.kind).toBe("gitRemoteNotFound");
    expect(failureLabels[0]).toBe("publishGit");
  });

  it("drops the status and reports a status problem when it was unavailable", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.pushResult = {
      status: { outcome: "unavailable", errorKind: "gitTimeout" },
    };

    const result = await controller.push();

    expect(result.ok).toBe(true);
    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().statusError).toBe("gitTimeout");
    expect(failureLabels).toEqual(["refreshGitStatus"]);
  });

  it("reports a rejecting gateway as an unexpected error", async () => {
    const { workspace, gitGateway, controller, failures } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.fetch = async () => {
      throw new Error("boom");
    };

    const result = await controller.fetch();

    expect(!result.ok && result.error.kind).toBe("unexpectedCommandError");
    expect(failures[0]?.kind).toBe("unexpectedCommandError");
  });

  it("does nothing without a Project", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.pull()).toEqual({ ok: true, value: undefined });
    expect(gitGateway.pullCalls).toEqual([]);
  });

  it("drops the answer when the Project changed meanwhile", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = MODIFIED_STATUS;
    const release = gitGateway.holdNextRemote();
    const pending = controller.pull();
    await settle();

    await workspace.closeProject();
    release();
    const result = await pending;

    expect(result).toEqual({ ok: true, value: undefined });
    expect(controller.store.getState().status).toBeNull();
    expect(controller.store.getState().runningOperation).toBeNull();
  });

  it("runs after an earlier operation on the same queue", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    const release = gitGateway.holdNextRemote();
    const first = controller.fetch();
    const second = controller.push();
    await settle();
    expect(gitGateway.pushCalls).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(gitGateway.pushCalls).toHaveLength(1);
  });
});

describe("remotes", () => {
  it("returns the names without changing the state or reporting", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.remoteNames = ["origin", "backup"];
    const before = controller.store.getState();

    const result = await controller.remotes();

    expect(result).toEqual({ ok: true, value: ["origin", "backup"] });
    expect(gitGateway.remotesCalls).toEqual([{ projectId: PROJECT_ID }]);
    expect(controller.store.getState()).toBe(before);
    expect(failureLabels).toEqual([]);
  });

  it("returns a failure without reporting it", async () => {
    const { workspace, gitGateway, controller, failureLabels } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.failure = { kind: "ioError", detail: "x" };

    const result = await controller.remotes();

    expect(!result.ok && result.error.kind).toBe("ioError");
    expect(failureLabels).toEqual([]);
  });

  it("answers an empty list without a Project", async () => {
    const { gitGateway, controller } = setup();

    expect(await controller.remotes()).toEqual({ ok: true, value: [] });
    expect(gitGateway.remotesCalls).toEqual([]);
  });
});
