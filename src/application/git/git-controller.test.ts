import { describe, expect, it } from "vitest";
import { PROJECT_ID } from "../../domain/shared/test-fixtures";
import type { GitDiff, GitStatus } from "../ports/git-gateway";
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
      refreshing: false,
      operating: false,
      diff: null,
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
      refreshing: false,
      operating: false,
      diff: null,
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
      refreshing: false,
      operating: false,
      diff: null,
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
      refreshing: false,
      operating: false,
      diff: null,
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
      { projectId: PROJECT_ID, message: MESSAGE },
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
      gitGateway.commit = async (projectId, message) => {
        const answer = await original(projectId, message);
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
    gitGateway.commit = async (projectId, message) => {
      await held;
      return original(projectId, message);
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
      refreshing: false,
      operating: false,
      diff: null,
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
    gitGateway.commit = async (projectId, message) => {
      events.push("commit:start");
      const result = await originalCommit(projectId, message);
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

describe("dispose", () => {
  it("stops following the Project", async () => {
    const { workspace, gitGateway, controller } = setup();

    controller.dispose();
    await workspace.openProject(SELECTION_ID);
    await settle();

    expect(gitGateway.calls).toEqual([]);
  });
});
