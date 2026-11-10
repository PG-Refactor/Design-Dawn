// Typed wrappers for the asset Tauri commands. Dropped files never
// pass through the Frontend: Rust keeps their paths and announces only a `dropId`.

import type { ContentPath } from "../../domain/block/content-path";
import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import {
  toCopiedAsset,
  toDropImportResult,
  toExportOutcome,
  toImageSelection,
  toImportedImageResult,
  toSpreadsheetSelection,
} from "./asset-payloads";
import type {
  CopiedAsset,
  DropImportResult,
  ExportFileKind,
  ExportOutcome,
  ImageSelection,
  ImportedImage,
  SpreadsheetSelection,
} from "./asset-types";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
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
): Promise<CommandResult<ExportOutcome>> {
  return call(
    COMMANDS.exportDocumentMarkdown,
    { projectId, documentId },
    toExportOutcome,
  );
}
