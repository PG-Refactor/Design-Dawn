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
import type { OperationResult } from "./operation-error";
import type {
  DocumentSnapshot,
  FolderSelection,
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
  createProject(
    selectionId: string,
    name: DisplayName,
  ): Promise<OperationResult<ProjectSnapshot>>;
  saveProject(
    projectId: ProjectId,
    project: Project,
  ): Promise<OperationResult<void>>;
  createDocument(
    projectId: ProjectId,
    documentId: DocumentId,
    name: DisplayName,
  ): Promise<OperationResult<DocumentSnapshot>>;
  loadDocument(
    projectId: ProjectId,
    documentId: DocumentId,
  ): Promise<OperationResult<DocumentSnapshot>>;
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
}
