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
import { createGitController } from "./git-controller";

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
  const controller = createGitController({
    gateway: gitGateway,
    applicationStore: harness.store,
    reportFailure: (error) => failures.push(error),
  });
  return { ...harness, gitGateway, controller, failures };
}

describe("following the open Project", () => {
  it("has no status and does not call git without a Project", async () => {
    const { controller, gitGateway } = setup();

    expect(controller.store.getState()).toEqual({
      projectId: null,
      status: null,
      refreshing: false,
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

  it("ignores an older answer that arrives after a newer one", async () => {
    const { workspace, gitGateway, controller } = setup();
    await workspace.openProject(SELECTION_ID);
    await settle();
    gitGateway.status = CLEAN_GIT_STATUS;
    const releaseOlder = gitGateway.holdNextCall();
    const older = controller.refreshGitStatus();
    gitGateway.status = MODIFIED_STATUS;
    const newer = controller.refreshGitStatus();
    await newer;

    releaseOlder();
    await older;

    expect(controller.store.getState().status).toEqual(MODIFIED_STATUS);
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

describe("dispose", () => {
  it("stops following the Project", async () => {
    const { workspace, gitGateway, controller } = setup();

    controller.dispose();
    await workspace.openProject(SELECTION_ID);
    await settle();

    expect(gitGateway.calls).toEqual([]);
  });
});
