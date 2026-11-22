import type { GitGateway } from "../../application/ports/git-gateway";
import {
  gitAbortMerge,
  gitCommit,
  gitConflictVersions,
  gitDiff,
  gitDiscard,
  gitDiscardImpact,
  gitEnableLongPaths,
  gitFetch,
  gitHistory,
  gitPublish,
  gitPull,
  gitPush,
  gitRemotes,
  gitResolveConflict,
  gitResolveConflictWithSide,
  gitSheetVersions,
  gitStage,
  gitStatus,
  gitUndoLastCommit,
  gitUnstage,
} from "./git-client";

// `CommandResult` and `OperationResult` share one shape, so the client is the gateway.
export function createTauriGitGateway(): GitGateway {
  return {
    gitStatus,
    enableLongPaths: gitEnableLongPaths,
    stage: gitStage,
    conflictVersions: gitConflictVersions,
    sheetVersions: gitSheetVersions,
    resolveConflict: gitResolveConflict,
    resolveConflictWithSide: gitResolveConflictWithSide,
    unstage: gitUnstage,
    discard: gitDiscard,
    discardImpact: gitDiscardImpact,
    diff: gitDiff,
    commit: gitCommit,
    undoLastCommit: gitUndoLastCommit,
    history: gitHistory,
    fetch: gitFetch,
    pull: gitPull,
    abortMerge: gitAbortMerge,
    push: gitPush,
    publish: gitPublish,
    remotes: gitRemotes,
  };
}
