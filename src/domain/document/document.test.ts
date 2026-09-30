import { describe, expect, it } from "vitest";
import { parseDisplayName } from "../shared/display-name";
import { parseSheetId } from "../shared/entity-id";
import { unwrap } from "../shared/test-support";
import {
  addSheet,
  moveSheet,
  parseDocument,
  removeSheet,
  renameDocument,
} from "./document";

const DOCUMENT_ID = "01928f3a-6c7d-7e8f-a012-3456789abcde";
const SHEET_ID_PREFIX = "01928f3a-7d8e-7f90-b123-456789abcde";
const sheetId = (suffix: string) =>
  unwrap(parseSheetId(`${SHEET_ID_PREFIX}${suffix}`));

describe("document operations", () => {
  const document = unwrap(
    parseDocument({
      schemaVersion: 1,
      documentId: DOCUMENT_ID,
      name: "Doc",
      sheetOrder: [`${SHEET_ID_PREFIX}0`, `${SHEET_ID_PREFIX}1`],
    }),
  );

  it("renames", () => {
    expect(
      unwrap(renameDocument(document, unwrap(parseDisplayName("New")))).name,
    ).toBe("New");
  });

  it("adds, removes and moves sheets through sheetOrder", () => {
    const added = unwrap(addSheet(document, sheetId("2")));
    expect(added.sheetOrder).toEqual([
      `${SHEET_ID_PREFIX}0`,
      `${SHEET_ID_PREFIX}1`,
      `${SHEET_ID_PREFIX}2`,
    ]);
    const moved = unwrap(moveSheet(added, sheetId("2"), sheetId("0")));
    expect(moved.sheetOrder[0]).toBe(`${SHEET_ID_PREFIX}2`);
    const removed = unwrap(removeSheet(moved, sheetId("0")));
    expect(removed.sheetOrder).toEqual([
      `${SHEET_ID_PREFIX}2`,
      `${SHEET_ID_PREFIX}1`,
    ]);
  });

  it("reports duplicate and missing sheets", () => {
    const duplicate = addSheet(document, sheetId("0"));
    const missing = removeSheet(document, sheetId("9"));
    expect(!duplicate.ok && duplicate.error.kind).toBe("duplicateId");
    expect(!missing.ok && missing.error.kind).toBe("entityNotFound");
  });
});
