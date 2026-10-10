// What counts as "not on disk yet" in the application state. Pure, so the workspace
// actions (close / move questions) and the Git commit form share one definition.

import type { DocumentId } from "../../domain/shared/entity-id";
import type { OperationError } from "../ports/operation-error";
import type { ApplicationState } from "./application-state";

interface ProjectLevelSave {
  readonly dirty: boolean;
  readonly lastError: OperationError | null;
}

function isProjectLevelUnsaved(save: ProjectLevelSave): boolean {
  return save.dirty || save.lastError !== null;
}

// A command still waiting for its save, a failed save or a save in progress in any of
// these open documents. Documents that are not open have nothing unsaved.
export function hasUnsavedDocumentChanges(
  state: ApplicationState,
  documentIds: readonly DocumentId[],
): boolean {
  return documentIds.some((documentId) => {
    const save = state.documents.get(documentId)?.save;
    return (
      save !== undefined &&
      (save.dirtySheetIds.size > 0 ||
        save.dirtyContentBlockIds.size > 0 ||
        save.documentDirty ||
        save.saving ||
        save.lastError !== null)
    );
  });
}

// The Project itself or any Folder is unsaved, or anything in an open document. Markdown
// drafts that are not committed as a command yet are not application state (the UI's draft
// registry knows them).
export function hasUnsavedProjectChanges(state: ApplicationState): boolean {
  const { project } = state;
  if (project !== null) {
    if (isProjectLevelUnsaved(project.save)) return true;
    if (project.folders.some((folder) => isProjectLevelUnsaved(folder.save))) {
      return true;
    }
  }
  return hasUnsavedDocumentChanges(state, [...state.documents.keys()]);
}
