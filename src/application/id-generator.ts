import type {
  BlockId,
  DocumentId,
  FolderId,
  SheetId,
} from "../domain/shared/entity-id";
import {
  generateBlockId,
  generateDocumentId,
  generateFolderId,
  generateSheetId,
} from "./entity-id-generator";

// Injectable so tests get deterministic ids. Projects get their id from Rust when they
// are created, so there is no `projectId` here.
export interface IdGenerator {
  blockId(): BlockId;
  documentId(): DocumentId;
  folderId(): FolderId;
  sheetId(): SheetId;
}

export function createDefaultIdGenerator(): IdGenerator {
  return {
    blockId: generateBlockId,
    documentId: generateDocumentId,
    folderId: generateFolderId,
    sheetId: generateSheetId,
  };
}
