import { type DisplayName, parseDisplayName } from "../shared/display-name";
import { type DomainResult, err, ok } from "../shared/domain-result";
import {
  type DocumentId,
  parseDocumentId,
  parseSheetId,
  type SheetId,
} from "../shared/entity-id";
import {
  addToOrder,
  findDuplicate,
  moveInOrder,
  removeFromOrder,
} from "../shared/ordered-ids";
import {
  parseSchemaVersion,
  type SchemaVersion,
} from "../shared/schema-version";

export interface Document {
  readonly schemaVersion: SchemaVersion;
  readonly documentId: DocumentId;
  readonly name: DisplayName;
  readonly sheetOrder: readonly SheetId[];
}

export interface RawDocument {
  readonly schemaVersion: number;
  readonly documentId: string;
  readonly name: string;
  readonly sheetOrder: readonly string[];
}

function parseSheetOrder(
  rawIds: readonly string[],
): DomainResult<readonly SheetId[]> {
  const ids: SheetId[] = [];
  for (const rawId of rawIds) {
    const id = parseSheetId(rawId);
    if (!id.ok) return id;
    ids.push(id.value);
  }
  const duplicate = findDuplicate(ids);
  if (duplicate !== null) {
    return err("duplicateId", `duplicate sheetId in sheetOrder: ${duplicate}`);
  }
  return ok(ids);
}

export function parseDocument(raw: RawDocument): DomainResult<Document> {
  const schemaVersion = parseSchemaVersion("document", raw.schemaVersion);
  if (!schemaVersion.ok) return schemaVersion;
  const documentId = parseDocumentId(raw.documentId);
  if (!documentId.ok) return documentId;
  const name = parseDisplayName(raw.name);
  if (!name.ok) return name;
  const sheetOrder = parseSheetOrder(raw.sheetOrder);
  if (!sheetOrder.ok) return sheetOrder;
  return ok({
    schemaVersion: schemaVersion.value,
    documentId: documentId.value,
    name: name.value,
    sheetOrder: sheetOrder.value,
  });
}

export function renameDocument(
  document: Document,
  name: DisplayName,
): DomainResult<Document> {
  return ok({ ...document, name });
}

function withSheetOrder(
  document: Document,
  order: DomainResult<readonly SheetId[]>,
): DomainResult<Document> {
  if (!order.ok) return order;
  return ok({ ...document, sheetOrder: order.value });
}

export function addSheet(
  document: Document,
  sheetId: SheetId,
): DomainResult<Document> {
  return withSheetOrder(document, addToOrder(document.sheetOrder, sheetId));
}

export function removeSheet(
  document: Document,
  sheetId: SheetId,
): DomainResult<Document> {
  return withSheetOrder(
    document,
    removeFromOrder(document.sheetOrder, sheetId),
  );
}

export function moveSheet(
  document: Document,
  sheetId: SheetId,
  beforeSheetId: SheetId | null,
): DomainResult<Document> {
  return withSheetOrder(
    document,
    moveInOrder(document.sheetOrder, sheetId, beforeSheetId),
  );
}
