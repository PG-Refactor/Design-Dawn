import { useMemo } from "react";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { requestGitCommit, requestGitPush } from "./git-action-flow";
import { runUndoLastCommit } from "./git-commit-flow";
import type { GitMenuRunner } from "./git-menu-items";
import { runGitFetch, runGitPull, runGitSync } from "./git-remote-flow";

// Connects the menu items to the Git flows. The outcomes are not used here: a failure is
// already reported by the flow itself.
export function useGitMenuRunner(): GitMenuRunner {
  const services = useWorkspaceServices();
  return useMemo(
    () => ({
      commit: (action) => void requestGitCommit(services, action),
      push: () => void requestGitPush(services),
      pull: () => void runGitPull(services),
      fetch: () => void runGitFetch(services),
      sync: () => void runGitSync(services),
      undoLastCommit: () => void runUndoLastCommit(services),
    }),
    [services],
  );
}
