import type { Document } from "../../domain/document/document";
import { type DomainResult, err, ok } from "../../domain/shared/domain-result";
import type { SheetId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";

// The Domain values of one open Document. Immutable: a command returns a new value and
// the session swaps it in. Unchanged parts keep their reference, which is how the session
// detects no-ops and which sheets became dirty.
export interface DocumentData {
  readonly document: Document;
  readonly sheets: ReadonlyMap<SheetId, Sheet>;
}

export function findSheet(
  data: DocumentData,
  sheetId: SheetId,
): DomainResult<Sheet> {
  const sheet = data.sheets.get(sheetId);
  if (sheet === undefined) {
    return err("entityNotFound", `sheet not found: ${sheetId}`);
  }
  return ok(sheet);
}

// Returns `data` itself when `update` returns the same sheet.
export function updateSheet(
  data: DocumentData,
  sheetId: SheetId,
  update: (sheet: Sheet) => DomainResult<Sheet>,
): DomainResult<DocumentData> {
  const sheet = findSheet(data, sheetId);
  if (!sheet.ok) return sheet;
  const updated = update(sheet.value);
  if (!updated.ok) return updated;
  if (updated.value === sheet.value) return ok(data);
  return ok(replaceSheet(data, updated.value));
}

export function replaceSheet(data: DocumentData, sheet: Sheet): DocumentData {
  return { ...data, sheets: new Map(data.sheets).set(sheet.sheetId, sheet) };
}

// Returns `data` itself when `update` returns the same document.
export function updateDocument(
  data: DocumentData,
  update: (document: Document) => DomainResult<Document>,
): DomainResult<DocumentData> {
  const updated = update(data.document);
  if (!updated.ok) return updated;
  if (updated.value === data.document) return ok(data);
  return ok({ ...data, document: updated.value });
}

export interface DocumentDataChange {
  readonly documentChanged: boolean;
  readonly changedSheetIds: readonly SheetId[];
}

export function diffDocumentData(
  before: DocumentData,
  after: DocumentData,
): DocumentDataChange {
  const sheetIds = new Set([...before.sheets.keys(), ...after.sheets.keys()]);
  return {
    documentChanged: before.document !== after.document,
    changedSheetIds: [...sheetIds].filter(
      (sheetId) => before.sheets.get(sheetId) !== after.sheets.get(sheetId),
    ),
  };
}

export function hasChanges(change: DocumentDataChange): boolean {
  return change.documentChanged || change.changedSheetIds.length > 0;
}

// A command's `revert` ran although its `apply` never succeeded: nothing was captured.
export function commandNotApplied<T>(): DomainResult<T> {
  return err("entityNotFound", "command was reverted before it was applied");
}
