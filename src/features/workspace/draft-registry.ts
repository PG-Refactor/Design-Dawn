// Where UI-local drafts (text typed into an editor but not yet committed as a command)
// announce themselves, so "save everything" can turn them into commands first
// (`docs/architecture.md` §10.1). UI plumbing only: not application state, not in a store,
// and never part of the history. Only Markdown editors register; rename inputs and name
// dialogs do not.

import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import type { DocumentId } from "../../domain/shared/entity-id";

export interface DraftCommitter {
  // The document the draft belongs to, so a move can commit just the affected ones.
  readonly documentId: DocumentId;
  // Whether the draft differs from what was last committed as a command.
  hasPendingDraft(): boolean;
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
  // Like `commitAll`, for the drafts of these documents only.
  commitFor(documentIds: readonly DocumentId[]): Promise<OperationResult<void>>;
  // Whether any of these documents has a draft that is not committed yet.
  hasPendingFor(documentIds: readonly DocumentId[]): boolean;
}

export function createDraftRegistry(): DraftRegistry {
  const committers = new Set<DraftCommitter>();

  async function commitMatching(
    matches: (committer: DraftCommitter) => boolean,
  ): Promise<OperationResult<void>> {
    let firstFailure: OperationResult<void> | null = null;
    // A copy: a commit may unmount an editor, which unregisters while we iterate.
    for (const committer of [...committers].filter(matches)) {
      const result = await committer.commitDraft();
      if (!result.ok && firstFailure === null) firstFailure = result;
    }
    return firstFailure ?? operationOk(undefined);
  }

  return {
    register(committer) {
      committers.add(committer);
      return () => {
        committers.delete(committer);
      };
    },
    commitAll: () => commitMatching(() => true),
    commitFor: (documentIds) =>
      commitMatching((committer) => documentIds.includes(committer.documentId)),
    hasPendingFor: (documentIds) =>
      [...committers].some(
        (committer) =>
          documentIds.includes(committer.documentId) &&
          committer.hasPendingDraft(),
      ),
  };
}
