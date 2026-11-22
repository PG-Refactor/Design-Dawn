import { v7 as generateUuidV7 } from "uuid";
import type { DomainResult } from "../domain/shared/domain-result";
import {
  type BlockId,
  type DocumentId,
  type FolderId,
  type ProjectId,
  parseBlockId,
  parseDocumentId,
  parseFolderId,
  parseProjectId,
  parseSheetId,
  type SheetId,
} from "../domain/shared/entity-id";

// Going through the domain parser guarantees generated IDs satisfy the same rule as
// loaded ones. A failure here means the uuid library broke its contract, so it throws.
export function generateEntityId<Id extends string>(
  parse: (value: string) => DomainResult<Id>,
): Id {
  const result = parse(generateUuidV7());
  if (!result.ok) {
    throw new Error(
      `uuid v7 generator produced an invalid entity id: ${result.error.detail}`,
    );
  }
  return result.value;
}

export function generateProjectId(): ProjectId {
  return generateEntityId(parseProjectId);
}

export function generateDocumentId(): DocumentId {
  return generateEntityId(parseDocumentId);
}

export function generateFolderId(): FolderId {
  return generateEntityId(parseFolderId);
}

export function generateSheetId(): SheetId {
  return generateEntityId(parseSheetId);
}

export function generateBlockId(): BlockId {
  return generateEntityId(parseBlockId);
}
