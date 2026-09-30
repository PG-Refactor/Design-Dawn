import { ENTITY_ID_PATTERN } from "../domain-constants";
import type { Brand } from "./brand";
import { type DomainResult, err, ok } from "./domain-result";

export type ProjectId = Brand<string, "ProjectId">;
export type DocumentId = Brand<string, "DocumentId">;
export type SheetId = Brand<string, "SheetId">;
export type BlockId = Brand<string, "BlockId">;

// Rejects rather than normalizes: a non-canonical ID in a file is a corrupt file,
// and silently rewriting it would change identity across Git history.
function parseEntityIdText<Id extends string>(value: string): DomainResult<Id> {
  if (!ENTITY_ID_PATTERN.test(value)) {
    return err(
      "invalidEntityId",
      `not a canonical UUIDv7: ${JSON.stringify(value)}`,
    );
  }
  // The pattern check above is what makes this brand sound.
  return ok(value as Id);
}

export function parseProjectId(value: string): DomainResult<ProjectId> {
  return parseEntityIdText<ProjectId>(value);
}

export function parseDocumentId(value: string): DomainResult<DocumentId> {
  return parseEntityIdText<DocumentId>(value);
}

export function parseSheetId(value: string): DomainResult<SheetId> {
  return parseEntityIdText<SheetId>(value);
}

export function parseBlockId(value: string): DomainResult<BlockId> {
  return parseEntityIdText<BlockId>(value);
}
