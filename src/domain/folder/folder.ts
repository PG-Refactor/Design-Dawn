import { type DisplayName, parseDisplayName } from "../shared/display-name";
import { type DomainResult, ok } from "../shared/domain-result";
import {
  type EntryId,
  type FolderId,
  parseFolderId,
} from "../shared/entity-id";
import { parseChildOrder } from "../shared/ordered-ids";
import {
  parseSchemaVersion,
  type SchemaVersion,
} from "../shared/schema-version";

// A directory under `documents/` that groups Folders and Documents (data-model.md §2.1).
export interface Folder {
  readonly schemaVersion: SchemaVersion;
  readonly folderId: FolderId;
  readonly name: DisplayName;
  readonly childOrder: readonly EntryId[];
}

export interface RawFolder {
  readonly schemaVersion: number;
  readonly folderId: string;
  readonly name: string;
  readonly childOrder: readonly string[];
}

export function parseFolder(raw: RawFolder): DomainResult<Folder> {
  const schemaVersion = parseSchemaVersion("folder", raw.schemaVersion);
  if (!schemaVersion.ok) return schemaVersion;
  const folderId = parseFolderId(raw.folderId);
  if (!folderId.ok) return folderId;
  const name = parseDisplayName(raw.name);
  if (!name.ok) return name;
  const childOrder = parseChildOrder(raw.childOrder, "childOrder");
  if (!childOrder.ok) return childOrder;
  return ok({
    schemaVersion: schemaVersion.value,
    folderId: folderId.value,
    name: name.value,
    childOrder: childOrder.value,
  });
}
