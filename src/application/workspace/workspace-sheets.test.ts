import { describe, expect, it } from "vitest";
import { renameSheetCommand } from "../commands/naming-commands";
import {
  displayName,
  documentIdOf,
  settle,
  sheetIdOf,
} from "../test-support/fakes";
import {
  CONFIRMED,
  DOCUMENT_A,
  DOCUMENT_B,
  errorKind,
  FAILED_SHEET_ID,
  openedDocumentA,
  openedWorkspace,
  SHEET_A1,
  SHEET_A2,
} from "../test-support/workspace-harness";

describe("createSheet", () => {
  it("creates the sheet, then saves the document", async () => {
    const { workspace, store, gateway } = await openedDocumentA();
    const result = await workspace.createSheet(DOCUMENT_A, "New sheet");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sheetId = result.value;
    // The new sheet's own file already exists; only the order needs saving.
    expect(gateway.methods()).toEqual(["createSheet", "saveDocument"]);
    expect(gateway.disk.documents.get(DOCUMENT_A)?.sheets.has(sheetId)).toBe(
      true,
    );
    expect(
      gateway.disk.documents.get(DOCUMENT_A)?.document.sheetOrder.at(-1),
    ).toBe(sheetId);
    const state = store.getState();
    expect(state.documents.get(DOCUMENT_A)?.sheets.get(sheetId)?.name).toBe(
      "New sheet",
    );
    expect(state.documents.get(DOCUMENT_A)?.document.sheetOrder.at(-1)).toBe(
      sheetId,
    );
    expect(
      state.documentDetails
        .get(DOCUMENT_A)
        ?.sheetEntries.find((entry) => entry.sheetId === sheetId),
    ).toEqual({ sheetId, name: "New sheet", state: "loaded" });
    expect(state.documents.get(DOCUMENT_A)?.save.documentDirty).toBe(false);
  });

  it("keeps the history valid", async () => {
    const { workspace, store } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    await session?.execute(
      renameSheetCommand(SHEET_A1, displayName("Renamed")),
    );
    await workspace.createSheet(DOCUMENT_A, "Another");
    expect(store.getState().documents.get(DOCUMENT_A)?.history.canUndo).toBe(
      true,
    );
    await session?.undo();
    expect(
      store.getState().documents.get(DOCUMENT_A)?.sheets.get(SHEET_A1)?.name,
    ).toBe("Sheet A1");
  });

  it("changes nothing when creation fails or the name is invalid", async () => {
    const { workspace, store, gateway } = await openedDocumentA();
    const before = store.getState();
    gateway.failOn("createSheet", "ioError");
    expect(errorKind(await workspace.createSheet(DOCUMENT_A, "X"))).toBe(
      "ioError",
    );
    expect(errorKind(await workspace.createSheet(DOCUMENT_A, " "))).toBe(
      "invalidDisplayName",
    );
    expect(store.getState()).toBe(before);
    expect(gateway.methods("saveDocument")).toHaveLength(0);
  });

  it("keeps the created sheet, document dirty, when the save fails; flush retries", async () => {
    const { workspace, store, gateway } = await openedDocumentA();
    gateway.failOn("saveDocument", "ioError");
    expect(errorKind(await workspace.createSheet(DOCUMENT_A, "Kept"))).toBe(
      "ioError",
    );
    const state = store.getState().documents.get(DOCUMENT_A);
    const sheetId = state?.document.sheetOrder.at(-1);
    expect(sheetId !== undefined && state?.sheets.has(sheetId)).toBe(true);
    expect(state?.save.documentDirty).toBe(true);
    expect(state?.save.lastError?.kind).toBe("ioError");
    // On disk the directory exists, the order does not list it.
    const disk = gateway.disk.documents.get(DOCUMENT_A);
    expect(sheetId !== undefined && disk?.sheets.has(sheetId)).toBe(true);
    expect(
      sheetId !== undefined && disk?.document.sheetOrder.includes(sheetId),
    ).toBe(false);
    expect((await workspace.getDocumentSession(DOCUMENT_A)?.flush())?.ok).toBe(
      true,
    );
    expect(
      sheetId !== undefined && disk?.document.sheetOrder.includes(sheetId),
    ).toBe(true);
  });

  it("needs an open, known document", async () => {
    const { workspace } = await openedWorkspace();
    expect(errorKind(await workspace.createSheet(DOCUMENT_B, "X"))).toBe(
      "notWritable",
    );
    expect(errorKind(await workspace.createSheet(documentIdOf(99), "X"))).toBe(
      "entityNotFound",
    );
  });
});

describe("deleteSheet", () => {
  it("saves the order without the sheet, then deletes it, and clears history", async () => {
    const { workspace, store, gateway, events } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    await session?.execute(
      renameSheetCommand(SHEET_A2, displayName("Renamed")),
    );
    await session?.flush();
    gateway.clearCalls();
    expect(
      (await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED)).ok,
    ).toBe(true);
    expect(gateway.methods()).toEqual(["saveDocument", "deleteSheet"]);
    expect(gateway.disk.documents.get(DOCUMENT_A)?.sheets.has(SHEET_A1)).toBe(
      false,
    );
    expect(
      gateway.disk.documents.get(DOCUMENT_A)?.document.sheetOrder,
    ).not.toContain(SHEET_A1);
    const state = store.getState();
    expect(state.documents.get(DOCUMENT_A)?.sheets.has(SHEET_A1)).toBe(false);
    expect(state.documents.get(DOCUMENT_A)?.document.sheetOrder).not.toContain(
      SHEET_A1,
    );
    expect(
      state.documentDetails
        .get(DOCUMENT_A)
        ?.sheetEntries.map((entry) => entry.sheetId),
    ).toEqual([SHEET_A2, FAILED_SHEET_ID]);
    expect(state.documents.get(DOCUMENT_A)?.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
    expect(state.documents.get(DOCUMENT_A)?.save.documentDirty).toBe(false);
    expect(events).toEqual([
      { type: "sheetDeleted", documentId: DOCUMENT_A, sheetId: SHEET_A1 },
    ]);
  });

  it("requires an explicit confirmation by type", async () => {
    const { workspace } = await openedDocumentA();
    const missingConfirmation = () =>
      // @ts-expect-error the confirmation parameter is required
      workspace.deleteSheet(DOCUMENT_A, SHEET_A1);
    expect(missingConfirmation).toBeTypeOf("function");
  });

  it("flushes pending edits of other sheets first", async () => {
    const { workspace, gateway } = await openedDocumentA();
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A2, displayName("Pending")));
    expect(
      (await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED)).ok,
    ).toBe(true);
    expect(gateway.methods()).toEqual([
      "saveSheet",
      "saveDocument",
      "deleteSheet",
    ]);
    expect(gateway.savedSheets.get(SHEET_A2)?.name).toBe("Pending");
  });

  it("aborts without changes when the flush fails", async () => {
    const { workspace, store, gateway } = await openedDocumentA();
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A2, displayName("Pending")));
    gateway.failOn("saveSheet", "ioError");
    expect(
      errorKind(await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED)),
    ).toBe("ioError");
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(
      store.getState().documents.get(DOCUMENT_A)?.sheets.has(SHEET_A1),
    ).toBe(true);
    expect(store.getState().documents.get(DOCUMENT_A)?.history.canUndo).toBe(
      true,
    );
  });

  it("aborts without changes when the order cannot be saved", async () => {
    const { workspace, store, gateway } = await openedDocumentA();
    gateway.failOn("saveDocument", "ioError");
    expect(
      errorKind(await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED)),
    ).toBe("ioError");
    expect(gateway.methods("deleteSheet")).toHaveLength(0);
    expect(
      store.getState().documents.get(DOCUMENT_A)?.sheets.has(SHEET_A1),
    ).toBe(true);
    expect(gateway.disk.documents.get(DOCUMENT_A)?.sheets.has(SHEET_A1)).toBe(
      true,
    );
    expect(
      gateway.disk.documents.get(DOCUMENT_A)?.document.sheetOrder,
    ).toContain(SHEET_A1);
  });

  it("restores the saved order when the directory cannot be deleted, keeping history", async () => {
    const { workspace, store, gateway, events } = await openedDocumentA();
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A2, displayName("Renamed")));
    await workspace.getDocumentSession(DOCUMENT_A)?.flush();
    gateway.clearCalls();
    gateway.failOn("deleteSheet", "ioError");
    expect(
      errorKind(await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED)),
    ).toBe("ioError");
    expect(gateway.methods()).toEqual([
      "saveDocument",
      "deleteSheet",
      "saveDocument",
    ]);
    expect(
      gateway.disk.documents.get(DOCUMENT_A)?.document.sheetOrder,
    ).toContain(SHEET_A1);
    const state = store.getState().documents.get(DOCUMENT_A);
    expect(state?.sheets.has(SHEET_A1)).toBe(true);
    expect(state?.save.documentDirty).toBe(false);
    expect(state?.history.canUndo).toBe(true);
    expect(events).toEqual([]);
  });

  it("leaves the document dirty when restoring the order also fails", async () => {
    const { workspace, store, gateway } = await openedDocumentA();
    gateway.failOn("deleteSheet", "ioError");
    gateway.failOn("saveDocument", "ioError", 2);
    expect(
      errorKind(await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED)),
    ).toBe("ioError");
    expect(store.getState().documents.get(DOCUMENT_A)?.save.documentDirty).toBe(
      true,
    );
    // Disk lost the order entry; memory still has the sheet, and the retry fixes disk.
    expect(
      gateway.disk.documents.get(DOCUMENT_A)?.document.sheetOrder,
    ).not.toContain(SHEET_A1);
    expect((await workspace.getDocumentSession(DOCUMENT_A)?.flush())?.ok).toBe(
      true,
    );
    expect(
      gateway.disk.documents.get(DOCUMENT_A)?.document.sheetOrder,
    ).toContain(SHEET_A1);
  });

  it("deletes a sheet that failed to load", async () => {
    const { workspace, store, gateway, events } = await openedDocumentA();
    expect(
      (await workspace.deleteSheet(DOCUMENT_A, FAILED_SHEET_ID, CONFIRMED)).ok,
    ).toBe(true);
    expect(
      gateway.disk.documents.get(DOCUMENT_A)?.sheets.has(FAILED_SHEET_ID),
    ).toBe(false);
    expect(
      store
        .getState()
        .documentDetails.get(DOCUMENT_A)
        ?.sheetEntries.map((entry) => entry.sheetId),
    ).toEqual([SHEET_A1, SHEET_A2]);
    expect(events).toHaveLength(1);
  });

  it("reports unknown sheets and documents that are not open", async () => {
    const { workspace } = await openedDocumentA();
    expect(
      errorKind(
        await workspace.deleteSheet(DOCUMENT_A, sheetIdOf(99), CONFIRMED),
      ),
    ).toBe("entityNotFound");
    expect(
      errorKind(
        await workspace.deleteSheet(DOCUMENT_B, sheetIdOf(4), CONFIRMED),
      ),
    ).toBe("notWritable");
    expect(
      errorKind(
        await workspace.deleteSheet(documentIdOf(99), SHEET_A1, CONFIRMED),
      ),
    ).toBe("entityNotFound");
  });

  it("waits for an in-flight auto-save", async () => {
    const { workspace, gateway, scheduler } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    const release = gateway.hold("saveSheet");
    await session?.execute(renameSheetCommand(SHEET_A2, displayName("Racing")));
    scheduler.advance(1000);
    await settle();
    const deleting = workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED);
    await settle();
    expect(gateway.methods("saveDocument", "deleteSheet")).toEqual([]);
    release();
    expect((await deleting).ok).toBe(true);
    expect(gateway.methods()).toEqual([
      "saveSheet",
      "saveDocument",
      "deleteSheet",
    ]);
  });

  it("refuses sheet operations on a document closed meanwhile", async () => {
    const { workspace } = await openedDocumentA();
    await workspace.closeDocument(DOCUMENT_A);
    expect(
      errorKind(await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED)),
    ).toBe("notWritable");
  });
});
