// Typed wrappers for the persistence Tauri commands (docs/architecture.md §6.2). This is the
// only place that calls `invoke`. Expected failures come back as `{ ok: false, error }`;
// nothing here throws for them.

import type { BlockType } from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import type { Document } from "../../domain/document/document";
import type { Folder } from "../../domain/folder/folder";
import type { Project } from "../../domain/project/project";
import type { DisplayName } from "../../domain/shared/display-name";
import type {
  DocumentId,
  EntryId,
  FolderId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
import { call } from "./invoke-command";
import {
  toContentPathResult,
  toDocumentSnapshotResult,
  toFolderSelectionResult,
  toFolderSnapshotResult,
  toOpenRequestResult,
  toProjectSnapshotResult,
  toSaveResult,
  toSheetSnapshotResult,
  toTextResult,
  toVoidResult,
} from "./persistence-payloads";
import type {
  DocumentSnapshot,
  FolderSelection,
  FolderSnapshot,
  OpenRequestResult,
  ProjectSnapshot,
  SaveResult,
  SheetSnapshot,
} from "./persistence-types";

// Opens the OS folder dialog in Rust. Cancelling is an ok result with status "cancelled".
export function selectProjectFolder(): Promise<CommandResult<FolderSelection>> {
  return call(COMMANDS.selectProjectFolder, {}, toFolderSelectionResult);
}

// `selectionId` comes from `selectProjectFolder`; the Frontend never passes a path.
export function createProject(
  selectionId: string,
  name: DisplayName,
): Promise<CommandResult<ProjectSnapshot>> {
  return call(
    COMMANDS.createProject,
    { selectionId, name },
    toProjectSnapshotResult,
  );
}

export function openProject(
  selectionId: string,
): Promise<CommandResult<ProjectSnapshot>> {
  return call(COMMANDS.openProject, { selectionId }, toProjectSnapshotResult);
}

// The request a launch argument left for this window (consumed once; null when none). It
// takes no argument: Rust knows the window, and the path never reaches the Frontend.
export function takeOpenRequest(): Promise<
  CommandResult<OpenRequestResult | null>
> {
  return call(COMMANDS.takeOpenRequest, {}, toOpenRequestResult);
}

// The window closed its Project; Rust unbinds it and drops its session. Harmless when the
// window has no Project.
export function closeProject(): Promise<CommandResult<null>> {
  return call(COMMANDS.closeProject, {}, toVoidResult);
}

export function saveProject(
  projectId: ProjectId,
  project: Project,
): Promise<CommandResult<SaveResult>> {
  return call(COMMANDS.saveProject, { projectId, project }, toSaveResult);
}

// `parentFolderId` null = directly under the Project.
export function createDocument(
  projectId: ProjectId,
  documentId: DocumentId,
  name: DisplayName,
  parentFolderId: FolderId | null = null,
): Promise<CommandResult<DocumentSnapshot>> {
  return call(
    COMMANDS.createDocument,
    { projectId, documentId, name, parentFolderId },
    toDocumentSnapshotResult,
  );
}

// Creates the directory and `folder.json`; the caller saves the parent's order afterwards.
export function createFolder(
  projectId: ProjectId,
  parentFolderId: FolderId | null,
  folderId: FolderId,
  name: DisplayName,
): Promise<CommandResult<FolderSnapshot>> {
  return call(
    COMMANDS.createFolder,
    { projectId, parentFolderId, folderId, name },
    toFolderSnapshotResult,
  );
}

export function saveFolder(
  projectId: ProjectId,
  folder: Folder,
): Promise<CommandResult<SaveResult>> {
  return call(COMMANDS.saveFolder, { projectId, folder }, toSaveResult);
}

// Only a closed entry moves; the caller saves both parents' order afterwards.
export function moveEntry(
  projectId: ProjectId,
  entryId: EntryId,
  targetParentFolderId: FolderId | null,
): Promise<CommandResult<null>> {
  return call(
    COMMANDS.moveEntry,
    { projectId, entryId, targetParentFolderId },
    toVoidResult,
  );
}

// Only an empty folder; anything else is `folderNotEmpty`.
export function deleteFolder(
  projectId: ProjectId,
  folderId: FolderId,
): Promise<CommandResult<null>> {
  return call(COMMANDS.deleteFolder, { projectId, folderId }, toVoidResult);
}

export function loadDocument(
  projectId: ProjectId,
  documentId: DocumentId,
): Promise<CommandResult<DocumentSnapshot>> {
  return call(
    COMMANDS.loadDocument,
    { projectId, documentId },
    toDocumentSnapshotResult,
  );
}

export function closeDocument(
  projectId: ProjectId,
  documentId: DocumentId,
): Promise<CommandResult<null>> {
  return call(COMMANDS.closeDocument, { projectId, documentId }, toVoidResult);
}

export function saveDocument(
  projectId: ProjectId,
  document: Document,
): Promise<CommandResult<SaveResult>> {
  return call(COMMANDS.saveDocument, { projectId, document }, toSaveResult);
}

export function createSheet(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId: SheetId,
  name: DisplayName,
): Promise<CommandResult<SheetSnapshot>> {
  return call(
    COMMANDS.createSheet,
    { projectId, documentId, sheetId, name },
    toSheetSnapshotResult,
  );
}

export function saveSheet(
  projectId: ProjectId,
  documentId: DocumentId,
  sheet: Sheet,
): Promise<CommandResult<SaveResult>> {
  return call(
    COMMANDS.saveSheet,
    { projectId, documentId, sheet },
    toSaveResult,
  );
}

export function createBlockContent(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId: SheetId,
  blockType: BlockType,
  text: string,
): Promise<CommandResult<ContentPath>> {
  return call(
    COMMANDS.createBlockContent,
    { projectId, documentId, sheetId, blockType, text },
    toContentPathResult,
  );
}

export function readBlockContent(
  projectId: ProjectId,
  documentId: DocumentId,
  contentPath: ContentPath,
): Promise<CommandResult<string>> {
  return call(
    COMMANDS.readBlockContent,
    { projectId, documentId, contentPath },
    toTextResult,
  );
}

export function writeBlockContent(
  projectId: ProjectId,
  documentId: DocumentId,
  contentPath: ContentPath,
  text: string,
): Promise<CommandResult<SaveResult>> {
  return call(
    COMMANDS.writeBlockContent,
    { projectId, documentId, contentPath, text },
    toSaveResult,
  );
}

export function deleteBlockContent(
  projectId: ProjectId,
  documentId: DocumentId,
  contentPath: ContentPath,
): Promise<CommandResult<null>> {
  return call(
    COMMANDS.deleteBlockContent,
    { projectId, documentId, contentPath },
    toVoidResult,
  );
}

export function restoreBlockContent(
  projectId: ProjectId,
  documentId: DocumentId,
  blockType: BlockType,
  contentPath: ContentPath,
  text: string,
): Promise<CommandResult<null>> {
  return call(
    COMMANDS.restoreBlockContent,
    { projectId, documentId, blockType, contentPath, text },
    toVoidResult,
  );
}

export function deleteSheet(
  projectId: ProjectId,
  documentId: DocumentId,
  sheetId: SheetId,
): Promise<CommandResult<null>> {
  return call(
    COMMANDS.deleteSheet,
    { projectId, documentId, sheetId },
    toVoidResult,
  );
}

export function deleteDocument(
  projectId: ProjectId,
  documentId: DocumentId,
): Promise<CommandResult<null>> {
  return call(COMMANDS.deleteDocument, { projectId, documentId }, toVoidResult);
}
