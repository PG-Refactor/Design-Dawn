import { describe, expect, it } from "vitest";
import {
  CONFIRMED,
  DOCUMENT_A,
  openedDocumentA,
  SHEET_A2,
  type WorkspaceHarness,
} from "../test-support/workspace-harness";

// Auto Save off: adding and deleting a sheet waits for a save like any other change.
async function withAutoSaveOff(): Promise<WorkspaceHarness> {
  const harness = await openedDocumentA();
  harness.autoSaveController.applyExternal(false);
  return harness;
}

function savedOrder(harness: WorkspaceHarness) {
  return harness.gateway.disk.documents.get(DOCUMENT_A)?.document.sheetOrder;
}

function sessionOf(harness: WorkspaceHarness) {
  const session = harness.workspace.getDocumentSession(DOCUMENT_A);
  if (session === null) throw new Error("Document A is not open");
  return session;
}

describe("sheets with Auto Save off", () => {
  it("reserves a new sheet and writes it with the next save", async () => {
    const harness = await withAutoSaveOff();
    const orderBefore = savedOrder(harness);

    const created = await harness.workspace.createSheet(DOCUMENT_A, "Later");

    expect(created.ok).toBe(true);
    const sheetId = created.ok ? created.value : null;
    expect(harness.gateway.methods("createSheet", "reserveSheet")).toEqual([
      "reserveSheet",
    ]);
    expect(savedOrder(harness)).toEqual(orderBefore);
    const state = sessionOf(harness).getState();
    expect(state.save.documentDirty).toBe(true);
    expect([...state.save.dirtySheetIds]).toEqual([sheetId]);

    expect((await sessionOf(harness).flush()).ok).toBe(true);

    expect(harness.gateway.methods("saveSheet", "saveDocument")).toEqual([
      "saveSheet",
      "saveDocument",
    ]);
    expect(savedOrder(harness)?.at(-1)).toBe(sheetId);
  });

  it("deletes a sheet's directory only with the next save, after the order", async () => {
    const harness = await withAutoSaveOff();

    const deleted = await harness.workspace.deleteSheet(
      DOCUMENT_A,
      SHEET_A2,
      CONFIRMED,
    );

    expect(deleted.ok).toBe(true);
    expect(harness.gateway.methods("deleteSheet", "saveDocument")).toEqual([]);
    expect(sessionOf(harness).getState().document.sheetOrder).not.toContain(
      SHEET_A2,
    );
    expect(savedOrder(harness)).toContain(SHEET_A2);
    expect(sessionOf(harness).getState().save.documentDirty).toBe(true);

    expect((await sessionOf(harness).flush()).ok).toBe(true);

    expect(harness.gateway.methods("deleteSheet", "saveDocument")).toEqual([
      "saveDocument",
      "deleteSheet",
    ]);
    expect(savedOrder(harness)).not.toContain(SHEET_A2);
    expect(
      harness.gateway.disk.documents.get(DOCUMENT_A)?.sheets.has(SHEET_A2),
    ).toBe(false);
  });

  it("keeps a planned deletion until the order is saved and the directory goes", async () => {
    const harness = await withAutoSaveOff();
    await harness.workspace.deleteSheet(DOCUMENT_A, SHEET_A2, CONFIRMED);

    harness.gateway.failOn("saveDocument", "ioError");
    expect((await sessionOf(harness).flush()).ok).toBe(false);
    expect(harness.gateway.methods("deleteSheet")).toEqual([]);

    harness.gateway.failOn("deleteSheet", "ioError");
    expect((await sessionOf(harness).flush()).ok).toBe(false);
    expect(sessionOf(harness).getState().save.lastError?.kind).toBe("ioError");

    expect((await sessionOf(harness).flush()).ok).toBe(true);
    expect(harness.gateway.methods("deleteSheet")).toEqual([
      "deleteSheet",
      "deleteSheet",
    ]);
    expect(
      harness.gateway.disk.documents.get(DOCUMENT_A)?.sheets.has(SHEET_A2),
    ).toBe(false);
  });

  it("forgets a sheet added and deleted before a save", async () => {
    const harness = await withAutoSaveOff();
    const created = await harness.workspace.createSheet(DOCUMENT_A, "Brief");
    const sheetId = created.ok ? created.value : null;
    if (sheetId === null) throw new Error("not created");
    const orderBefore = savedOrder(harness);

    await harness.workspace.deleteSheet(DOCUMENT_A, sheetId, CONFIRMED);
    expect((await sessionOf(harness).flush()).ok).toBe(true);

    expect(harness.gateway.methods("saveSheet")).toEqual([]);
    expect(savedOrder(harness)).toEqual(orderBefore);
  });

  it("leaves the files as they were when the Document closes without saving", async () => {
    const harness = await withAutoSaveOff();
    const orderBefore = savedOrder(harness);
    await harness.workspace.createSheet(DOCUMENT_A, "Dropped");
    await harness.workspace.deleteSheet(DOCUMENT_A, SHEET_A2, CONFIRMED);

    const closed = await harness.workspace.closeDocument(DOCUMENT_A, {
      discardChanges: true,
    });

    expect(closed.ok).toBe(true);
    expect(
      harness.gateway.methods("saveSheet", "saveDocument", "deleteSheet"),
    ).toEqual([]);
    expect(savedOrder(harness)).toEqual(orderBefore);
  });
});
