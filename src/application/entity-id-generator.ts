import { v7 as generateUuidV7 } from "uuid";
import type { DomainResult } from "../domain/shared/domain-result";
import {
  type BlockId,
  type DocumentId,
  type ProjectId,
  parseBlockId,
  parseDocumentId,
  parseProjectId,
  parseSheetId,
  type SheetId,
} from "../domain/shared/entity-id";

// Going through the domain parser guarantees generated IDs satisfy the same rule as
// loaded ones. A failure here means the uuid library broke its contract, so it throws.
function generate<Id extends string>(
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
  return generate(parseProjectId);
}

export function generateDocumentId(): DocumentId {
  return generate(parseDocumentId);
}

export function generateSheetId(): SheetId {
  return generate(parseSheetId);
}

export function generateBlockId(): BlockId {
  return generate(parseBlockId);
}
