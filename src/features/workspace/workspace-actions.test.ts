import { describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  FAILED_SHEET_ID,
  SHEET_A1,
  SHEET_A2,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import {
  createActionsHarness,
  makeDocumentADirty,
  openedActionsHarness,
} from "./test-support/actions-harness";

function ui(harness: Awaited<ReturnType<typeof openedActionsHarness>>) {
  return harness.uiStateStore.getState();
}

describe("opening and creating a project", () => {
  it("opens a project through the folder dialog", async () => {
    const harness = createActionsHarness();
    const result = await harness.actions.openProjectViaDialog();
    expect(result.ok).toBe(true);
    expect(harness.store.getState().project?.project.name).toBe("Project");
    expect(ui(harness).operationErrors).toEqual([]);
    expect(ui(harness).busy).toBe(false);
  });

  it("changes nothing and reports nothing when the folder dialog is cancelled", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    harness.gateway.clearCalls();
    harness.gateway.selectNext({ status: "cancelled" });
    const before = harness.store.getState();
    const result = await harness.actions.openProjectViaDialog();
    expect(result.ok).toBe(true);
    expect(harness.store.getState()).toBe(before);
    expect(ui(harness).operationErrors).toEqual([]);
    expect(harness.gateway.methods()).toEqual(["selectProjectFolder"]);
  });

  it("records a dialog failure and keeps the open project and documents", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    harness.gateway.failOn("selectProjectFolder", "dialogFailed");
    const result = await harness.actions.openProjectViaDialog();
    expect(result.ok).toBe(false);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_A);
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "selectFolder", error: { kind: "dialogFailed" } },
    ]);
  });

  it("records an open failure and leaves no project open", async () => {
    const harness = createActionsHarness();
    harness.gateway.failOn("openProject", "ioError");
    const result = await harness.actions.openProjectViaDialog();
    expect(result.ok).toBe(false);
    expect(harness.store.getState().project).toBeNull();
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "openProject", error: { kind: "ioError" } },
    ]);
    expect(ui(harness).notificationsOpen).toBe(true);
    expect(ui(harness).busy).toBe(false);
  });

  it("creates a project from the name dialog and closes the dialog", async () => {
    const harness = createActionsHarness();
    harness.actions.requestCreateProject();
    expect(ui(harness).dialog).toEqual({ kind: "createProject" });
    const result = await harness.actions.createProjectViaDialog("My Project");
    expect(result.ok).toBe(true);
    expect(harness.store.getState().project?.project.name).toBe("My Project");
    expect(ui(harness).dialog).toEqual({ kind: "none" });
  });

  it("keeps the name dialog open when the folder dialog is cancelled", async () => {
    const harness = createActionsHarness();
    harness.actions.requestCreateProject();
    harness.gateway.selectNext({ status: "cancelled" });
    await harness.actions.createProjectViaDialog("Name");
    expect(ui(harness).dialog).toEqual({ kind: "createProject" });
    expect(harness.store.getState().project).toBeNull();
    expect(ui(harness).operationErrors).toEqual([]);
  });

  it("closes the project", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.closeProject();
    expect(harness.store.getState().project).toBeNull();
  });
});

describe("documents and tabs", () => {
  it("opens a document, activates it and its first sheet", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_A);
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_A)).toBe(SHEET_A1);
  });

  it("keeps the remembered sheet when a document is activated again", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
    await harness.actions.openDocument(DOCUMENT_B);
    await harness.actions.openDocument(DOCUMENT_A);
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_A)).toBe(SHEET_A2);
    expect(harness.gateway.methods("loadDocument")).toHaveLength(2);
  });

  it("does not open a document that failed to load", async () => {
    const harness = await openedActionsHarness();
    const result = await harness.actions.openDocument(FAILED_DOCUMENT_ID);
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("loadDocument")).toEqual([]);
    expect(ui(harness).activeDocumentId).toBeNull();
    expect(ui(harness).operationErrors).toEqual([]);
  });

  it("records a load failure and opens no tab", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.failOn("loadDocument", "ioError");
    const result = await harness.actions.openDocument(DOCUMENT_A);
    expect(result.ok).toBe(false);
    expect(harness.store.getState().documents.size).toBe(0);
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "openDocument", subject: "Document A" },
    ]);
  });

  it("activates the next tab when the active one is closed, else the previous", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.createDocument("Third");
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.openDocument(DOCUMENT_B);
    // Tabs: B? order of opening is Third, A, B.
    const order = [...harness.store.getState().documents.keys()];
    expect(order).toHaveLength(3);
    await harness.actions.openDocument(order[1] ?? DOCUMENT_A);
    await harness.actions.closeDocument(order[1] ?? DOCUMENT_A);
    expect(ui(harness).activeDocumentId).toBe(order[2]);
    await harness.actions.closeDocument(order[2] ?? DOCUMENT_B);
    expect(ui(harness).activeDocumentId).toBe(order[0]);
    await harness.actions.closeDocument(order[0] ?? DOCUMENT_A);
    expect(ui(harness).activeDocumentId).toBeNull();
  });

  it("does not change the active tab when an inactive tab is closed", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.openDocument(DOCUMENT_B);
    await harness.actions.closeDocument(DOCUMENT_A);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_B);
  });

  it("keeps the tab open and reports when saving before close fails", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await makeDocumentADirty(harness);
    harness.gateway.failAlways("saveSheet", "ioError");
    const result = await harness.actions.closeDocument(DOCUMENT_A);
    expect(result.ok).toBe(false);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_A);
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "closeDocument", subject: "Document A" },
    ]);
  });

  it("selects a sheet and opens its document when needed", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.selectSheet(DOCUMENT_B, SHEET_B1);
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(true);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_B);
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_B)).toBe(SHEET_B1);
  });

  it("ignores a sheet that failed to load", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.selectSheet(DOCUMENT_A, FAILED_SHEET_ID);
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_A)).toBe(SHEET_A1);
  });
});

describe("creating documents and sheets", () => {
  it("creates a document, opens and activates it", async () => {
    const harness = await openedActionsHarness();
    harness.actions.requestCreateDocument();
    expect(ui(harness).dialog).toEqual({ kind: "createDocument" });
    await harness.actions.createDocument("Design");
    expect(ui(harness).dialog).toEqual({ kind: "none" });
    const documentId = ui(harness).activeDocumentId;
    expect(documentId).not.toBeNull();
    expect(
      harness.store
        .getState()
        .project?.documents.some((entry) => entry.name === "Design"),
    ).toBe(true);
    expect(
      harness.store.getState().documents.has(documentId ?? DOCUMENT_A),
    ).toBe(true);
  });

  it("records an invalid name instead of creating", async () => {
    const harness = await openedActionsHarness();
    harness.actions.requestCreateDocument();
    const result = await harness.actions.createDocument("   ");
    expect(result.ok).toBe(false);
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "createDocument", error: { kind: "invalidDisplayName" } },
    ]);
    expect(harness.gateway.methods("createDocument")).toEqual([]);
  });

  it("opens the document first, then asks for the sheet name, then activates the new sheet", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.requestCreateSheet(DOCUMENT_B);
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(true);
    expect(ui(harness).dialog).toEqual({
      kind: "createSheet",
      documentId: DOCUMENT_B,
    });
    await harness.actions.createSheet(DOCUMENT_B, "Second");
    expect(ui(harness).dialog).toEqual({ kind: "none" });
    const entries =
      harness.store.getState().documentDetails.get(DOCUMENT_B)?.sheetEntries ??
      [];
    expect(entries.map((entry) => entry.name)).toEqual(["Sheet B1", "Second"]);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_B);
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_B)).toBe(
      entries[1]?.sheetId,
    );
  });

  it("does not ask for a sheet name for a document that cannot be opened", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.requestCreateSheet(FAILED_DOCUMENT_ID);
    expect(ui(harness).dialog).toEqual({ kind: "none" });
  });
});

describe("delete confirmation", () => {
  it("asks first and calls the workspace only after confirmation", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    harness.actions.requestDeleteSheet(DOCUMENT_A, SHEET_A1);
    expect(ui(harness).dialog).toEqual({
      kind: "confirmDeleteSheet",
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      name: "Sheet A1",
    });
    expect(harness.gateway.methods("deleteSheet")).toEqual([]);
    await harness.actions.confirmDelete();
    expect(harness.gateway.methods("deleteSheet")).toEqual(["deleteSheet"]);
    expect(ui(harness).dialog).toEqual({ kind: "none" });
  });

  it("does nothing on cancel", async () => {
    const harness = await openedActionsHarness();
    harness.actions.requestDeleteDocument(DOCUMENT_B);
    expect(ui(harness).dialog).toMatchObject({
      kind: "confirmDeleteDocument",
      name: "Document B",
    });
    harness.actions.cancelDialog();
    expect(ui(harness).dialog).toEqual({ kind: "none" });
    expect(harness.gateway.methods()).toEqual([]);
    await harness.actions.confirmDelete();
    expect(harness.gateway.methods()).toEqual([]);
  });

  it("activates the neighbouring sheet after the active sheet is deleted and clears undo history", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await makeDocumentADirty(harness);
    expect(
      harness.workspace.getDocumentSession(DOCUMENT_A)?.getState().history
        .canUndo,
    ).toBe(true);
    harness.actions.requestDeleteSheet(DOCUMENT_A, SHEET_A1);
    await harness.actions.confirmDelete();
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_A)).toBe(SHEET_A2);
    expect(
      harness.workspace.getDocumentSession(DOCUMENT_A)?.getState().history
        .canUndo,
    ).toBe(false);
  });

  it("reports a failed sheet deletion and keeps the sheet", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    harness.gateway.failAlways("deleteSheet", "ioError");
    harness.actions.requestDeleteSheet(DOCUMENT_A, SHEET_A2);
    const result = await harness.actions.confirmDelete();
    expect(result.ok).toBe(false);
    expect(ui(harness).dialog).toEqual({ kind: "none" });
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "deleteSheet", subject: "Sheet A2" },
    ]);
    expect(
      harness.store
        .getState()
        .documentDetails.get(DOCUMENT_A)
        ?.sheetEntries.some((entry) => entry.sheetId === SHEET_A2),
    ).toBe(true);
  });

  it("deletes an open document and activates the neighbouring tab", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.openDocument(DOCUMENT_B);
    harness.actions.requestDeleteDocument(DOCUMENT_B);
    await harness.actions.confirmDelete();
    expect(harness.gateway.methods("deleteDocument")).toEqual([
      "deleteDocument",
    ]);
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(false);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_A);
  });

  it("deletes a document that failed to load", async () => {
    const harness = await openedActionsHarness();
    harness.actions.requestDeleteDocument(FAILED_DOCUMENT_ID);
    await harness.actions.confirmDelete();
    expect(
      harness.store
        .getState()
        .project?.documents.some(
          (entry) => entry.documentId === FAILED_DOCUMENT_ID,
        ),
    ).toBe(false);
  });

  it("ignores a delete request for something unknown", async () => {
    const harness = await openedActionsHarness();
    harness.actions.requestDeleteSheet(DOCUMENT_B, SHEET_B1);
    expect(ui(harness).dialog).toEqual({ kind: "none" });
  });
});

describe("retry and notifications", () => {
  it("retries a document save through the session", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await makeDocumentADirty(harness);
    harness.gateway.failAlways("saveSheet", "ioError");
    await harness.workspace.getDocumentSession(DOCUMENT_A)?.flush();
    harness.gateway.clearFailures();
    harness.gateway.clearCalls();
    const result = await harness.actions.retryDocumentSave(DOCUMENT_A);
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("saveSheet")).toEqual(["saveSheet"]);
    expect(
      harness.store.getState().documents.get(DOCUMENT_A)?.save.lastError,
    ).toBeNull();
  });

  it("retries a project save", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.failAlways("saveProject", "ioError");
    await harness.workspace.createDocument("Doc");
    expect(harness.store.getState().project?.save.lastError).not.toBeNull();
    harness.gateway.clearFailures();
    const result = await harness.actions.retryProjectSave();
    expect(result.ok).toBe(true);
    expect(harness.store.getState().project?.save.lastError).toBeNull();
  });

  it("dismisses an operation error and toggles the panel", async () => {
    const harness = createActionsHarness();
    harness.gateway.failOn("openProject", "ioError");
    await harness.actions.openProjectViaDialog();
    const id = ui(harness).operationErrors[0]?.id ?? -1;
    harness.actions.dismissOperationError(id);
    expect(ui(harness).operationErrors).toEqual([]);
    harness.actions.setNotificationsOpen(false);
    expect(ui(harness).notificationsOpen).toBe(false);
    await settle();
  });
});
