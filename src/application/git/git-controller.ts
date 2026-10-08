// Project-scoped Git state (docs/git-development.md §11.4, docs/architecture.md §11.0.2):
// runtime only, never saved in the Project's files (Git is the source of truth). It follows
// the open Project: the state is reset when the Project changes and refreshed once the new
// one is installed. Refreshing only reads; Git never saves or changes the Project.

import type { ProjectId } from "../../domain/shared/entity-id";
import { createStore, type Store } from "../../shared/store/store";
import type { GitGateway, GitStatus } from "../ports/git-gateway";
import {
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { ApplicationStore } from "../state/application-state";

export interface GitState {
  // The Project the status belongs to; null while no Project is open.
  readonly projectId: ProjectId | null;
  // Null until the first successful refresh of this Project, and after a failed one (a
  // stale status must not be shown as current).
  readonly status: GitStatus | null;
  readonly refreshing: boolean;
}

export interface GitController {
  readonly store: Store<GitState>;
  // Reads the status of the open Project. Failures are also reported through
  // `reportFailure`; a refresh without an open Project does nothing.
  refreshGitStatus(): Promise<OperationResult<void>>;
  // Stops following the Project.
  dispose(): void;
}

export interface GitControllerDependencies {
  readonly gateway: GitGateway;
  readonly applicationStore: ApplicationStore;
  // Where a failed refresh is shown (the notifications); the application layer does not
  // know about UI state.
  readonly reportFailure: (error: OperationError) => void;
}

const NO_PROJECT_STATE: GitState = {
  projectId: null,
  status: null,
  refreshing: false,
};

export function createGitController(
  dependencies: GitControllerDependencies,
): GitController {
  const { gateway, applicationStore, reportFailure } = dependencies;
  const store = createStore<GitState>(NO_PROJECT_STATE);
  // Only the newest request may write the state: a slow answer for a Project that was
  // closed (or an older refresh) must not replace a newer one.
  let latestRequest = 0;

  async function refreshProject(
    projectId: ProjectId,
  ): Promise<OperationResult<void>> {
    const request = ++latestRequest;
    store.setState((state) => ({ ...state, refreshing: true }));
    let result: OperationResult<GitStatus>;
    try {
      result = await gateway.gitStatus(projectId);
    } catch (failure) {
      result = operationErr(
        "unexpectedCommandError",
        failure instanceof Error ? failure.message : String(failure),
      );
    }
    if (request !== latestRequest)
      return result.ok ? operationOk(undefined) : result;
    if (result.ok) {
      store.setState({ projectId, status: result.value, refreshing: false });
      return operationOk(undefined);
    }
    store.setState({ projectId, status: null, refreshing: false });
    reportFailure(result.error);
    return result;
  }

  function followProject(): void {
    const projectId = applicationStore.getState().project?.projectId ?? null;
    if (projectId === store.getState().projectId) return;
    latestRequest += 1;
    store.setState({ ...NO_PROJECT_STATE, projectId });
    if (projectId !== null) void refreshProject(projectId);
  }

  const unsubscribe = applicationStore.subscribe(followProject);
  // The Project may already be open when the controller is created.
  followProject();

  return {
    store,
    async refreshGitStatus() {
      const projectId = store.getState().projectId;
      return projectId === null
        ? operationOk(undefined)
        : refreshProject(projectId);
    },
    dispose: unsubscribe,
  };
}
