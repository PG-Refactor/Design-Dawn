import type { Document } from "../../domain/document/document";
import { moveSheet, renameDocument } from "../../domain/document/document";
import type { DisplayName } from "../../domain/shared/display-name";
import { ok } from "../../domain/shared/domain-result";
import type { SheetId } from "../../domain/shared/entity-id";
import { renameSheet } from "../../domain/sheet/sheet";
import type { MetadataCommand } from "./command";
import { COMMAND_KINDS } from "./command-kind";
import type { MoveSheetRestore } from "./command-snapshot";
import {
  commandNotApplied,
  updateDocument,
  updateSheet,
} from "./document-data";

// `restored` (in each factory): what an earlier run captured, for a command rebuilt from
// its snapshot.
export function renameSheetCommand(
  sheetId: SheetId,
  name: DisplayName,
  restored: DisplayName | null = null,
): MetadataCommand {
  let previousName: DisplayName | null = restored;
  return {
    category: "metadata",
    kind: COMMAND_KINDS.renameSheet,
    snapshot: () => ({
      kind: COMMAND_KINDS.renameSheet,
      sheetId,
      name,
      previousName,
    }),
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

export function renameDocumentCommand(
  name: DisplayName,
  restored: DisplayName | null = null,
): MetadataCommand {
  let previousName: DisplayName | null = restored;
  return {
    category: "metadata",
    kind: COMMAND_KINDS.renameDocument,
    snapshot: () => ({
      kind: COMMAND_KINDS.renameDocument,
      name,
      previousName,
    }),
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
  restored: MoveSheetRestore | null = null,
): MetadataCommand {
  let restoreBefore: MoveSheetRestore | null = restored;
  return {
    category: "metadata",
    kind: COMMAND_KINDS.moveSheet,
    snapshot: () => ({
      kind: COMMAND_KINDS.moveSheet,
      sheetId,
      beforeSheetId,
      restoreBefore,
    }),
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
