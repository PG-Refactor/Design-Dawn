// Exports: writing a Document, a sheet or a diagram somewhere outside the Project. Rust
// shows the save dialog and writes; the app only says what to write.

import type { ExportOutcome } from "../../application/ports/asset-types";
import type { OperationResult } from "../../application/ports/operation-error";
import { operationErr } from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { DocumentId } from "../../domain/shared/entity-id";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import type { UiStateStore } from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";

export interface ExportActions {
  // Saves everything first (the export reads the files on disk), then asks where to write
  // the Document as one Markdown file.
  exportDocumentMarkdown(
    documentId: DocumentId,
  ): Promise<OperationResult<ExportOutcome>>;
}

export interface ExportActionsDependencies {
  readonly gateway: PersistenceGateway;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: Pick<WorkspaceActions, "saveAll">;
}

export function createExportActions(
  dependencies: ExportActionsDependencies,
): ExportActions {
  const { gateway, applicationStore, uiStateStore, actions } = dependencies;

  function reported<Value>(
    result: OperationResult<Value>,
  ): OperationResult<Value> {
    if (!result.ok) {
      const { error } = result;
      uiStateStore.setState((state) =>
        addOperationError(state, "exportDocument", null, error),
      );
    }
    return result;
  }

  return {
    async exportDocumentMarkdown(documentId) {
      const projectId = applicationStore.getState().project?.projectId ?? null;
      if (projectId === null) {
        return reported(operationErr("projectNotOpen", "no project is open"));
      }
      // A failed save is reported by the save itself; exporting older text would surprise.
      const saved = await actions.saveAll();
      if (!saved.ok) return saved;
      return reported(
        await gateway.exportDocumentMarkdown(projectId, documentId),
      );
    },
  };
}
