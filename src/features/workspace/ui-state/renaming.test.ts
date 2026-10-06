import { describe, expect, it } from "vitest";
import { documentIdOf } from "../../../application/test-support/fakes";
import {
  DOCUMENT_ID,
  OTHER_SHEET_ID,
  SHEET_ID,
} from "../../../domain/shared/test-fixtures";
import {
  beginRenaming,
  createInitialUiState,
  endRenaming,
  type RenamingTarget,
  sameRenamingTarget,
} from "./ui-state";
import {
  removeDocumentReferences,
  removeSheetFromUiState,
  resetUiState,
} from "./ui-state-cleanup";

const OTHER_DOCUMENT_ID = documentIdOf(5);
const documentTarget: RenamingTarget = {
  kind: "document",
  documentId: DOCUMENT_ID,
};
const sheetTarget: RenamingTarget = {
  kind: "sheet",
  documentId: DOCUMENT_ID,
  sheetId: SHEET_ID,
};

describe("renaming state", () => {
  it("starts with nothing being renamed", () => {
    expect(createInitialUiState().renaming).toBeNull();
  });

  it("begins and ends; repeating either returns the same state object", () => {
    const initial = createInitialUiState();
    expect(endRenaming(initial)).toBe(initial);
    const renaming = beginRenaming(initial, documentTarget);
    expect(renaming.renaming).toEqual(documentTarget);
    expect(beginRenaming(renaming, { ...documentTarget })).toBe(renaming);
    expect(endRenaming(renaming).renaming).toBeNull();
  });

  it("holds one target at a time: a new rename replaces the open one", () => {
    const state = beginRenaming(
      beginRenaming(createInitialUiState(), documentTarget),
      sheetTarget,
    );
    expect(state.renaming).toEqual(sheetTarget);
  });

  it("compares targets by kind and ids", () => {
    expect(sameRenamingTarget(null, null)).toBe(true);
    expect(sameRenamingTarget(documentTarget, null)).toBe(false);
    expect(sameRenamingTarget(documentTarget, sheetTarget)).toBe(false);
    expect(
      sameRenamingTarget(sheetTarget, {
        ...sheetTarget,
        sheetId: OTHER_SHEET_ID,
      }),
    ).toBe(false);
    expect(sameRenamingTarget(sheetTarget, { ...sheetTarget })).toBe(true);
  });
});

describe("renaming cleanup", () => {
  it("ends a document rename when the document goes away, and only then", () => {
    const state = beginRenaming(createInitialUiState(), documentTarget);
    expect(
      removeDocumentReferences(state, DOCUMENT_ID, []).renaming,
    ).toBeNull();
    expect(removeDocumentReferences(state, OTHER_DOCUMENT_ID, [])).toBe(state);
  });

  it("ends a sheet rename when its document or the sheet goes away", () => {
    const state = beginRenaming(createInitialUiState(), sheetTarget);
    expect(
      removeDocumentReferences(state, DOCUMENT_ID, [SHEET_ID]).renaming,
    ).toBeNull();
    expect(
      removeSheetFromUiState(state, DOCUMENT_ID, SHEET_ID).renaming,
    ).toBeNull();
  });

  it("keeps a rename when another sheet is removed", () => {
    const state = beginRenaming(createInitialUiState(), sheetTarget);
    expect(removeSheetFromUiState(state, DOCUMENT_ID, OTHER_SHEET_ID)).toBe(
      state,
    );
    expect(removeSheetFromUiState(state, OTHER_DOCUMENT_ID, SHEET_ID)).toBe(
      state,
    );
  });

  it("does not end a document rename when one of its sheets is removed", () => {
    const state = beginRenaming(createInitialUiState(), documentTarget);
    expect(removeSheetFromUiState(state, DOCUMENT_ID, SHEET_ID)).toBe(state);
  });

  it("is cleared when the project closes", () => {
    expect(resetUiState().renaming).toBeNull();
  });
});
