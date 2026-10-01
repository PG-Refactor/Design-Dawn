import { mapOperationResult } from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import {
  createBlockContent,
  deleteBlockContent,
  readBlockContent,
  restoreBlockContent,
  saveDocument,
  saveSheet,
} from "./persistence-client";

// Thin: maps the application port onto the Tauri client. `CommandResult` and
// `OperationResult` share one shape, so only the save results (which carry a `written`
// flag the application does not need) are converted.
function discard(): void {}

export function createTauriPersistenceGateway(): PersistenceGateway {
  return {
    saveSheet: async (projectId, documentId, sheet) =>
      mapOperationResult(
        await saveSheet(projectId, documentId, sheet),
        discard,
      ),
    saveDocument: async (projectId, document) =>
      mapOperationResult(await saveDocument(projectId, document), discard),
    createBlockContent,
    readBlockContent,
    deleteBlockContent: async (projectId, documentId, contentPath) =>
      mapOperationResult(
        await deleteBlockContent(projectId, documentId, contentPath),
        discard,
      ),
    restoreBlockContent: async (
      projectId,
      documentId,
      blockType,
      contentPath,
      text,
    ) =>
      mapOperationResult(
        await restoreBlockContent(
          projectId,
          documentId,
          blockType,
          contentPath,
          text,
        ),
        discard,
      ),
  };
}
