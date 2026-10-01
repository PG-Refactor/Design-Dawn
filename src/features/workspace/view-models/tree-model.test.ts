import { describe, expect, it } from "vitest";
import { createApplicationStore } from "../../../application/state/application-state";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  FAILED_SHEET_ID,
  openedWorkspace,
  SHEET_A1,
  SHEET_A2,
} from "../../../application/test-support/workspace-harness";
import {
  createInitialUiState,
  setActiveDocument,
  setActiveSheet,
} from "../ui-state/ui-state";
import { MESSAGES } from "../workspace-messages";
import { flattenProjectTree } from "./tree-items";
import { selectProjectTree } from "./tree-model";

describe("selectProjectTree", () => {
  it("is null without a project", () => {
    expect(
      selectProjectTree(
        createApplicationStore().getState(),
        createInitialUiState(),
      ),
    ).toBeNull();
  });

  it("lists documents in order; unopened ones have no sheets", async () => {
    const { store } = await openedWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    expect(model?.projectName).toBe("Project");
    expect(model?.documents.map((node) => node.documentId)).toEqual([
      DOCUMENT_A,
      DOCUMENT_B,
      FAILED_DOCUMENT_ID,
    ]);
    expect(model?.documents.every((node) => !node.isOpen)).toBe(true);
    expect(model?.documents.every((node) => node.sheets.length === 0)).toBe(
      true,
    );
    const failed = model?.documents[2];
    expect(failed?.state).toBe("loadFailed");
    expect(failed?.name).toBe(MESSAGES.tree.unnamedEntity);
  });

  it("follows the project's documentOrder", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    const model = selectProjectTree(store.getState(), createInitialUiState());
    expect(model?.documents.map((node) => node.documentId)).toEqual([
      DOCUMENT_B,
      DOCUMENT_A,
      FAILED_DOCUMENT_ID,
    ]);
  });

  it("shows sheets of open documents in sheet order, including failed ones", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    const ui = setActiveSheet(
      setActiveDocument(createInitialUiState(), DOCUMENT_A),
      DOCUMENT_A,
      SHEET_A2,
    );
    const model = selectProjectTree(store.getState(), ui);
    const [documentA, documentB] = model?.documents ?? [];
    expect(documentA?.isOpen).toBe(true);
    expect(documentA?.isActive).toBe(true);
    expect(documentB?.isOpen).toBe(false);
    expect(documentA?.sheets.map((sheet) => sheet.sheetId)).toEqual([
      SHEET_A1,
      SHEET_A2,
      FAILED_SHEET_ID,
    ]);
    expect(documentA?.sheets.map((sheet) => sheet.isActive)).toEqual([
      false,
      true,
      false,
    ]);
    expect(documentA?.sheets[2]?.state).toBe("loadFailed");
  });

  it("marks a sheet active only while its document is the active one", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    await workspace.openDocument(DOCUMENT_B);
    const ui = setActiveSheet(
      setActiveDocument(createInitialUiState(), DOCUMENT_B),
      DOCUMENT_A,
      SHEET_A1,
    );
    const model = selectProjectTree(store.getState(), ui);
    expect(model?.documents[0]?.isActive).toBe(false);
    expect(model?.documents[0]?.sheets.some((sheet) => sheet.isActive)).toBe(
      false,
    );
  });
});

describe("flattenProjectTree", () => {
  it("lists visible items with parents, first children and openable documents", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    const model = selectProjectTree(store.getState(), createInitialUiState());
    if (model === null) throw new Error("project is open");
    const items = flattenProjectTree(model);
    expect(items.map((item) => item.key.split(":")[0])).toEqual([
      "project",
      "document",
      "sheet",
      "sheet",
      "sheet",
      "document",
      "document",
    ]);
    expect(items[0]).toMatchObject({ parentIndex: null, firstChildIndex: 1 });
    expect(items[1]).toMatchObject({
      parentIndex: 0,
      firstChildIndex: 2,
      opensOnExpand: false,
    });
    expect(items[2]).toMatchObject({ parentIndex: 1, firstChildIndex: null });
    // Unopened and loadable: ArrowRight opens it. Failed to load: it does not.
    expect(items[5]?.opensOnExpand).toBe(true);
    expect(items[6]?.opensOnExpand).toBe(false);
  });
});

describe("selectProjectTree move availability", () => {
  it("disables up for the first and down for the last, counting entries that failed to load", async () => {
    const { store } = await openedWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    const moves = model?.documents.map((node) => [
      node.canMoveUp,
      node.canMoveDown,
    ]);
    // A, B, failed: the failed one is the last position but cannot move itself, while B
    // can still move down past it.
    expect(moves).toEqual([
      [false, true],
      [true, true],
      [false, false],
    ]);
  });

  it("does the same for the sheets of an open document", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    const model = selectProjectTree(store.getState(), createInitialUiState());
    const sheets = model?.documents[0]?.sheets;
    expect(
      sheets?.map((sheet) => [
        sheet.sheetId,
        sheet.canMoveUp,
        sheet.canMoveDown,
      ]),
    ).toEqual([
      [SHEET_A1, false, true],
      [SHEET_A2, true, true],
      [FAILED_SHEET_ID, false, false],
    ]);
  });
});
