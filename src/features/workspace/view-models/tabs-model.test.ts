import { describe, expect, it } from "vitest";
import { createApplicationStore } from "../../../application/state/application-state";
import { settle } from "../../../application/test-support/fakes";
import { TEST_AUTO_SAVE_DELAY_MS } from "../../../application/test-support/session-harness";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  openedDocumentA,
  SHEET_A1,
  SHEET_A2,
} from "../../../application/test-support/workspace-harness";
import { makeDocumentADirty } from "../test-support/actions-harness";
import {
  createInitialUiState,
  setActiveDocument,
  setActiveSheet,
} from "../ui-state/ui-state";
import {
  firstLoadedSheetId,
  saveStatusOf,
  selectDocumentTabs,
  selectSheetTabs,
} from "./tabs-model";

describe("selectDocumentTabs", () => {
  it("lists open documents in the order they were opened", async () => {
    const { store, workspace } = await openedDocumentA();
    await workspace.openDocument(DOCUMENT_B);
    const ui = setActiveDocument(createInitialUiState(), DOCUMENT_B);
    const tabs = selectDocumentTabs(store.getState(), ui);
    expect(tabs.map((tab) => tab.documentId)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(tabs.map((tab) => tab.isActive)).toEqual([false, true]);
    expect(tabs.map((tab) => tab.name)).toEqual(["Document A", "Document B"]);
  });

  it("is empty without open documents", () => {
    expect(
      selectDocumentTabs(
        createApplicationStore().getState(),
        createInitialUiState(),
      ),
    ).toEqual([]);
  });
});

describe("save status", () => {
  it("is saved, unsaved, saving and error, with error winning over saving over unsaved", async () => {
    const harness = await openedDocumentA();
    const { store, gateway, scheduler, workspace } = harness;
    const statusOf = () => {
      const state = store.getState().documents.get(DOCUMENT_A);
      if (state === undefined) throw new Error("document A is open");
      return saveStatusOf(state);
    };
    expect(statusOf()).toBe("saved");

    await makeDocumentADirty(harness);
    expect(statusOf()).toBe("unsaved");

    const release = gateway.hold("saveSheet");
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(statusOf()).toBe("saving");

    gateway.failAlways("saveSheet", "ioError");
    release();
    await settle();
    expect(statusOf()).toBe("error");
    const tab = selectDocumentTabs(store.getState(), createInitialUiState())[0];
    expect(tab?.saveError?.kind).toBe("ioError");

    // Still dirty after the failure, yet error is what is shown.
    gateway.clearFailures();
    const flushed = await workspace.getDocumentSession(DOCUMENT_A)?.flush();
    expect(flushed?.ok).toBe(true);
    expect(statusOf()).toBe("saved");
  });
});

describe("selectSheetTabs", () => {
  it("is null without an active open document", async () => {
    const { store } = await openedDocumentA();
    expect(
      selectSheetTabs(store.getState(), createInitialUiState()),
    ).toBeNull();
  });

  it("lists the loaded sheets of the active document and marks the active one", async () => {
    const { store } = await openedDocumentA();
    const ui = setActiveSheet(
      setActiveDocument(createInitialUiState(), DOCUMENT_A),
      DOCUMENT_A,
      SHEET_A2,
    );
    const model = selectSheetTabs(store.getState(), ui);
    expect(model?.documentName).toBe("Document A");
    // The sheet that failed to load is not a tab.
    expect(model?.tabs.map((tab) => tab.sheetId)).toEqual([SHEET_A1, SHEET_A2]);
    expect(model?.tabs.map((tab) => tab.isActive)).toEqual([false, true]);
    expect(model?.activeSheetId).toBe(SHEET_A2);
  });

  it("has no active sheet when the remembered one is not a loaded sheet", async () => {
    const { store } = await openedDocumentA();
    const model = selectSheetTabs(
      store.getState(),
      setActiveDocument(createInitialUiState(), DOCUMENT_A),
    );
    expect(model?.activeSheetId).toBeNull();
    expect(model?.tabs.every((tab) => !tab.isActive)).toBe(true);
  });
});

describe("firstLoadedSheetId", () => {
  it("is the first loaded sheet in order, or null", async () => {
    const { store } = await openedDocumentA();
    expect(firstLoadedSheetId(store.getState(), DOCUMENT_A)).toBe(SHEET_A1);
    expect(firstLoadedSheetId(store.getState(), DOCUMENT_B)).toBeNull();
  });
});
