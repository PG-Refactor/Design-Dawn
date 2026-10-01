import { mapOperationResult } from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import {
  createBlockContent,
  createDocument,
  createProject,
  createSheet,
  deleteBlockContent,
  deleteDocument,
  deleteSheet,
  loadDocument,
  openProject,
  readBlockContent,
  restoreBlockContent,
  saveDocument,
  saveProject,
  saveSheet,
  selectProjectFolder,
} from "./persistence-client";

// Thin: maps the application port onto the Tauri client. `CommandResult` and
// `OperationResult` share one shape, so only the save results (which carry a `written`
// flag the application does not need) are converted.
function discard(): void {}

export function createTauriPersistenceGateway(): PersistenceGateway {
  return {
    selectProjectFolder,
    openProject,
    createProject,
    saveProject: async (projectId, project) =>
      mapOperationResult(await saveProject(projectId, project), discard),
    createDocument,
    loadDocument,
    createSheet,
    deleteSheet: async (projectId, documentId, sheetId) =>
      mapOperationResult(
        await deleteSheet(projectId, documentId, sheetId),
        discard,
      ),
    deleteDocument: async (projectId, documentId) =>
      mapOperationResult(await deleteDocument(projectId, documentId), discard),
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
