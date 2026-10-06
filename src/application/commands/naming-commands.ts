import type { Document } from "../../domain/document/document";
import { moveSheet, renameDocument } from "../../domain/document/document";
import type { DisplayName } from "../../domain/shared/display-name";
import { ok } from "../../domain/shared/domain-result";
import type { SheetId } from "../../domain/shared/entity-id";
import { renameSheet } from "../../domain/sheet/sheet";
import type { MetadataCommand } from "./command";
import { COMMAND_KINDS } from "./command-kind";
import {
  commandNotApplied,
  updateDocument,
  updateSheet,
} from "./document-data";

export function renameSheetCommand(
  sheetId: SheetId,
  name: DisplayName,
): MetadataCommand {
  let previousName: DisplayName | null = null;
  return {
    category: "metadata",
    kind: COMMAND_KINDS.renameSheet,
    apply: (state) =>
      updateSheet(state, sheetId, (sheet) => {
        if (sheet.name === name) return ok(sheet);
        const next = renameSheet(sheet, name);
        if (next.ok && previousName === null) previousName = sheet.name;
        return next;
      }),
    revert: (state) =>
      updateSheet(state, sheetId, (sheet) =>
        previousName === null
          ? commandNotApplied()
          : renameSheet(sheet, previousName),
      ),
  };
}

export function renameDocumentCommand(name: DisplayName): MetadataCommand {
  let previousName: DisplayName | null = null;
  return {
    category: "metadata",
    kind: COMMAND_KINDS.renameDocument,
    apply: (state) =>
      updateDocument(state, (document) => {
        if (document.name === name) return ok(document);
        const next = renameDocument(document, name);
        if (next.ok && previousName === null) previousName = document.name;
        return next;
      }),
    revert: (state) =>
      updateDocument(state, (document) =>
        previousName === null
          ? commandNotApplied()
          : renameDocument(document, previousName),
      ),
  };
}

function sameOrder(first: Document, second: Document): boolean {
  return (
    first.sheetOrder.length === second.sheetOrder.length &&
    first.sheetOrder.every((id, index) => id === second.sheetOrder[index])
  );
}

// Moves the sheet directly before `beforeSheetId` (null = to the end), like the domain
// operation. The sheet that followed it originally is remembered to put it back.
export function moveSheetCommand(
  sheetId: SheetId,
  beforeSheetId: SheetId | null,
): MetadataCommand {
  let restoreBefore: { readonly sheetId: SheetId | null } | null = null;
  return {
    category: "metadata",
    kind: COMMAND_KINDS.moveSheet,
    apply: (state) =>
      updateDocument(state, (document) => {
        const next = moveSheet(document, sheetId, beforeSheetId);
        if (!next.ok) return next;
        if (sameOrder(document, next.value)) return ok(document);
        if (restoreBefore === null) {
          const index = document.sheetOrder.indexOf(sheetId);
          restoreBefore = { sheetId: document.sheetOrder[index + 1] ?? null };
        }
        return next;
      }),
    revert: (state) =>
      updateDocument(state, (document) =>
        restoreBefore === null
          ? commandNotApplied()
          : moveSheet(document, sheetId, restoreBefore.sheetId),
      ),
  };
}
