import { mapOperationResult } from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import {
  copyAssetToDocument,
  importDroppedImages,
  selectImageFiles,
} from "./asset-client";
import {
  acceptDiskState,
  checkExternalChanges,
  closeDocument,
  closeProject,
  compareBlockContent,
  createBlockContent,
  createDocument,
  createFolder,
  createProject,
  createSheet,
  defaultProjectLocation,
  deleteBlockContent,
  deleteDocument,
  deleteFolder,
  deleteSheet,
  loadDocument,
  moveEntry,
  openProject,
  openProjectInNewWindow,
  readBlockContent,
  reloadProject,
  repairLoadIssue,
  restoreBlockContent,
  saveDocument,
  saveFolder,
  saveProject,
  saveSheet,
  selectProjectFolder,
  setDefaultProjectLocation,
  takeOpenRequest,
  updateOutdatedFiles,
  writeBlockContent,
} from "./persistence-client";

// Thin: maps the application port onto the Tauri client. `CommandResult` and
// `OperationResult` share one shape, so only the save results (which carry a `written`
// flag the application does not need) are converted.
function discard(): void {}

export function createTauriPersistenceGateway(): PersistenceGateway {
  return {
    selectProjectFolder,
    openProject,
    reloadProject,
    checkExternalChanges,
    compareBlockContent,
    repairLoadIssue,
    updateOutdatedFiles,
    acceptDiskState: async (projectId, documentId) =>
      mapOperationResult(await acceptDiskState(projectId, documentId), discard),
    openProjectInNewWindow,
    takeOpenRequest,
    closeProject: async () => mapOperationResult(await closeProject(), discard),
    createProject,
    defaultProjectLocation,
    setDefaultProjectLocation: async (selectionId) =>
      mapOperationResult(await setDefaultProjectLocation(selectionId), discard),
    saveProject: async (projectId, project) =>
      mapOperationResult(await saveProject(projectId, project), discard),
    createDocument,
    createFolder,
    saveFolder: async (projectId, folder) =>
      mapOperationResult(await saveFolder(projectId, folder), discard),
    moveEntry: async (projectId, entryId, targetParentFolderId) =>
      mapOperationResult(
        await moveEntry(projectId, entryId, targetParentFolderId),
        discard,
      ),
    deleteFolder: async (projectId, folderId) =>
      mapOperationResult(await deleteFolder(projectId, folderId), discard),
    loadDocument,
    closeDocument: async (projectId, documentId) =>
      mapOperationResult(await closeDocument(projectId, documentId), discard),
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
    selectImageFiles,
    importDroppedImages,
    copyAssetToDocument,
    readBlockContent,
    writeBlockContent: async (projectId, documentId, contentPath, text) =>
      mapOperationResult(
        await writeBlockContent(projectId, documentId, contentPath, text),
        discard,
      ),
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
