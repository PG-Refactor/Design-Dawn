// Pure changes to a document's structure (which sheets it has). Used through the
// session's structural-change entry; not commands, because they are not undoable.

import { addSheet, removeSheet } from "../../domain/document/document";
import { type DomainResult, err, ok } from "../../domain/shared/domain-result";
import type { SheetId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import type { DocumentData } from "../commands/document-data";

export function withSheetAdded(
  data: DocumentData,
  sheet: Sheet,
): DomainResult<DocumentData> {
  if (data.sheets.has(sheet.sheetId)) {
    return err("duplicateId", `sheet already present: ${sheet.sheetId}`);
  }
  const document = addSheet(data.document, sheet.sheetId);
  if (!document.ok) return document;
  return ok({
    document: document.value,
    sheets: new Map(data.sheets).set(sheet.sheetId, sheet),
  });
}

// A sheet that failed to load is not in `sheets`, and its id may not even be in the
// order, so removal tolerates both.
export function documentWithoutSheet(
  data: DocumentData,
  sheetId: SheetId,
): DomainResult<DocumentData["document"]> {
  return data.document.sheetOrder.includes(sheetId)
    ? removeSheet(data.document, sheetId)
    : ok(data.document);
}

export function withSheetRemoved(
  data: DocumentData,
  sheetId: SheetId,
): DomainResult<DocumentData> {
  const document = documentWithoutSheet(data, sheetId);
  if (!document.ok) return document;
  const sheets = new Map(data.sheets);
  sheets.delete(sheetId);
  return ok({ document: document.value, sheets });
}
