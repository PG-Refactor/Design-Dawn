// Project-scoped Git state (docs/git-development.md §11.4, docs/architecture.md §11.0.2):
// runtime only, never saved in the Project's files (Git is the source of truth). It follows
// the open Project: the state is reset when the Project changes and refreshed once the new
// one is installed. Refreshing only reads; Git never saves or changes the Project. Stage /
// Unstage change the index only: they never save the workspace and are not part of the
// document Undo history (docs/git-development.md §11); Commit is the same. Discard changes working tree files (a Document
// on screen can then be stale: the UI reloads it from `discardImpact`) but is no Undo step
// either. Loading a Diff
// or the history only reads. A successful commit does not reload the history: the UI decides
// when (docs/git-development.md §11.12).

import { HISTORY_PAGE_SIZE } from "../../config/git-config";
import type { ProjectId } from "../../domain/shared/entity-id";
import { createStore, type Store } from "../../shared/store/store";
import type {
  GitCommitResult,
  GitDiff,
  GitDiffSide,
  GitDiscardImpact,
  GitGateway,
  GitHistoryEntry,
  GitHistoryPage,
  GitStatus,
} from "../ports/git-gateway";
import {
  type OperationError,
  type OperationErrorKind,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { ApplicationStore } from "../state/application-state";

// The Diff the UI shows or waits for. Only the latest request is kept.
export type GitDiffState =
  | {
      readonly path: string;
      readonly side: GitDiffSide;
      readonly status: "loading";
    }
  | {
      readonly path: string;
      readonly side: GitDiffSide;
      readonly status: "loaded";
      readonly result: GitDiff;
    };

// The history the UI shows. Entries of earlier pages stay while the next page loads.
export interface GitHistoryState {
  readonly status: "loading" | "loaded";
  // Newest first, all pages loaded so far.
  readonly entries: readonly GitHistoryEntry[];
  // Null when there is no further page (or while the first page loads).
  readonly nextCursor: string | null;
}

export interface GitState {
  // The Project the status belongs to; null while no Project is open.
  readonly projectId: ProjectId | null;
  // Null until the first successful refresh of this Project, and after a failed one (a
  // stale status must not be shown as current).
  readonly status: GitStatus | null;
  // The kind of the last failed status read of this Project (a refresh, the refresh after a
  // failed Stage / Unstage / Commit, or a commit whose status was unavailable); null when
  // the last status read succeeded or was replaced by a successful Stage / Unstage / Commit,
  // and before the first read: "not loaded yet" is never an error. Lets a UI tell "failed"
  // from "not read yet", both of which have a null `status`.
  readonly statusError: OperationErrorKind | null;
  readonly refreshing: boolean;
  // True while a Stage / Unstage / Commit (and the refresh that follows its failure) runs, so a UI
  // can disable its buttons.
  readonly operating: boolean;
  // Null when no Diff was requested, after `clearDiff`, after a failed load and after a
  // Project change. Stage / Unstage leave it as is even when the shown side changed: the
  // UI reloads it (docs/git-development.md §11.10).
  readonly diff: GitDiffState | null;
  // Independent of `status`. Null before a load, after `clearHistory`, after a failed first
  // load and after a Project change. A failed load restores the last loaded state.
  readonly history: GitHistoryState | null;
  // The kind of the last failed history load (first page or more) if it was the latest
  // request; null before a load, while a load runs, after a successful one, after
  // `clearHistory` and after a Project change. With a null `history` it means the first load
  // failed ("not loaded yet" is never an error); with entries it means loading more failed.
  readonly historyError: OperationErrorKind | null;
  // The last commit made in this Project during this session (for a UI to confirm it);
  // null before one and after a Project change. A failed commit leaves it as is.
  readonly lastCommit: { readonly commitId: string | null } | null;
}

export const GIT_OPERATION_LABELS = [
  "refreshGitStatus",
  "stageGitFiles",
  "unstageGitFiles",
  "discardGitChanges",
  "loadGitDiff",
  "commitGitChanges",
  "loadGitHistory",
] as const;

export type GitOperationLabel = (typeof GIT_OPERATION_LABELS)[number];

export interface GitController {
  readonly store: Store<GitState>;
  // Reads the status of the open Project. Failures are also reported through
  // `reportFailure`; a refresh without an open Project does nothing. A refresh requested
  // while another one is still waiting in the queue shares it.
  refreshGitStatus(): Promise<OperationResult<void>>;
  // The same read for the refreshes nobody asked for (after the app saved, when the window
  // regains focus): it goes through the same queue and shares a waiting refresh, but it
  // neither sets `refreshing` (the panel must not flash on every auto-save) nor reports a
  // failure (`statusError` already shows it, with a retry).
  refreshGitStatusInBackground(): Promise<OperationResult<void>>;
  // Stage / Unstage changed files (Project root relative, `/` separated) of the open
  // Project. On success the status is replaced by the one git returned (never computed
  // here). On failure it is reported and the status is read again, because git may have
  // changed the index partly.
  stage(paths: readonly string[]): Promise<OperationResult<void>>;
  unstage(paths: readonly string[]): Promise<OperationResult<void>>;
  // Discards working tree changes of the given files (restores tracked files, deletes
  // untracked ones) on the same queue, exactly like Stage: on success the status is replaced
  // by the one returned; on failure it is reported as `discardGitChanges` and the status is
  // read again (a discard may have been partly done). Destructive and not an Undo step: the
  // caller must have confirmed it, and reloads the affected Documents (`discardImpact`).
  discard(paths: readonly string[]): Promise<OperationResult<void>>;
  // Which Documents / Project files the paths belong to. A plain read, no state and no
  // queue; without an open Project it answers an empty impact.
  discardImpact(
    paths: readonly string[],
  ): Promise<OperationResult<GitDiscardImpact>>;
  // Loads the Diff of one file (Project root relative, `/` separated) on the same queue as
  // the other Git operations. A newer request supersedes an older one even if the older
  // answers later. A failure is reported and clears the diff; the non-text outcomes
  // (untracked, binary, tooLarge, notUtf8, empty) are results, not failures.
  loadDiff(path: string, side: GitDiffSide): Promise<OperationResult<void>>;
  // Commits the staged changes of the open Project on the same queue. The message is
  // passed on untouched: Rust validates it. On success the status is replaced by the one
  // returned and `lastCommit` is set; when the commit was made but the status could not be
  // read afterwards, no commit failure is reported: the status is dropped and a
  // `refreshGitStatus` problem is reported instead. On failure it is reported as
  // `commitGitChanges` and the status is read again (hooks may have changed the index).
  commit(message: string): Promise<OperationResult<void>>;
  // Loads the first page of the commit history of the open Project (page size
  // `HISTORY_PAGE_SIZE`) on the same queue, replacing the entries. A newer `loadHistory` (or
  // `clearHistory`) supersedes an older one even if the older answers later. A failure is
  // reported as `loadGitHistory` and the last loaded state comes back (null if none).
  loadHistory(): Promise<OperationResult<void>>;
  // Loads the page after the loaded ones and appends it. Does nothing without a next
  // cursor, while a history load is in flight, or without a Project.
  loadMoreHistory(): Promise<OperationResult<void>>;
  // Drops the shown history and ignores a load still in flight.
  clearHistory(): void;
  // Drops the shown Diff and ignores a load still in flight.
  clearDiff(): void;
  // Stops following the Project.
  dispose(): void;
}

export interface GitControllerDependencies {
  readonly gateway: GitGateway;
  readonly applicationStore: ApplicationStore;
  // Where a failure is shown (the notifications); the application layer does not know
  // about UI state.
  readonly reportFailure: (
    operation: GitOperationLabel,
    error: OperationError,
  ) => void;
}

const NO_PROJECT_STATE: GitState = {
  projectId: null,
  status: null,
  statusError: null,
  refreshing: false,
  operating: false,
  diff: null,
  history: null,
  historyError: null,
  lastCommit: null,
};

type IndexOperation = "stage" | "unstage" | "discard";

const INDEX_OPERATION_LABELS: Record<IndexOperation, GitOperationLabel> = {
  stage: "stageGitFiles",
  unstage: "unstageGitFiles",
  discard: "discardGitChanges",
};

export function createGitController(
  dependencies: GitControllerDependencies,
): GitController {
  const { gateway, applicationStore, reportFailure } = dependencies;
  const store = createStore<GitState>(NO_PROJECT_STATE);
  // Changes whenever the Project changes: an answer (or a queued task) of an older Project
  // must not write the state or touch git.
  let epoch = 0;
  // Git operations of this controller run one after another, so two index-changing calls
  // never overlap and a status read never interleaves with them.
  let queueTail: Promise<unknown> = Promise.resolve();
  // Identifies the latest Diff request; older answers are dropped.
  let latestDiffRequest = 0;
  // Same for the history; `settledHistory` is what a failed load goes back to.
  let latestHistoryRequest = 0;
  let settledHistory: GitHistoryState | null = null;
  let waitingRefresh: Promise<OperationResult<void>> | null = null;
  let waitingRefreshSilent = false;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queueTail.then(task);
    // A task never rejects (failures are results); this keeps the chain alive regardless.
    queueTail = next.catch(() => undefined);
    return next;
  }

  async function call(
    request: () => Promise<OperationResult<GitStatus>>,
  ): Promise<OperationResult<GitStatus>> {
    try {
      return await request();
    } catch (failure) {
      return operationErr(
        "unexpectedCommandError",
        failure instanceof Error ? failure.message : String(failure),
      );
    }
  }

  async function readStatus(
    projectId: ProjectId,
    taskEpoch: number,
    silent = false,
  ): Promise<OperationResult<void>> {
    if (!silent) store.setState((state) => ({ ...state, refreshing: true }));
    const result = await call(() => gateway.gitStatus(projectId));
    if (taskEpoch !== epoch) return result.ok ? operationOk(undefined) : result;
    if (result.ok) {
      store.setState((state) => ({
        ...state,
        projectId,
        status: result.value,
        statusError: null,
        refreshing: false,
      }));
      return operationOk(undefined);
    }
    store.setState((state) => ({
      ...state,
      projectId,
      status: null,
      statusError: result.error.kind,
      refreshing: false,
    }));
    if (!silent) reportFailure("refreshGitStatus", result.error);
    return result;
  }

  function refreshProject(
    projectId: ProjectId,
    silent = false,
  ): Promise<OperationResult<void>> {
    // A refresh someone asked for, joining a waiting background one, makes it a normal
    // one: the person who pressed the button must see the progress and the failure.
    if (!silent) waitingRefreshSilent = false;
    if (waitingRefresh !== null) return waitingRefresh;
    waitingRefreshSilent = silent;
    const taskEpoch = epoch;
    const refresh = enqueue(async () => {
      waitingRefresh = null;
      if (taskEpoch !== epoch) return operationOk(undefined);
      return readStatus(projectId, taskEpoch, waitingRefreshSilent);
    });
    waitingRefresh = refresh;
    return refresh;
  }

  function changeIndex(
    operation: IndexOperation,
    paths: readonly string[],
  ): Promise<OperationResult<void>> {
    const projectId = store.getState().projectId;
    if (projectId === null) return Promise.resolve(operationOk(undefined));
    const taskEpoch = epoch;
    return enqueue(async () => {
      if (taskEpoch !== epoch) return operationOk(undefined);
      store.setState((state) => ({ ...state, operating: true }));
      const result = await call(() => {
        switch (operation) {
          case "stage":
            return gateway.stage(projectId, paths);
          case "unstage":
            return gateway.unstage(projectId, paths);
          case "discard":
            return gateway.discard(projectId, paths);
        }
      });
      if (taskEpoch !== epoch)
        return result.ok ? operationOk(undefined) : result;
      if (result.ok) {
        store.setState((state) => ({
          ...state,
          status: result.value,
          statusError: null,
          operating: false,
        }));
        return operationOk(undefined);
      }
      reportFailure(INDEX_OPERATION_LABELS[operation], result.error);
      // Inside this task (not queued again): nothing may run between the failure and the
      // status read that shows what git actually did.
      await readStatus(projectId, taskEpoch);
      if (taskEpoch === epoch) {
        store.setState((state) => ({ ...state, operating: false }));
      }
      return result;
    });
  }

  function commit(message: string): Promise<OperationResult<void>> {
    const projectId = store.getState().projectId;
    if (projectId === null) return Promise.resolve(operationOk(undefined));
    const taskEpoch = epoch;
    return enqueue(async () => {
      if (taskEpoch !== epoch) return operationOk(undefined);
      store.setState((state) => ({ ...state, operating: true }));
      let result: OperationResult<GitCommitResult>;
      try {
        result = await gateway.commit(projectId, message);
      } catch (failure) {
        result = operationErr(
          "unexpectedCommandError",
          failure instanceof Error ? failure.message : String(failure),
        );
      }
      if (taskEpoch !== epoch)
        return result.ok ? operationOk(undefined) : result;
      if (result.ok) {
        const { commitId, status } = result.value;
        const lastCommit = { commitId };
        if (status.outcome === "updated") {
          store.setState((state) => ({
            ...state,
            status: status.status,
            statusError: null,
            lastCommit,
            operating: false,
          }));
        } else {
          // The commit exists; only the status read after it failed. Same as a failed
          // refresh: a stale status must not be shown as current.
          store.setState((state) => ({
            ...state,
            status: null,
            statusError: status.errorKind,
            lastCommit,
            operating: false,
          }));
          reportFailure("refreshGitStatus", {
            kind: status.errorKind,
            detail: "the status could not be read after the commit",
          });
        }
        return operationOk(undefined);
      }
      reportFailure("commitGitChanges", result.error);
      // Inside this task, like Stage: nothing may run between the failure and the read.
      await readStatus(projectId, taskEpoch);
      if (taskEpoch === epoch) {
        store.setState((state) => ({ ...state, operating: false }));
      }
      return result;
    });
  }

  function loadDiff(
    path: string,
    side: GitDiffSide,
  ): Promise<OperationResult<void>> {
    const projectId = store.getState().projectId;
    if (projectId === null) return Promise.resolve(operationOk(undefined));
    const taskEpoch = epoch;
    latestDiffRequest += 1;
    const request = latestDiffRequest;
    store.setState((state) => ({
      ...state,
      diff: { path, side, status: "loading" },
    }));
    return enqueue(async () => {
      // Superseded while waiting in the queue: git need not be asked.
      if (taskEpoch !== epoch || request !== latestDiffRequest) {
        return operationOk(undefined);
      }
      let result: OperationResult<GitDiff>;
      try {
        result = await gateway.diff(projectId, path, side);
      } catch (failure) {
        result = operationErr(
          "unexpectedCommandError",
          failure instanceof Error ? failure.message : String(failure),
        );
      }
      if (taskEpoch !== epoch || request !== latestDiffRequest) {
        return result.ok ? operationOk(undefined) : result;
      }
      if (result.ok) {
        store.setState((state) => ({
          ...state,
          diff: { path, side, status: "loaded", result: result.value },
        }));
        return operationOk(undefined);
      }
      store.setState((state) => ({ ...state, diff: null }));
      reportFailure("loadGitDiff", result.error);
      return result;
    });
  }

  async function fetchHistoryPage(
    projectId: ProjectId,
    cursor: string | null,
  ): Promise<OperationResult<GitHistoryPage>> {
    try {
      return await gateway.history(projectId, HISTORY_PAGE_SIZE, cursor);
    } catch (failure) {
      return operationErr(
        "unexpectedCommandError",
        failure instanceof Error ? failure.message : String(failure),
      );
    }
  }

  // `previous` is the loaded state a `loadMore` appends to; null for the first page.
  function runHistoryLoad(
    projectId: ProjectId,
    previous: GitHistoryState | null,
  ): Promise<OperationResult<void>> {
    const taskEpoch = epoch;
    const request = latestHistoryRequest;
    const cursor = previous?.nextCursor ?? null;
    return enqueue(async () => {
      // Superseded while waiting in the queue: git need not be asked.
      if (taskEpoch !== epoch || request !== latestHistoryRequest) {
        return operationOk(undefined);
      }
      const result = await fetchHistoryPage(projectId, cursor);
      if (taskEpoch !== epoch || request !== latestHistoryRequest) {
        return result.ok ? operationOk(undefined) : result;
      }
      if (result.ok) {
        // Pages come from a fixed HEAD with offsets, so a repeat should not happen; the
        // UI must still never show one commit twice, so a known commit is dropped.
        const knownIds = new Set(
          (previous?.entries ?? []).map((known) => known.commitId),
        );
        settledHistory = {
          status: "loaded",
          entries: [
            ...(previous?.entries ?? []),
            ...result.value.entries.filter(
              (added) => !knownIds.has(added.commitId),
            ),
          ],
          nextCursor: result.value.nextCursor,
        };
        store.setState((state) => ({
          ...state,
          history: settledHistory,
          historyError: null,
        }));
        return operationOk(undefined);
      }
      store.setState((state) => ({
        ...state,
        history: settledHistory,
        historyError: result.error.kind,
      }));
      reportFailure("loadGitHistory", result.error);
      return result;
    });
  }

  function loadHistory(): Promise<OperationResult<void>> {
    const projectId = store.getState().projectId;
    if (projectId === null) return Promise.resolve(operationOk(undefined));
    latestHistoryRequest += 1;
    store.setState((state) => ({
      ...state,
      history: { status: "loading", entries: [], nextCursor: null },
      historyError: null,
    }));
    return runHistoryLoad(projectId, null);
  }

  function loadMoreHistory(): Promise<OperationResult<void>> {
    const { projectId, history } = store.getState();
    if (
      projectId === null ||
      history === null ||
      history.status === "loading" ||
      history.nextCursor === null
    ) {
      return Promise.resolve(operationOk(undefined));
    }
    store.setState((state) => ({
      ...state,
      history: { ...history, status: "loading" },
      historyError: null,
    }));
    return runHistoryLoad(projectId, history);
  }

  function followProject(): void {
    const projectId = applicationStore.getState().project?.projectId ?? null;
    if (projectId === store.getState().projectId) return;
    epoch += 1;
    latestDiffRequest += 1;
    latestHistoryRequest += 1;
    settledHistory = null;
    waitingRefresh = null;
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
    async refreshGitStatusInBackground() {
      const projectId = store.getState().projectId;
      return projectId === null
        ? operationOk(undefined)
        : refreshProject(projectId, true);
    },
    stage: (paths) => changeIndex("stage", paths),
    unstage: (paths) => changeIndex("unstage", paths),
    discard: (paths) => changeIndex("discard", paths),
    async discardImpact(paths) {
      const projectId = store.getState().projectId;
      if (projectId === null) {
        return operationOk({ documentIds: [], projectFilesAffected: false });
      }
      try {
        return await gateway.discardImpact(projectId, paths);
      } catch (failure) {
        return operationErr(
          "unexpectedCommandError",
          failure instanceof Error ? failure.message : String(failure),
        );
      }
    },
    loadDiff,
    commit,
    loadHistory,
    loadMoreHistory,
    clearHistory() {
      latestHistoryRequest += 1;
      settledHistory = null;
      store.setState((state) => ({
        ...state,
        history: null,
        historyError: null,
      }));
    },
    clearDiff() {
      latestDiffRequest += 1;
      store.setState((state) => ({ ...state, diff: null }));
    },
    dispose: unsubscribe,
  };
}
