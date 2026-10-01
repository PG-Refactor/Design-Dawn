// Typed wrappers for the persistence Tauri commands (docs/architecture.md §6.2). This is the
// only place that calls `invoke`. Expected failures come back as `{ ok: false, error }`;
// nothing here throws for them.

import { invoke } from "@tauri-apps/api/core";
import type { BlockType } from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import type { Document } from "../../domain/document/document";
import type { Project } from "../../domain/project/project";
import type { DisplayName } from "../../domain/shared/display-name";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import { COMMANDS, type CommandName } from "./command-constants";
import {
  type CommandResult,
  commandErr,
  toCommandError,
} from "./command-error";
import {
  toContentPathResult,
  toDocumentSnapshotResult,
  toFolderSelectionResult,
  toProjectSnapshotResult,
  toSaveResult,
  toSheetSnapshotResult,
  toTextResult,
  toVoidResult,
} from "./persistence-payloads";
import type {
  DocumentSnapshot,
  FolderSelection,
  ProjectSnapshot,
  SaveResult,
  SheetSnapshot,
} from "./persistence-types";

type CommandArguments = Readonly<Record<string, unknown>>;

async function call<T>(
  command: CommandName,
  args: CommandArguments,
  convert: (payload: unknown) => CommandResult<T>,
): Promise<CommandResult<T>> {
  let payload: unknown;
  try {
    payload = await invoke<unknown>(command, { ...args });
  } catch (rejection) {
    const error = toCommandError(rejection);
    return commandErr(error.kind, error.detail);
  }
  return convert(payload);
}

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

export function saveProject(
  projectId: ProjectId,
  project: Project,
): Promise<CommandResult<SaveResult>> {
  return call(COMMANDS.saveProject, { projectId, project }, toSaveResult);
}

export function createDocument(
  projectId: ProjectId,
  documentId: DocumentId,
  name: DisplayName,
): Promise<CommandResult<DocumentSnapshot>> {
  return call(
    COMMANDS.createDocument,
    { projectId, documentId, name },
    toDocumentSnapshotResult,
  );
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
