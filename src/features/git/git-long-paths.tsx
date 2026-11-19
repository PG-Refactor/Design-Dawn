import { useEffect, useRef, useState } from "react";
import type { GitLongPaths } from "../../application/ports/git-gateway";
import { showNotice } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { useGitState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";

// Files whose path is too long for Git on Windows: a warning in the panel while the
// repository does not allow long paths, with the files and a way to allow them (asked
// first: it changes the repository's own settings).
export function GitLongPathsWarning() {
  const messages = useMessages().git;
  const { gitController } = useWorkspaceServices();
  const longPaths = useGitState((git) => git.status?.longPaths ?? null);
  const operating = useGitState((git) => git.operating);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (longPaths === null) return null;
  // The strong warning while this PC's Git cannot handle the files; otherwise a gentler
  // note for paths that are long inside the Project (other PCs may not handle them).
  if (longPaths.count === 0 || longPaths.enabled) {
    return longPaths.portableCount === 0 ? null : (
      <div role="status" className="git-long-paths git-long-paths--note">
        <p className="git-long-paths__title">
          {messages.portablePathsTitle(longPaths.portableCount)}
        </p>
        <p>{messages.portablePathsBody}</p>
        <FileList
          files={longPaths.portableFiles}
          count={longPaths.portableCount}
        />
      </div>
    );
  }

  async function enable(): Promise<void> {
    setBusy(true);
    try {
      await gitController.enableLongPaths();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div role="alert" className="git-long-paths">
      <p className="git-long-paths__title">
        {messages.longPathsTitle(longPaths.count)}
      </p>
      <p>{messages.longPathsBody}</p>
      <FileList files={longPaths.files} count={longPaths.count} />
      {confirming ? (
        <div className="git-long-paths__confirm">
          <p>{messages.enableLongPathsConfirm}</p>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void enable()}
          >
            {messages.enableLongPathsDo}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            {messages.enableLongPathsCancel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="button"
          disabled={operating}
          onClick={() => setConfirming(true)}
        >
          {messages.enableLongPaths}
        </button>
      )}
    </div>
  );
}

function FileList({
  files,
  count,
}: {
  readonly files: readonly string[];
  readonly count: number;
}) {
  const messages = useMessages().git;
  const more = count - files.length;
  return (
    <details>
      <summary>{messages.longPathsList}</summary>
      <ul className="git-long-paths__files">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
        {more > 0 && <li>{messages.longPathsMore(more)}</li>}
      </ul>
    </details>
  );
}

// Which notice, if any, more files with long paths call for.
function newNotice(
  before: GitLongPaths | null,
  now: GitLongPaths | null,
): "longPathsFound" | "portablePathsFound" | null {
  if (now === null) return null;
  if (!now.enabled && now.count > (before?.count ?? 0)) return "longPathsFound";
  if (now.portableCount > (before?.portableCount ?? 0)) {
    return "portablePathsFound";
  }
  return null;
}

// A short notice when files with too long paths appear (a Document or sheet just made
// deep in folders), wherever the window is: the Git panel may not be open.
export function useLongPathsNotice(): void {
  const { uiStateStore } = useWorkspaceServices();
  const longPaths = useGitState((git) => git.status?.longPaths ?? null);
  const projectId = useGitState((git) => git.projectId);
  const previous = useRef<{
    readonly projectId: string | null;
    readonly longPaths: GitLongPaths | null;
  }>({ projectId: null, longPaths: null });
  useEffect(() => {
    const before = previous.current;
    previous.current = { projectId, longPaths };
    // The first status of a Project counts too: it is when the user should learn of it.
    const sameProject = before.projectId === projectId;
    if (sameProject && before.longPaths === longPaths) return;
    const notice = newNotice(sameProject ? before.longPaths : null, longPaths);
    if (notice !== null) {
      uiStateStore.setState((state) => showNotice(state, notice));
    }
  }, [longPaths, projectId, uiStateStore]);
}
