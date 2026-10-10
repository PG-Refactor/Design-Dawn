// In-memory Git gateway for tests. Not imported by production code.

import type { ProjectId } from "../../domain/shared/entity-id";
import type {
  GitCommitOptions,
  GitCommitResult,
  GitDiff,
  GitDiffSide,
  GitDiscardImpact,
  GitGateway,
  GitHistoryPage,
  GitRemoteResult,
  GitStatus,
  GitUndoCommitResult,
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
  readonly discardCalls: { projectId: ProjectId; paths: readonly string[] }[];
  readonly discardImpactCalls: {
    projectId: ProjectId;
    paths: readonly string[];
  }[];
  // Answer of `discardImpact` (when `failure` is null).
  impactResult: GitDiscardImpact;
  // Answer of the next `discard` call only (then back to `status` / `failure`).
  nextDiscardResult: OperationResult<GitStatus> | null;
  // Suspends the next `discard` call until the returned function is called (the call is
  // recorded before it waits).
  holdNextDiscard(): () => void;
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
  readonly commitCalls: {
    projectId: ProjectId;
    message: string;
    options: GitCommitOptions;
  }[];
  readonly undoCalls: { projectId: ProjectId }[];
  // Answer of `undoLastCommit` (when `failure` is null); defaults to message "undone" and
  // the status `status`.
  undoResult: GitUndoCommitResult | null;
  // Suspends the next `undoLastCommit` call until the returned function is called.
  holdNextUndo(): () => void;
  // Answer of `commit` (when `failure` is null): the status after it defaults to `status`.
  commitResult: GitCommitResult | null;
  // Remote operations (`fetch` / `pull` / `push` / `publish` share the hold and `failure`).
  readonly fetchCalls: { projectId: ProjectId }[];
  readonly pullCalls: { projectId: ProjectId }[];
  readonly pushCalls: { projectId: ProjectId }[];
  readonly publishCalls: { projectId: ProjectId; remote: string }[];
  readonly remotesCalls: { projectId: ProjectId }[];
  // Answer of the matching call (when `failure` is null); null answers an updated status
  // equal to `status`.
  fetchResult: GitRemoteResult | null;
  pullResult: GitRemoteResult | null;
  pushResult: GitRemoteResult | null;
  publishResult: GitRemoteResult | null;
  // Answer of `remotes` (when `failure` is null).
  remoteNames: readonly string[];
  // Suspends the next `fetch` / `pull` / `push` / `publish` call until the returned
  // function is called (the call is recorded before it waits).
  holdNextRemote(): () => void;
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

export const FAKE_BRANCH_NAME = "main";

export const FAKE_UNDONE_MESSAGE = "undone";

export const CLEAN_GIT_STATUS: GitStatus = {
  repositoryState: "ready",
  branch: {
    head: FAKE_BRANCH_NAME,
    oid: FAKE_COMMIT_ID,
    upstream: null,
    ahead: null,
    behind: null,
    headPushed: false,
  },
  files: [],
};

export function createFakeGitGateway(): FakeGitGateway {
  let hold: Promise<void> | null = null;
  let diffHold: Promise<void> | null = null;
  let historyHold: Promise<void> | null = null;
  let stageHold: Promise<void> | null = null;
  let unstageHold: Promise<void> | null = null;
  let commitHold: Promise<void> | null = null;
  let undoHold: Promise<void> | null = null;
  let discardHold: Promise<void> | null = null;
  let remoteHold: Promise<void> | null = null;
  async function remoteAnswer(
    configured: GitRemoteResult | null,
  ): Promise<OperationResult<GitRemoteResult>> {
    // Captured before waiting, like the other calls.
    const answer: OperationResult<GitRemoteResult> = gateway.failure
      ? operationErr<GitRemoteResult>(
          gateway.failure.kind,
          gateway.failure.detail,
        )
      : operationOk(
          configured ?? {
            status: { outcome: "updated", status: gateway.status },
          },
        );
    const pending = remoteHold;
    remoteHold = null;
    if (pending !== null) await pending;
    return answer;
  }
  function indexAnswer(): OperationResult<GitStatus> {
    return gateway.failure
      ? operationErr<GitStatus>(gateway.failure.kind, gateway.failure.detail)
      : operationOk(gateway.status);
  }
  const gateway: FakeGitGateway = {
    calls: [],
    stageCalls: [],
    unstageCalls: [],
    discardCalls: [],
    discardImpactCalls: [],
    impactResult: { documentIds: [], projectFilesAffected: false },
    nextDiscardResult: null,
    diffCalls: [],
    diffs: {},
    historyCalls: [],
    historyPages: [],
    historyFailure: null,
    commitCalls: [],
    undoCalls: [],
    undoResult: null,
    commitResult: null,
    fetchCalls: [],
    pullCalls: [],
    pushCalls: [],
    publishCalls: [],
    remotesCalls: [],
    fetchResult: null,
    pullResult: null,
    pushResult: null,
    publishResult: null,
    remoteNames: [],
    holdNextRemote() {
      let release: () => void = () => undefined;
      remoteHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async fetch(projectId) {
      gateway.fetchCalls.push({ projectId });
      return remoteAnswer(gateway.fetchResult);
    },
    async pull(projectId) {
      gateway.pullCalls.push({ projectId });
      return remoteAnswer(gateway.pullResult);
    },
    async push(projectId) {
      gateway.pushCalls.push({ projectId });
      return remoteAnswer(gateway.pushResult);
    },
    async publish(projectId, remote) {
      gateway.publishCalls.push({ projectId, remote });
      return remoteAnswer(gateway.publishResult);
    },
    async remotes(projectId) {
      gateway.remotesCalls.push({ projectId });
      return gateway.failure
        ? operationErr<readonly string[]>(
            gateway.failure.kind,
            gateway.failure.detail,
          )
        : operationOk(gateway.remoteNames);
    },
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
    holdNextDiscard() {
      let release: () => void = () => undefined;
      discardHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    holdNextUndo() {
      let release: () => void = () => undefined;
      undoHold = new Promise<void>((resolve) => {
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
    async discard(projectId, paths) {
      gateway.discardCalls.push({ projectId, paths });
      const answer = gateway.nextDiscardResult ?? indexAnswer();
      gateway.nextDiscardResult = null;
      const pending = discardHold;
      discardHold = null;
      if (pending !== null) await pending;
      return answer;
    },
    async discardImpact(projectId, paths) {
      gateway.discardImpactCalls.push({ projectId, paths });
      return gateway.failure
        ? operationErr<GitDiscardImpact>(
            gateway.failure.kind,
            gateway.failure.detail,
          )
        : operationOk(gateway.impactResult);
    },
    async undoLastCommit(projectId) {
      gateway.undoCalls.push({ projectId });
      const answer: OperationResult<GitUndoCommitResult> = gateway.failure
        ? operationErr<GitUndoCommitResult>(
            gateway.failure.kind,
            gateway.failure.detail,
          )
        : operationOk(
            gateway.undoResult ?? {
              message: FAKE_UNDONE_MESSAGE,
              status: { outcome: "updated", status: gateway.status },
            },
          );
      const pending = undoHold;
      undoHold = null;
      if (pending !== null) await pending;
      return answer;
    },
    async commit(projectId, message, options) {
      gateway.commitCalls.push({ projectId, message, options });
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
