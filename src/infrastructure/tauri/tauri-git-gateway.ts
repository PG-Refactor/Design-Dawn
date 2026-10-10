import type { GitGateway } from "../../application/ports/git-gateway";
import {
  gitCommit,
  gitDiff,
  gitDiscard,
  gitDiscardImpact,
  gitHistory,
  gitStage,
  gitStatus,
  gitUndoLastCommit,
  gitUnstage,
} from "./git-client";

// `CommandResult` and `OperationResult` share one shape, so the client is the gateway.
export function createTauriGitGateway(): GitGateway {
  return {
    gitStatus,
    stage: gitStage,
    unstage: gitUnstage,
    discard: gitDiscard,
    discardImpact: gitDiscardImpact,
    diff: gitDiff,
    commit: gitCommit,
    undoLastCommit: gitUndoLastCommit,
    history: gitHistory,
  };
}
