// What the workspace tells the rest of the app after the fact. Application code never
// touches UI state: a subscriber (see `features/workspace/ui-state`) cleans up references
// to documents and sheets that no longer exist.

import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import { createListenerSet } from "../listener-set";

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

export function createWorkspaceEvents(
  reportListenerFailure?: (failure: unknown) => void,
): WorkspaceEvents {
  const listeners = createListenerSet<WorkspaceEvent>(reportListenerFailure);
  return { emit: listeners.notify, subscribe: listeners.subscribe };
}
