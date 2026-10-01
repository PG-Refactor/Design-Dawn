import type { BlockType } from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import type { Document } from "../../domain/document/document";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import type { OperationResult } from "./operation-error";

// What the document session needs from persistence. Implemented by the Tauri client
// adapter in infrastructure; faked in tests. Expected failures are results, never throws.
export interface PersistenceGateway {
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
