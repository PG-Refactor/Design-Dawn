// Where UI-local drafts (text typed into an editor but not yet committed as a command)
// announce themselves, so "save everything" can turn them into commands first
// (`docs/architecture.md` §10.1). UI plumbing only: not application state, not in a store,
// and never part of the history. Only Markdown editors register; rename inputs and name
// dialogs do not.

import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";

export interface DraftCommitter {
  // Applies the draft as one command without ending the edit. Ok when there is nothing
  // new to apply; a failure leaves the draft in place.
  commitDraft(): Promise<OperationResult<void>>;
}

export interface DraftRegistry {
  // Returns the unregister function; calling it more than once is harmless.
  register(committer: DraftCommitter): () => void;
  // Commits every registered draft one after another. A failure does not stop the others
  // (their text must not stay unsaved because a different draft failed); the first error
  // is returned.
  commitAll(): Promise<OperationResult<void>>;
}

export function createDraftRegistry(): DraftRegistry {
  const committers = new Set<DraftCommitter>();
  return {
    register(committer) {
      committers.add(committer);
      return () => {
        committers.delete(committer);
      };
    },
    async commitAll() {
      let firstFailure: OperationResult<void> | null = null;
      // A copy: a commit may unmount an editor, which unregisters while we iterate.
      for (const committer of [...committers]) {
        const result = await committer.commitDraft();
        if (!result.ok && firstFailure === null) firstFailure = result;
      }
      return firstFailure ?? operationOk(undefined);
    },
  };
}
