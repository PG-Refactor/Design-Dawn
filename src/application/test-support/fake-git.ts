// In-memory Git gateway for tests. Not imported by production code.

import type { ProjectId } from "../../domain/shared/entity-id";
import type {
  GitCommitResult,
  GitDiff,
  GitDiffSide,
  GitGateway,
  GitHistoryPage,
  GitStatus,
} from "../ports/git-gateway";
import {
  type OperationError,
  type OperationResult,
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
  readonly historyCalls: {
    projectId: ProjectId;
    limit: number;
    cursor: string | null;
  }[];
  // Pages in order: a null cursor answers the first, the cursor a page returned answers the
  // page after it; anything else answers an empty last page.
  historyPages: readonly GitHistoryPage[];
  // Fails `history` only (`failure` fails every call); null answers from `historyPages`.
  historyFailure: OperationError | null;
  // Suspends the next `history` call until the returned function is called.
  holdNextHistory(): () => void;
  readonly commitCalls: { projectId: ProjectId; message: string }[];
  // Answer of `commit` (when `failure` is null): the status after it defaults to `status`.
  commitResult: GitCommitResult | null;
  // Returned by the next calls until changed.
  status: GitStatus;
  failure: OperationError | null;
  // Suspends the next call until the returned function is called.
  holdNextCall(): () => void;
  // Same for the next `stage` / `unstage` call (the call is recorded before it waits).
  holdNextStage(): () => void;
  holdNextUnstage(): () => void;
  // Same for the next `commit` call (recorded before it waits).
  holdNextCommit(): () => void;
  // Answer of the next `stage` / `unstage` call only (then back to `status` / `failure`).
  nextStageResult: OperationResult<GitStatus> | null;
  nextUnstageResult: OperationResult<GitStatus> | null;
}

export const FAKE_COMMIT_ID = "0123456789abcdef0123456789abcdef01234567";

export const CLEAN_GIT_STATUS: GitStatus = {
  repositoryState: "ready",
  files: [],
};

export function createFakeGitGateway(): FakeGitGateway {
  let hold: Promise<void> | null = null;
  let diffHold: Promise<void> | null = null;
  let historyHold: Promise<void> | null = null;
  let stageHold: Promise<void> | null = null;
  let unstageHold: Promise<void> | null = null;
  let commitHold: Promise<void> | null = null;
  function indexAnswer(): OperationResult<GitStatus> {
    return gateway.failure
      ? operationErr<GitStatus>(gateway.failure.kind, gateway.failure.detail)
      : operationOk(gateway.status);
  }
  const gateway: FakeGitGateway = {
    calls: [],
    stageCalls: [],
    unstageCalls: [],
    diffCalls: [],
    diffs: {},
    historyCalls: [],
    historyPages: [],
    historyFailure: null,
    commitCalls: [],
    commitResult: null,
    status: CLEAN_GIT_STATUS,
    failure: null,
    nextStageResult: null,
    nextUnstageResult: null,
    holdNextStage() {
      let release: () => void = () => undefined;
      stageHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    holdNextUnstage() {
      let release: () => void = () => undefined;
      unstageHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    holdNextCommit() {
      let release: () => void = () => undefined;
      commitHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
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
    holdNextHistory() {
      let release: () => void = () => undefined;
      historyHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async history(projectId, limit, cursor) {
      gateway.historyCalls.push({ projectId, limit, cursor });
      const index =
        cursor === null
          ? 0
          : gateway.historyPages.findIndex(
              (page) => page.nextCursor === cursor,
            ) + 1;
      const failure = gateway.historyFailure ?? gateway.failure;
      // Captured before waiting, like the other calls.
      const answer = failure
        ? operationErr<GitHistoryPage>(failure.kind, failure.detail)
        : operationOk<GitHistoryPage>(
            index > 0 || cursor === null
              ? (gateway.historyPages[index] ?? {
                  entries: [],
                  nextCursor: null,
                })
              : { entries: [], nextCursor: null },
          );
      const pending = historyHold;
      historyHold = null;
      if (pending !== null) await pending;
      return answer;
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
      // Captured before waiting, like `gitStatus`.
      const answer = gateway.nextStageResult ?? indexAnswer();
      gateway.nextStageResult = null;
      const pending = stageHold;
      stageHold = null;
      if (pending !== null) await pending;
      return answer;
    },
    async commit(projectId, message) {
      gateway.commitCalls.push({ projectId, message });
      const answer: OperationResult<GitCommitResult> = gateway.failure
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
      const pending = commitHold;
      commitHold = null;
      if (pending !== null) await pending;
      return answer;
    },
    async unstage(projectId, paths) {
      gateway.unstageCalls.push({ projectId, paths });
      const answer = gateway.nextUnstageResult ?? indexAnswer();
      gateway.nextUnstageResult = null;
      const pending = unstageHold;
      unstageHold = null;
      if (pending !== null) await pending;
      return answer;
    },
  };
  return gateway;
}
