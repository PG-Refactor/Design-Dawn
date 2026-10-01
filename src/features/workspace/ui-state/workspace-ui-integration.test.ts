import { describe, expect, it } from "vitest";
import {
  CONFIRMED,
  DOCUMENT_A,
  openedDocumentA,
  SHEET_A1,
  SHEET_A2,
} from "../../../application/test-support/workspace-harness";
import { blockIdOf } from "../../../domain/shared/test-fixtures";
import {
  createUiStateStore,
  selectBlocks,
  setActiveDocument,
  setActiveSheet,
} from "./ui-state";
import { connectWorkspaceToUiState } from "./workspace-ui-connector";

describe("workspace + UI state", () => {
  it("prunes UI state when the active sheet is deleted and when its document closes", async () => {
    const { workspace } = await openedDocumentA();
    const uiStore = createUiStateStore();
    connectWorkspaceToUiState(workspace, uiStore);
    uiStore.setState((state) =>
      selectBlocks(
        setActiveSheet(
          setActiveDocument(state, DOCUMENT_A),
          DOCUMENT_A,
          SHEET_A1,
        ),
        SHEET_A2,
        [blockIdOf(1)],
      ),
    );

    await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED);
    expect(uiStore.getState().activeSheetIdByDocument.has(DOCUMENT_A)).toBe(
      false,
    );
    expect(uiStore.getState().selectionBySheet.has(SHEET_A2)).toBe(true);

    await workspace.closeDocument(DOCUMENT_A);
    expect(uiStore.getState().activeDocumentId).toBeNull();
    expect(uiStore.getState().selectionBySheet.size).toBe(0);
  });

  it("prunes UI state when an open document is deleted", async () => {
    const { workspace } = await openedDocumentA();
    const uiStore = createUiStateStore();
    connectWorkspaceToUiState(workspace, uiStore);
    uiStore.setState((state) => setActiveDocument(state, DOCUMENT_A));
    await workspace.deleteDocument(DOCUMENT_A, CONFIRMED);
    expect(uiStore.getState().activeDocumentId).toBeNull();
  });
});
