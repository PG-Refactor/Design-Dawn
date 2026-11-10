// Exports: writing a Document, a sheet or a diagram somewhere outside the Project. Rust
// shows the save dialog and writes; the app only says what to write.

import type { ExportOutcome } from "../../application/ports/asset-types";
import type { OperationResult } from "../../application/ports/operation-error";
import { operationErr } from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { DocumentId } from "../../domain/shared/entity-id";
import type { MermaidRenderer } from "../mermaid/mermaid-renderer-types";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import type { UiStateStore } from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";
import {
  renderDiagramForExport,
  svgFileText,
  svgToPng,
} from "./diagram-export";
import { EXPORT_CONFIG } from "./export-config";

export interface DiagramExportInput {
  readonly renderer: MermaidRenderer;
  readonly source: string;
  readonly kind: "svg" | "png";
  // The suggested file name (a caption); a fallback is used when it is empty.
  readonly name: string;
}

export interface ExportActions {
  // One Mermaid diagram as an SVG or PNG file, rendered in the light theme.
  exportDiagram(
    input: DiagramExportInput,
  ): Promise<OperationResult<ExportOutcome>>;
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
    async exportDiagram({ renderer, source, kind, name }) {
      const rendered = await renderDiagramForExport(renderer, source);
      if (!rendered.ok) {
        return reported(operationErr("exportFailed", rendered.message));
      }
      const file = svgFileText(rendered.svg);
      if (file === null) {
        return reported(
          operationErr("exportFailed", "the diagram has no size"),
        );
      }
      let bytes: Uint8Array;
      try {
        bytes =
          kind === "svg"
            ? new TextEncoder().encode(file.text)
            : await svgToPng(file, rendered.background);
      } catch (error) {
        return reported(operationErr("exportFailed", String(error)));
      }
      const suggested =
        name.trim().length > 0
          ? name.trim()
          : EXPORT_CONFIG.diagramFallbackName;
      return reported(await gateway.exportFile(kind, suggested, bytes));
    },

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
