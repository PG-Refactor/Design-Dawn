// Exports: writing a Document, a sheet or a diagram somewhere outside the Project. Rust
// shows the save dialog and writes; the app only says what to write.

import type {
  ExportFolderFile,
  ExportFolderFormat,
  ExportOutcome,
} from "../../application/ports/asset-types";
import type { AssetUrlResolver } from "../../application/ports/asset-url-resolver";
import type { OperationResult } from "../../application/ports/operation-error";
import {
  type OperationError,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { Workspace } from "../../application/workspace/workspace";
import { paperDimensions } from "../../domain/print/paper";
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
import {
  buildExportHtml,
  type ExportLayout,
  type ExportSheet,
  largestFitPage,
} from "./export-html";
import { gatherSheets } from "./gather-sheets";
import { fitExportPage } from "./print-frame";
import {
  createPrintSettingsStore,
  type PrintSettingsStore,
} from "./print-settings";

// The page with every text that is to fit its block sized (see `fitExportPage`).
function buildFittedExportHtml(
  input: Parameters<typeof buildExportHtml>[0],
): Promise<string> {
  return fitExportPage(buildExportHtml(input));
}

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

export interface DocumentToExport {
  readonly documentId: DocumentId;
  readonly name: string;
  // The Project folders it is in, outermost first.
  readonly folders: readonly string[];
}

// One file through the save dialog: the shown sheet, or the shown Document.
export interface ShownExportInput {
  readonly renderer: MermaidRenderer;
  readonly format: ExportFolderFormat;
  readonly documentId: DocumentId;
  readonly documentName: string;
  // Absent: the whole Document.
  readonly sheet?: { readonly sheetId: SheetId; readonly name: string };
}

export interface DocumentsExportInput {
  readonly renderer: MermaidRenderer;
  readonly documents: readonly DocumentToExport[];
  readonly format: ExportFolderFormat;
  // The token of the folder chosen in Rust's dialog.
  readonly folder: string;
  // Each file goes into folders named like the Project's folders it is in.
  readonly keepFolders: boolean;
  // Called after each Document, written or not.
  readonly onProgress?: (done: number, total: number) => void;
}

export interface DocumentExportFailure {
  readonly name: string;
  // `null`: nothing to write (the Document has no blocks).
  readonly error: OperationError | null;
}

export interface DocumentsExportOutcome {
  readonly written: readonly string[];
  readonly failed: readonly DocumentExportFailure[];
}

// The file stem of each Document in order: its name, with " (2)", " (3)" ... after a name
// used before in the same output folder (Documents in different folders may share one).
export function exportStems(
  names: readonly string[],
  places: readonly string[] = [],
): string[] {
  const used = new Map<string, number>();
  return names.map((name, index) => {
    const key = `${places[index] ?? ""}\n${name.trim().toLowerCase()}`;
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

// Where each Document goes and under which name.
export function folderFilesOf(
  documents: readonly DocumentToExport[],
  format: ExportFolderFormat,
  keepFolders: boolean,
): ExportFolderFile[] {
  const folders = documents.map((document) =>
    keepFolders ? document.folders : [],
  );
  const stems = exportStems(
    documents.map((document) => document.name),
    folders.map((path) => path.join("/")),
  );
  return documents.map((document, index) => ({
    stem: stems[index] ?? document.name,
    format,
    folders: folders[index] ?? [],
  }));
}

export interface ExportActions {
  // The print choices kept between prints; also the paper of the canvas page breaks.
  readonly printSettings: PrintSettingsStore;
  // Sheets as one self-contained HTML page (blocks at their places, pictures inside).
  exportSheetsHtml(
    input: SheetsExportInput,
  ): Promise<OperationResult<ExportOutcome>>;
  // The same page laid out for printing (one page per sheet, or cut into paper pages).
  // Opens the page in a print window of its own, which shows the print dialog there.
  openPrintWindow(title: string, page: string): Promise<OperationResult<void>>;
  // Print windows of this window: is one open, and closing them all.
  printWindowsOpen(): Promise<boolean>;
  closePrintWindows(): Promise<void>;
  buildPrintPage(
    input: SheetsExportInput & { readonly layout: ExportLayout },
  ): Promise<OperationResult<string>>;
  // One Mermaid diagram as an SVG or PNG file, rendered in the light theme.
  exportDiagram(
    input: DiagramExportInput,
  ): Promise<OperationResult<ExportOutcome>>;
  // The shown sheet or Document as one file (Markdown, HTML or PDF) where the save
  // dialog says. Everything is saved first.
  exportShown(input: ShownExportInput): Promise<OperationResult<ExportOutcome>>;
  // "Export Documents…": Rust's folder dialog (cancelled: ok with null).
  chooseExportFolder(): Promise<
    OperationResult<{
      readonly token: string;
      readonly folderName: string;
    } | null>
  >;
  // The files of `documents` that are already in the folder (they would be replaced).
  existingFiles(
    folder: string,
    files: readonly ExportFolderFile[],
  ): Promise<OperationResult<string[]>>;
  // Each Document as one file in the folder (Markdown with its images, HTML, or PDF with a
  // page per sheet). Everything is saved first; a Document not open here is opened for
  // the export and closed again. One that fails is listed and the next one is written.
  exportDocuments(
    input: DocumentsExportInput,
  ): Promise<OperationResult<DocumentsExportOutcome>>;
  // Saves everything first (the export reads the files on disk), then asks where to write
  // the Document as one Markdown file.
  exportDocumentMarkdown(
    documentId: DocumentId,
  ): Promise<OperationResult<ExportOutcome>>;
}

export interface ExportActionsDependencies {
  readonly gateway: PersistenceGateway;
  // Opens a Document only for an export (no tab is activated) and closes it after.
  readonly workspace: Pick<Workspace, "openDocument" | "closeDocument">;
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
    workspace,
    applicationStore,
    uiStateStore,
    actions,
    canvasActions,
    assetUrlResolver,
  } = dependencies;
  const printSettings = createPrintSettingsStore();

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
      value: await buildFittedExportHtml({
        title: input.title,
        sheets: gathered.value,
        palette: exportPalette(document.documentElement),
        layout,
      }),
    };
  }

  // The loaded sheets of an open Document, in its order.
  function sheetIdsOf(documentId: DocumentId): SheetId[] {
    return (
      applicationStore.getState().documentDetails.get(documentId)
        ?.sheetEntries ?? []
    )
      .filter((entry) => entry.state === "loaded")
      .map((entry) => entry.sheetId);
  }

  async function sheetsOf(
    renderer: MermaidRenderer,
    documentId: DocumentId,
    onlySheet?: SheetId,
  ): Promise<OperationResult<ExportSheet[]>> {
    return gatherSheets(
      {
        gateway,
        applicationStore,
        canvasActions,
        assetUrlResolver,
        renderer,
      },
      documentId,
      onlySheet === undefined ? sheetIdsOf(documentId) : [onlySheet],
    );
  }

  // One Document into the folder; `null` when there is nothing to write.
  async function exportOne(
    input: DocumentsExportInput,
    document: DocumentToExport,
    file: ExportFolderFile,
  ): Promise<OperationResult<string | null>> {
    const { stem, folders } = file;
    const projectId = applicationStore.getState().project?.projectId ?? null;
    if (projectId === null) {
      return operationErr("projectNotOpen", "no project is open");
    }
    if (input.format === "md") {
      return gateway.exportMarkdownIntoFolder(
        projectId,
        document.documentId,
        input.folder,
        stem,
        folders,
      );
    }
    const wasOpen = applicationStore
      .getState()
      .documents.has(document.documentId);
    if (!wasOpen) {
      const opened = await workspace.openDocument(document.documentId);
      if (!opened.ok) return opened;
    }
    try {
      const sheets = await sheetsOf(input.renderer, document.documentId);
      if (!sheets.ok) return sheets;
      const palette = exportPalette(globalThis.document.documentElement);
      if (input.format === "html") {
        const page = await buildFittedExportHtml({
          title: document.name,
          sheets: sheets.value,
          palette,
          layout: { kind: "screen" },
        });
        return gateway.exportHtmlIntoFolder(
          input.folder,
          stem,
          new TextEncoder().encode(page),
          folders,
        );
      }
      const pages = pdfPages(sheets.value);
      if (pages === null) return operationOk(null);
      const page = await buildFittedExportHtml({
        title: document.name,
        sheets: sheets.value,
        palette,
        layout: pages.layout,
      });
      return gateway.exportPdfIntoFolder(
        input.folder,
        stem,
        new TextEncoder().encode(page),
        pages.page,
        folders,
      );
    } finally {
      if (!wasOpen) await workspace.closeDocument(document.documentId);
    }
  }

  // The pages of a PDF: as printing makes them (one per sheet as large as its content, or
  // cut into paper pages), and the size of the PDF's pages.
  function pdfPages(sheets: readonly ExportSheet[]): {
    readonly layout: ExportLayout;
    readonly page: { readonly width: number; readonly height: number };
  } | null {
    const { mode, paper } = printSettings.getState();
    if (mode === "paper") {
      return {
        layout: { kind: "paper", ...paper },
        page: paperDimensions(paper),
      };
    }
    const largest = largestFitPage(sheets);
    return largest === null ? null : { layout: { kind: "fit" }, page: largest };
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
    printSettings,

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

    async openPrintWindow(title, page) {
      return reported(
        await gateway.openPrintWindow(title, new TextEncoder().encode(page)),
      );
    },

    async printWindowsOpen() {
      const open = await gateway.printWindowsOpen();
      return open.ok && open.value;
    },

    async closePrintWindows() {
      await gateway.closePrintWindows();
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

    async exportShown({ renderer, format, documentId, documentName, sheet }) {
      const projectId = applicationStore.getState().project?.projectId ?? null;
      if (projectId === null) {
        return reported(operationErr("projectNotOpen", "no project is open"));
      }
      // A failed save is reported by the save itself; exporting older text would surprise.
      const saved = await actions.saveAll();
      if (!saved.ok) return saved;
      const title =
        sheet === undefined ? documentName : `${documentName} - ${sheet.name}`;
      if (format === "md") {
        return reported(
          await gateway.exportDocumentMarkdown(
            projectId,
            documentId,
            sheet?.sheetId,
            title,
          ),
        );
      }
      const gathered = await sheetsOf(renderer, documentId, sheet?.sheetId);
      if (!gathered.ok) return reported(gathered);
      const palette = exportPalette(globalThis.document.documentElement);
      if (format === "html") {
        const page = await buildFittedExportHtml({
          title,
          sheets: gathered.value,
          palette,
          layout: { kind: "screen" },
        });
        return reported(
          await gateway.exportFile(
            "html",
            title,
            new TextEncoder().encode(page),
          ),
        );
      }
      const pages = pdfPages(gathered.value);
      if (pages === null) {
        return reported(operationErr("exportFailed", "there are no blocks"));
      }
      const page = await buildFittedExportHtml({
        title,
        sheets: gathered.value,
        palette,
        layout: pages.layout,
      });
      return reported(
        await gateway.exportPdfFile(
          title,
          new TextEncoder().encode(page),
          pages.page,
        ),
      );
    },

    async chooseExportFolder() {
      const chosen = await gateway.chooseExportFolder();
      if (!chosen.ok) return reported(chosen);
      return operationOk(
        chosen.value.status === "chosen"
          ? { token: chosen.value.token, folderName: chosen.value.folderName }
          : null,
      );
    },

    async existingFiles(folder, files) {
      return reported(await gateway.exportFolderExisting(folder, files));
    },

    async exportDocuments(input) {
      // A failed save is reported by the save itself; exporting older text would surprise.
      const saved = await actions.saveAll();
      if (!saved.ok) return saved;
      const files = folderFilesOf(
        input.documents,
        input.format,
        input.keepFolders,
      );
      const written: string[] = [];
      const failed: DocumentExportFailure[] = [];
      for (const [index, entry] of input.documents.entries()) {
        const file = files[index];
        if (file === undefined) continue;
        const result = await exportOne(input, entry, file);
        if (!result.ok) failed.push({ name: entry.name, error: result.error });
        else if (result.value === null)
          failed.push({ name: entry.name, error: null });
        else written.push([...file.folders, result.value].join("/"));
        input.onProgress?.(index + 1, input.documents.length);
      }
      return operationOk({ written, failed });
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
