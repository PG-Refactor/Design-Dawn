// Typed wrappers for the asset Tauri commands. Dropped files never
// pass through the Frontend: Rust keeps their paths and announces only a `dropId`.

import type { ContentPath } from "../../domain/block/content-path";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import {
  toCopiedAsset,
  toDropImportResult,
  toExportFolderChoice,
  toExportOutcome,
  toFileName,
  toFileNames,
  toImageSelection,
  toImportedImageResult,
  toSpreadsheetSelection,
  toUnusedAssets,
} from "./asset-payloads";
import type {
  CopiedAsset,
  DropImportResult,
  ExportFileKind,
  ExportFolderChoice,
  ExportFolderFile,
  ExportOutcome,
  ImageSelection,
  ImportedImage,
  PdfPageExtent,
  SpreadsheetSelection,
  UnusedAsset,
} from "./asset-types";
import { COMMANDS } from "./command-constants";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import { call, callWithBytes } from "./invoke-command";

// Header names of `export_file`; they must match `EXPORT_HEADER_*` in
// `src-tauri/src/commands/mod.rs`. The name is percent-encoded: headers carry ASCII only.
const EXPORT_HEADERS = {
  kind: "x-dawn-export-kind",
  name: "x-dawn-export-name",
} as const;

// An export the app prepared (a diagram's SVG / PNG, a sheet's HTML page): Rust shows the
// save dialog, suggesting `suggestedName` plus the kind's extension, and writes `bytes`.
export function exportFile(
  kind: ExportFileKind,
  suggestedName: string,
  bytes: Uint8Array,
): Promise<CommandResult<ExportOutcome>> {
  return callWithBytes(
    COMMANDS.exportFile,
    bytes,
    {
      [EXPORT_HEADERS.kind]: kind,
      [EXPORT_HEADERS.name]: encodeURIComponent(suggestedName),
    },
    toExportOutcome,
  );
}

// Header names of `import_pasted_image`; they must match `PASTE_HEADER_*` in
// `src-tauri/src/commands/mod.rs`.
const PASTE_HEADERS = {
  projectId: "x-dawn-project-id",
  documentId: "x-dawn-document-id",
  extension: "x-dawn-image-extension",
} as const;

// Stores image bytes from the clipboard in the Document's assets (validated like a dropped
// file). `extension` is the format the bytes claim (`png`, `jpg` ...).
export function importPastedImage(
  projectId: ProjectId,
  documentId: DocumentId,
  bytes: Uint8Array,
  extension: string,
): Promise<CommandResult<ImportedImage>> {
  return callWithBytes(
    COMMANDS.importPastedImage,
    bytes,
    {
      [PASTE_HEADERS.projectId]: projectId,
      [PASTE_HEADERS.documentId]: documentId,
      [PASTE_HEADERS.extension]: extension,
    },
    toImportedImageResult,
  );
}

// Imports the files of the latest drop into the Document's assets. Files that fail
// validation come back in `rejected`; an unknown or replaced `dropId` is the error kind
// `invalidDropSelection`.
export function importDroppedImages(
  dropId: string,
  projectId: ProjectId,
  documentId: DocumentId,
): Promise<CommandResult<DropImportResult>> {
  return call(
    COMMANDS.importDroppedImages,
    { dropId, projectId, documentId },
    toDropImportResult,
  );
}

// Copies an image asset into another Document (Block copy / paste across Documents).
// Copying into the Document the asset already lives in returns the same contentPath.
export function copyAssetToDocument(
  projectId: ProjectId,
  sourceDocumentId: DocumentId,
  contentPath: ContentPath,
  targetDocumentId: DocumentId,
): Promise<CommandResult<CopiedAsset>> {
  return call(
    COMMANDS.copyAssetToDocument,
    { projectId, sourceDocumentId, contentPath, targetDocumentId },
    toCopiedAsset,
  );
}

// The files of the Document's assets/ that nothing in the Document refers to.
export function listUnusedAssets(
  projectId: ProjectId,
  documentId: DocumentId,
): Promise<CommandResult<readonly UnusedAsset[]>> {
  return call(
    COMMANDS.listUnusedAssets,
    { projectId, documentId },
    toUnusedAssets,
  );
}

// Deletes the chosen files that are still unused; resolves to those removed.
export function deleteUnusedAssets(
  projectId: ProjectId,
  documentId: DocumentId,
  contentPaths: readonly string[],
): Promise<CommandResult<readonly string[]>> {
  return call(
    COMMANDS.deleteUnusedAssets,
    { projectId, documentId, contentPaths },
    toFileNames,
  );
}

// Opens the OS dialog for image files (in Rust). The chosen files become this window's
// latest drop: they are imported with `importDroppedImages(dropId, ...)`.
export function selectImageFiles(): Promise<CommandResult<ImageSelection>> {
  return call(COMMANDS.selectImageFiles, {}, toImageSelection);
}

// Opens the OS dialog for a spreadsheet (in Rust) and returns the values of its sheets.
export function readSpreadsheetViaDialog(): Promise<
  CommandResult<SpreadsheetSelection>
> {
  return call(COMMANDS.readSpreadsheetViaDialog, {}, toSpreadsheetSelection);
}

// "Export as Markdown…": the save dialog and the writing happen in Rust, which reads the
// Document from disk (save it first).
export function exportDocumentMarkdown(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId?: SheetId,
  suggestedName?: string,
): Promise<CommandResult<ExportOutcome>> {
  return call(
    COMMANDS.exportDocumentMarkdown,
    {
      projectId,
      documentId,
      sheetId: sheetId ?? null,
      suggestedName: suggestedName ?? null,
    },
    toExportOutcome,
  );
}

// An image of an opened Document as a `data:` URL (for an export that carries it inside).
export function assetDataUrl(
  projectId: ProjectId,
  documentId: DocumentId,
  contentPath: ContentPath,
): Promise<CommandResult<string>> {
  return call(
    COMMANDS.assetDataUrl,
    { projectId, documentId, contentPath },
    (payload) =>
      typeof payload === "string"
        ? commandOk(payload)
        : commandErr("invalidCommandResponse", "expected a data URL"),
  );
}

// Header names of the folder exports; they must match `HEADER_*` in
// `src-tauri/src/commands/export_folder.rs`.
const FOLDER_HEADERS = {
  folder: "x-dawn-export-folder",
  name: EXPORT_HEADERS.name,
  kind: EXPORT_HEADERS.kind,
  page: "x-dawn-export-page",
  subfolder: "x-dawn-export-subfolder",
} as const;

// Must match `SUBFOLDER_SEPARATOR` in `src-tauri/src/commands/export_folder.rs`.
const subfolderHeader = (folders: readonly string[]) =>
  folders.map((name) => encodeURIComponent(name)).join("/");
const HTML_FORMAT = "html";

// "Export Documents…": Rust's folder dialog; the folder is then named by its token.
export function chooseExportFolder(): Promise<
  CommandResult<ExportFolderChoice>
> {
  return call(COMMANDS.chooseExportFolder, {}, toExportFolderChoice);
}

export function exportFolderExisting(
  folder: string,
  files: readonly ExportFolderFile[],
): Promise<CommandResult<string[]>> {
  return call(COMMANDS.exportFolderExisting, { folder, files }, toFileNames);
}

// Rust reads the Document from disk (save it first).
export function exportMarkdownIntoFolder(
  projectId: ProjectId,
  documentId: DocumentId,
  folder: string,
  stem: string,
  folders: readonly string[],
): Promise<CommandResult<string>> {
  return call(
    COMMANDS.exportMarkdownIntoFolder,
    { projectId, documentId, folder, stem, folders },
    toFileName,
  );
}

export function exportHtmlIntoFolder(
  folder: string,
  stem: string,
  bytes: Uint8Array,
  folders: readonly string[],
): Promise<CommandResult<string>> {
  return callWithBytes(
    COMMANDS.exportIntoFolder,
    bytes,
    {
      [FOLDER_HEADERS.folder]: folder,
      [FOLDER_HEADERS.kind]: HTML_FORMAT,
      [FOLDER_HEADERS.name]: encodeURIComponent(stem),
      [FOLDER_HEADERS.subfolder]: subfolderHeader(folders),
    },
    toFileName,
  );
}

export function exportPdfIntoFolder(
  folder: string,
  stem: string,
  html: Uint8Array,
  largestPage: PdfPageExtent,
  folders: readonly string[],
): Promise<CommandResult<string>> {
  return callWithBytes(
    COMMANDS.exportPdfIntoFolder,
    html,
    {
      [FOLDER_HEADERS.folder]: folder,
      [FOLDER_HEADERS.name]: encodeURIComponent(stem),
      [FOLDER_HEADERS.page]: `${largestPage.width},${largestPage.height}`,
      [FOLDER_HEADERS.subfolder]: subfolderHeader(folders),
    },
    toFileName,
  );
}

export function exportPdfFile(
  suggestedName: string,
  html: Uint8Array,
  largestPage: PdfPageExtent,
): Promise<CommandResult<ExportOutcome>> {
  return callWithBytes(
    COMMANDS.exportPdfFile,
    html,
    {
      [FOLDER_HEADERS.name]: encodeURIComponent(suggestedName),
      [FOLDER_HEADERS.page]: `${largestPage.width},${largestPage.height}`,
    },
    toExportOutcome,
  );
}

// Must match `HEADER_TITLE` in `src-tauri/src/commands/print_window.rs`.
const PRINT_TITLE_HEADER = "x-dawn-print-title";

export function openPrintWindow(
  title: string,
  html: Uint8Array,
): Promise<CommandResult<void>> {
  return callWithBytes(
    COMMANDS.openPrintWindow,
    html,
    { [PRINT_TITLE_HEADER]: encodeURIComponent(title) },
    () => commandOk(undefined),
  );
}

export function printWindowsOpen(): Promise<CommandResult<boolean>> {
  return call(COMMANDS.printWindowsOpen, {}, (payload) =>
    typeof payload === "boolean"
      ? commandOk(payload)
      : commandErr("invalidCommandResponse", "not a boolean"),
  );
}

export function closePrintWindows(): Promise<CommandResult<void>> {
  return call(COMMANDS.closePrintWindows, {}, () => commandOk(undefined));
}
