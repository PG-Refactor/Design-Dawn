// Non-React glue: applies the workspace's removal events to UI state. Application code
// never touches UI state, so this subscriber is the only place that links the two.

import type { Workspace } from "../../../application/workspace/workspace";
import type { UiStateStore } from "./ui-state";
import {
  removeDocumentReferences,
  removeSheetFromUiState,
  resetUiState,
} from "./ui-state-cleanup";

// Returns the unsubscribe function.
export function connectWorkspaceToUiState(
  workspace: Pick<Workspace, "subscribe">,
  uiStore: UiStateStore,
): () => void {
  return workspace.subscribe((event) => {
    switch (event.type) {
      case "documentClosed":
        uiStore.setState((state) =>
          removeDocumentReferences(state, event.documentId, event.sheetIds),
        );
        return;
      case "sheetDeleted":
        uiStore.setState((state) =>
          removeSheetFromUiState(state, event.documentId, event.sheetId),
        );
        return;
      case "projectClosed":
        uiStore.setState(resetUiState());
        return;
    }
  });
}
