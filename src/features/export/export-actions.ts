// Exports: writing a Document, a sheet or a diagram somewhere outside the Project. Rust
// shows the save dialog and writes; the app only says what to write.

import type { ExportOutcome } from "../../application/ports/asset-types";
import type { AssetUrlResolver } from "../../application/ports/asset-url-resolver";
import type { OperationResult } from "../../application/ports/operation-error";
import { operationErr } from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import type { CanvasActions } from "../canvas/canvas-actions";
import type { MermaidRenderer } from "../mermaid/mermaid-renderer-types";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import type { UiStateStore } from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";
import {
  exportPalette,
  renderDiagramForExport,
  svgFileText,
  svgToPng,
} from "./diagram-export";
import { EXPORT_CONFIG } from "./export-config";
import { buildExportHtml, type ExportLayout } from "./export-html";
import { gatherSheets } from "./gather-sheets";

export interface DiagramExportInput {
  readonly renderer: MermaidRenderer;
  readonly source: string;
  readonly kind: "svg" | "png";
  // The suggested file name (a caption); a fallback is used when it is empty.
  readonly name: string;
}

export interface SheetsExportInput {
  readonly renderer: MermaidRenderer;
  readonly documentId: DocumentId;
  readonly sheetIds: readonly SheetId[];
  // The page title and the suggested file name.
  readonly title: string;
}

export interface ExportActions {
  // Sheets as one self-contained HTML page (blocks at their places, pictures inside).
  exportSheetsHtml(
    input: SheetsExportInput,
  ): Promise<OperationResult<ExportOutcome>>;
  // The same page laid out for printing (one page per sheet, or cut into paper pages).
  buildPrintPage(
    input: SheetsExportInput & { readonly layout: ExportLayout },
  ): Promise<OperationResult<string>>;
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
  readonly canvasActions: Pick<CanvasActions, "loadSheetContents">;
  readonly assetUrlResolver: AssetUrlResolver;
}

export function createExportActions(
  dependencies: ExportActionsDependencies,
): ExportActions {
  const {
    gateway,
    applicationStore,
    uiStateStore,
    actions,
    canvasActions,
    assetUrlResolver,
  } = dependencies;

  async function pageOf(
    input: SheetsExportInput,
    layout: ExportLayout,
  ): Promise<OperationResult<string>> {
    const gathered = await gatherSheets(
      {
        gateway,
        applicationStore,
        canvasActions,
        assetUrlResolver,
        renderer: input.renderer,
      },
      input.documentId,
      input.sheetIds,
    );
    if (!gathered.ok) return gathered;
    return {
      ok: true,
      value: buildExportHtml({
        title: input.title,
        sheets: gathered.value,
        palette: exportPalette(document.documentElement),
        layout,
      }),
    };
  }

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
    async exportSheetsHtml(input) {
      const page = await pageOf(input, { kind: "screen" });
      if (!page.ok) return reported(page);
      return reported(
        await gateway.exportFile(
          "html",
          input.title,
          new TextEncoder().encode(page.value),
        ),
      );
    },

    async buildPrintPage(input) {
      return reported(await pageOf(input, input.layout));
    },

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
