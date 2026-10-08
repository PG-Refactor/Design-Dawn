import { describe, expect, it } from "vitest";
import { PROJECT_ID } from "../../domain/shared/test-fixtures";
import type { GitStatus } from "../ports/git-gateway";
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

describe("dispose", () => {
  it("stops following the Project", async () => {
    const { workspace, gitGateway, controller } = setup();

    controller.dispose();
    await workspace.openProject(SELECTION_ID);
    await settle();

    expect(gitGateway.calls).toEqual([]);
  });
});
