// What the workspace tells the rest of the app after the fact. Application code never
// touches UI state: a subscriber (see `features/workspace/ui-state`) cleans up references
// to documents and sheets that no longer exist.

import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";

export type WorkspaceEvent =
  | {
      readonly type: "documentClosed";
      readonly documentId: DocumentId;
      // Every sheet the document had, including ones that failed to load.
      readonly sheetIds: readonly SheetId[];
    }
  | {
      readonly type: "sheetDeleted";
      readonly documentId: DocumentId;
      readonly sheetId: SheetId;
    }
  | { readonly type: "projectClosed"; readonly projectId: ProjectId };

export type WorkspaceEventListener = (event: WorkspaceEvent) => void;

export interface WorkspaceEvents {
  emit(event: WorkspaceEvent): void;
  subscribe(listener: WorkspaceEventListener): () => void;
}

// Rethrown outside the emitting call so it surfaces as an unhandled error.
function rethrowLater(failure: unknown): void {
  queueMicrotask(() => {
    throw failure;
  });
}

export function createWorkspaceEvents(
  reportListenerFailure: (failure: unknown) => void = rethrowLater,
): WorkspaceEvents {
  const listeners = new Set<{ readonly listener: WorkspaceEventListener }>();
  return {
    emit(event) {
      for (const subscription of [...listeners]) {
        if (!listeners.has(subscription)) continue;
        try {
          subscription.listener(event);
        } catch (failure) {
          // A faulty subscriber must not abort the operation that is emitting (it may
          // sit between two disk steps), but the failure must not vanish either.
          reportListenerFailure(failure);
        }
      }
    },
    subscribe(listener) {
      const subscription = { listener };
      listeners.add(subscription);
      return () => {
        listeners.delete(subscription);
      };
    },
  };
}
