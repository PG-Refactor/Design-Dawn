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
import type { CopiedAsset, DropImportResult } from "./asset-types";
import type { OperationResult } from "./operation-error";
import type {
  DocumentSnapshot,
  ExternalChanges,
  FolderSelection,
  FolderSnapshot,
  OpenInNewWindowResult,
  OpenRequestResult,
  ProjectSnapshot,
  SheetSnapshot,
} from "./persistence-types";

// What the document session needs from persistence. Implemented by the Tauri client
// adapter in infrastructure; faked in tests. Expected failures are results, never throws.
export interface PersistenceGateway {
  // The OS folder dialog runs in Rust; cancelling is an ok result. The Frontend never
  // handles a path: `selectionId` is the only handle (docs/architecture.md §6.2.2).
  selectProjectFolder(): Promise<OperationResult<FolderSelection>>;
  openProject(selectionId: string): Promise<OperationResult<ProjectSnapshot>>;
  // Reads the Project this window has open again from disk, as a fresh open of it (Rust
  // drops its session for the old read). Needs no selection: the window's own Project.
  reloadProject(
    projectId: ProjectId,
  ): Promise<OperationResult<ProjectSnapshot>>;
  // Compares the Project's files with what the app last read or wrote and reports what
  // changed behind its back. Read-only; nothing is re-recorded (docs/architecture.md §14.4).
  checkExternalChanges(
    projectId: ProjectId,
  ): Promise<OperationResult<ExternalChanges>>;
  // The user chose to overwrite what is on disk: the Document's files (or, with `null`, the
  // Project-level files) are taken as the new baseline so the next save is allowed
  // (docs/architecture.md §14.6).
  acceptDiskState(
    projectId: ProjectId,
    documentId: DocumentId | null,
  ): Promise<OperationResult<void>>;
  // Opens the selected folder's Project in a new window, or brings forward the window that
  // has it. This window's own Project is not touched.
  openProjectInNewWindow(
    selectionId: string,
  ): Promise<OperationResult<OpenInNewWindowResult>>;
  // The Project / Document a launch argument asked for, already opened in Rust (a Project
  // is open afterwards). Consumed once: null when nothing was requested or it was taken.
  takeOpenRequest(): Promise<OperationResult<OpenRequestResult | null>>;
  // The window no longer has a Project: Rust unbinds it (another window may open it now)
  // and drops its session. Called after the Project's documents were saved and closed.
  closeProject(): Promise<OperationResult<void>>;
  createProject(
    selectionId: string,
    name: DisplayName,
  ): Promise<OperationResult<ProjectSnapshot>>;
  saveProject(
    projectId: ProjectId,
    project: Project,
  ): Promise<OperationResult<void>>;
  // `parentFolderId` null (the default) creates it directly under the Project.
  createDocument(
    projectId: ProjectId,
    documentId: DocumentId,
    name: DisplayName,
    parentFolderId?: FolderId | null,
  ): Promise<OperationResult<DocumentSnapshot>>;
  // Creates the directory and `folder.json` (never overwriting). The caller saves the
  // parent's order afterwards (docs/architecture.md §6.2.4).
  createFolder(
    projectId: ProjectId,
    parentFolderId: FolderId | null,
    folderId: FolderId,
    name: DisplayName,
  ): Promise<OperationResult<FolderSnapshot>>;
  saveFolder(
    projectId: ProjectId,
    folder: Folder,
  ): Promise<OperationResult<void>>;
  // Moves a Folder / Document (open or not) into another Folder (null = Project root). Rejected
  // with `invalidMove` for a Folder moved into itself / a descendant. Neither parent's order is
  // touched: the caller saves the target parent, then the source parent.
  moveEntry(
    projectId: ProjectId,
    entryId: EntryId,
    targetParentFolderId: FolderId | null,
  ): Promise<OperationResult<void>>;
  // Only an empty folder (`folderNotEmpty` otherwise). Destructive: the caller saved the
  // parent's order without it first.
  deleteFolder(
    projectId: ProjectId,
    folderId: FolderId,
  ): Promise<OperationResult<void>>;
  loadDocument(
    projectId: ProjectId,
    documentId: DocumentId,
  ): Promise<OperationResult<DocumentSnapshot>>;
  // Tells Rust the Document is no longer open (its assets stop being served). Touches no
  // file; the caller has saved the Document before.
  closeDocument(
    projectId: ProjectId,
    documentId: DocumentId,
  ): Promise<OperationResult<void>>;
  createSheet(
    projectId: ProjectId,
    documentId: DocumentId,
    sheetId: SheetId,
    name: DisplayName,
  ): Promise<OperationResult<SheetSnapshot>>;
  // Destructive; the caller has to have saved the parent's order without the entity
  // first (docs/file-format.md §9).
  deleteSheet(
    projectId: ProjectId,
    documentId: DocumentId,
    sheetId: SheetId,
  ): Promise<OperationResult<void>>;
  deleteDocument(
    projectId: ProjectId,
    documentId: DocumentId,
  ): Promise<OperationResult<void>>;
  saveSheet(
    projectId: ProjectId,
    documentId: DocumentId,
    sheet: Sheet,
  ): Promise<OperationResult<void>>;
  saveDocument(
    projectId: ProjectId,
    document: Document,
  ): Promise<OperationResult<void>>;
  createBlockContent(
    projectId: ProjectId,
    documentId: DocumentId,
    sheetId: SheetId,
    blockType: BlockType,
    text: string,
  ): Promise<OperationResult<ContentPath>>;
  readBlockContent(
    projectId: ProjectId,
    documentId: DocumentId,
    contentPath: ContentPath,
  ): Promise<OperationResult<string>>;
  // Replaces the text of an EXISTING content file; a missing file is `fileNotFound`
  // (content is never created implicitly).
  writeBlockContent(
    projectId: ProjectId,
    documentId: DocumentId,
    contentPath: ContentPath,
    text: string,
  ): Promise<OperationResult<void>>;
  deleteBlockContent(
    projectId: ProjectId,
    documentId: DocumentId,
    contentPath: ContentPath,
  ): Promise<OperationResult<void>>;
  // Creates the file at exactly `contentPath`; never overwrites (`alreadyExists`).
  restoreBlockContent(
    projectId: ProjectId,
    documentId: DocumentId,
    blockType: BlockType,
    contentPath: ContentPath,
    text: string,
  ): Promise<OperationResult<void>>;
  // Imports the files of the latest drop into the Document's assets. The dropped paths
  // stay in Rust; `dropId` is the only handle. Rejected files are part of the ok result;
  // an unknown or replaced `dropId` is `invalidDropSelection`.
  importDroppedImages(
    dropId: string,
    projectId: ProjectId,
    documentId: DocumentId,
  ): Promise<OperationResult<DropImportResult>>;
  // Validates an image asset and, for another Document, copies it there (the name is kept,
  // `-2` on collision). Into the Document it already lives in nothing is copied: the same
  // contentPath comes back, so this doubles as the validity check of copy / duplicate.
  copyAssetToDocument(
    projectId: ProjectId,
    sourceDocumentId: DocumentId,
    contentPath: ContentPath,
    targetDocumentId: DocumentId,
  ): Promise<OperationResult<CopiedAsset>>;
}
