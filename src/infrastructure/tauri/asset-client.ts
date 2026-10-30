// Typed wrappers for the asset Tauri commands. Dropped files never
// pass through the Frontend: Rust keeps their paths and announces only a `dropId`.

import type { ContentPath } from "../../domain/block/content-path";
import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import { toCopiedAsset, toDropImportResult } from "./asset-payloads";
import type { CopiedAsset, DropImportResult } from "./asset-types";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
import { call } from "./invoke-command";

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
