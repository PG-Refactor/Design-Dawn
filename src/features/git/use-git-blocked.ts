import { useGitState, useUiState } from "../workspace/workspace-hooks";

// True while a Git action must not start: another one runs, the status is being read, or
// the workspace is busy (a save, a discard, a pull reload).
export function useGitBlocked(): boolean {
  const operating = useGitState((git) => git.operating);
  const refreshing = useGitState((git) => git.refreshing);
  const busy = useUiState((ui) => ui.busy);
  return operating || refreshing || busy;
}
