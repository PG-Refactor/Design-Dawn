// In-memory Git gateway for tests. Not imported by production code.

import type { ProjectId } from "../../domain/shared/entity-id";
import type {
  GitCommitResult,
  GitDiff,
  GitDiffSide,
  GitGateway,
  GitStatus,
} from "../ports/git-gateway";
import {
  type OperationError,
  operationErr,
  operationOk,
} from "../ports/operation-error";

export interface FakeGitGateway extends GitGateway {
  readonly calls: ProjectId[];
  readonly stageCalls: { projectId: ProjectId; paths: readonly string[] }[];
  readonly unstageCalls: { projectId: ProjectId; paths: readonly string[] }[];
  readonly diffCalls: {
    projectId: ProjectId;
    path: string;
    side: GitDiffSide;
  }[];
  // Answers of `diff`; a missing path answers an empty diff.
  diffs: Record<string, GitDiff>;
  // Suspends the next `diff` call until the returned function is called.
  holdNextDiff(): () => void;
  readonly commitCalls: { projectId: ProjectId; message: string }[];
  // Answer of `commit` (when `failure` is null): the status after it defaults to `status`.
  commitResult: GitCommitResult | null;
  // Returned by the next calls until changed.
  status: GitStatus;
  failure: OperationError | null;
  // Suspends the next call until the returned function is called.
  holdNextCall(): () => void;
}

export const FAKE_COMMIT_ID = "0123456789abcdef0123456789abcdef01234567";

export const CLEAN_GIT_STATUS: GitStatus = {
  repositoryState: "ready",
  files: [],
};

export function createFakeGitGateway(): FakeGitGateway {
  let hold: Promise<void> | null = null;
  let diffHold: Promise<void> | null = null;
  const gateway: FakeGitGateway = {
    calls: [],
    stageCalls: [],
    unstageCalls: [],
    diffCalls: [],
    diffs: {},
    commitCalls: [],
    commitResult: null,
    status: CLEAN_GIT_STATUS,
    failure: null,
    holdNextCall() {
      let release: () => void = () => undefined;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    holdNextDiff() {
      let release: () => void = () => undefined;
      diffHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async diff(projectId, path, side) {
      gateway.diffCalls.push({ projectId, path, side });
      const answer = gateway.failure
        ? operationErr<GitDiff>(gateway.failure.kind, gateway.failure.detail)
        : operationOk<GitDiff>(
            gateway.diffs[`${side}:${path}`] ?? {
              path,
              side,
              outcome: "empty",
            },
          );
      const pending = diffHold;
      diffHold = null;
      if (pending !== null) await pending;
      return answer;
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
    async stage(projectId, paths) {
      gateway.stageCalls.push({ projectId, paths });
      return gateway.failure
        ? operationErr<GitStatus>(gateway.failure.kind, gateway.failure.detail)
        : operationOk(gateway.status);
    },
    async commit(projectId, message) {
      gateway.commitCalls.push({ projectId, message });
      return gateway.failure
        ? operationErr<GitCommitResult>(
            gateway.failure.kind,
            gateway.failure.detail,
          )
        : operationOk(
            gateway.commitResult ?? {
              commitId: FAKE_COMMIT_ID,
              status: { outcome: "updated", status: gateway.status },
            },
          );
    },
    async unstage(projectId, paths) {
      gateway.unstageCalls.push({ projectId, paths });
      return gateway.failure
        ? operationErr<GitStatus>(gateway.failure.kind, gateway.failure.detail)
        : operationOk(gateway.status);
    },
  };
  return gateway;
}
