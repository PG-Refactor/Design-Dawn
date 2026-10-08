// In-memory Git gateway for tests. Not imported by production code.

import type { ProjectId } from "../../domain/shared/entity-id";
import type { GitGateway, GitStatus } from "../ports/git-gateway";
import {
  type OperationError,
  operationErr,
  operationOk,
} from "../ports/operation-error";

export interface FakeGitGateway extends GitGateway {
  readonly calls: ProjectId[];
  // Returned by the next calls until changed.
  status: GitStatus;
  failure: OperationError | null;
  // Suspends the next call until the returned function is called.
  holdNextCall(): () => void;
}

export const CLEAN_GIT_STATUS: GitStatus = {
  repositoryState: "ready",
  files: [],
};

export function createFakeGitGateway(): FakeGitGateway {
  let hold: Promise<void> | null = null;
  const gateway: FakeGitGateway = {
    calls: [],
    status: CLEAN_GIT_STATUS,
    failure: null,
    holdNextCall() {
      let release: () => void = () => undefined;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async gitStatus(projectId) {
      gateway.calls.push(projectId);
      // Captured before waiting, so the answer reflects the state at call time.
      const answer = gateway.failure
        ? operationErr<GitStatus>(gateway.failure.kind, gateway.failure.detail)
        : operationOk(gateway.status);
      const pending = hold;
      hold = null;
      if (pending !== null) await pending;
      return answer;
    },
  };
  return gateway;
}
