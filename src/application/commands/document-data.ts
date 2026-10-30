import type { Document } from "../../domain/document/document";
import { type DomainResult, err, ok } from "../../domain/shared/domain-result";
import type { BlockId, SheetId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";

// The Domain values of one open Document. Immutable: a command returns a new value and
// the session swaps it in. Unchanged parts keep their reference, which is how the session
// detects no-ops and which sheets / contents became dirty.
export interface DocumentData {
  readonly document: Document;
  readonly sheets: ReadonlyMap<SheetId, Sheet>;
  // The text of the blocks whose content is LOADED. A block
  // without an entry has not been read (or failed to): that is different from "", which
  // is a valid, empty text. Blocks never get a made-up text.
  readonly contents: ReadonlyMap<BlockId, string>;
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

// Returns `data` itself when the entries are all already present with the same text.
export function withContents(
  data: DocumentData,
  entries: Iterable<readonly [BlockId, string]>,
): DocumentData {
  let contents: Map<BlockId, string> | null = null;
  for (const [blockId, text] of entries) {
    if (data.contents.get(blockId) === text) continue;
    contents ??= new Map(data.contents);
    contents.set(blockId, text);
  }
  return contents === null ? data : { ...data, contents };
}

export function liveBlockIds(data: DocumentData): ReadonlySet<BlockId> {
  const ids = new Set<BlockId>();
  for (const sheet of data.sheets.values()) {
    for (const block of sheet.blocks) ids.add(block.blockId);
  }
  return ids;
}

// Drops the texts of blocks that no sheet contains any more (deleted blocks, deleted
// sheets). Returns `data` itself when nothing has to be dropped.
export function pruneContents(data: DocumentData): DocumentData {
  if (data.contents.size === 0) return data;
  const live = liveBlockIds(data);
  const kept = [...data.contents].filter(([blockId]) => live.has(blockId));
  return kept.length === data.contents.size
    ? data
    : { ...data, contents: new Map(kept) };
}

export interface DocumentDataChange {
  readonly documentChanged: boolean;
  readonly changedSheetIds: readonly SheetId[];
  // Blocks whose loaded text differs. Blocks that only appear or disappear are not
  // listed: their files are created / deleted by the file-backed sequences.
  readonly changedContentBlockIds: readonly BlockId[];
}

export function diffDocumentData(
  before: DocumentData,
  after: DocumentData,
): DocumentDataChange {
  const sheetIds = new Set([...before.sheets.keys(), ...after.sheets.keys()]);
  const changedContentBlockIds = [...after.contents].flatMap(
    ([blockId, text]) => {
      const previous = before.contents.get(blockId);
      return previous !== undefined && previous !== text ? [blockId] : [];
    },
  );
  return {
    changedContentBlockIds,
    documentChanged: before.document !== after.document,
    changedSheetIds: [...sheetIds].filter(
      (sheetId) => before.sheets.get(sheetId) !== after.sheets.get(sheetId),
    ),
  };
}

export function hasChanges(change: DocumentDataChange): boolean {
  return (
    change.documentChanged ||
    change.changedSheetIds.length > 0 ||
    change.changedContentBlockIds.length > 0
  );
}

// A command's `revert` ran although its `apply` never succeeded: nothing was captured.
export function commandNotApplied<T>(): DomainResult<T> {
  return err("entityNotFound", "command was reverted before it was applied");
}
