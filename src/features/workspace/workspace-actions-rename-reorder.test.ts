import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  FAILED_SHEET_ID,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import {
  type ActionsHarness,
  openedActionsHarness,
  undoDepth,
} from "./test-support/actions-harness";
import { beginRenaming } from "./ui-state/ui-state";

function ui(harness: ActionsHarness) {
  return harness.uiStateStore.getState();
}

function sessionOf(harness: ActionsHarness, documentId = DOCUMENT_A) {
  const session = harness.workspace.getDocumentSession(documentId);
  if (session === null) throw new Error("the document must be open");
  return session;
}

const childOrder = (harness: ActionsHarness) =>
  harness.store.getState().project?.project.childOrder;
const sheetOrder = (harness: ActionsHarness) =>
  harness.store.getState().documents.get(DOCUMENT_A)?.document.sheetOrder;
const documentName = (harness: ActionsHarness, documentId = DOCUMENT_A) =>
  harness.store
    .getState()
    .project?.documents.find((entry) => entry.documentId === documentId)?.name;
const sheetName = (harness: ActionsHarness, sheetId = SHEET_A1) =>
  harness.store
    .getState()
    .documentDetails.get(DOCUMENT_A)
    ?.sheetEntries.find((entry) => entry.sheetId === sheetId)?.name;

async function withOpenDocumentA() {
  const harness = await openedActionsHarness();
  await harness.actions.openDocument(DOCUMENT_A);
  harness.gateway.clearCalls();
  return harness;
}

describe("renaming a document", () => {
  it("opens the editor on an open document without changing what is active", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.openDocument(DOCUMENT_B);
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.beginRenameDocument(DOCUMENT_B);
    expect(ui(harness).renaming).toEqual({
      kind: "document",
      documentId: DOCUMENT_B,
    });
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_A);
  });

  it("opens a document that is not open first, then opens the editor", async () => {
    const harness = await openedActionsHarness();
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(false);
    const result = await harness.actions.beginRenameDocument(DOCUMENT_B);
    expect(result.ok).toBe(true);
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(true);
    expect(ui(harness).activeDocumentId).toBe(DOCUMENT_B);
    expect(ui(harness).renaming).toEqual({
      kind: "document",
      documentId: DOCUMENT_B,
    });
  });

  it("does not enter rename when opening fails, and records the error", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.failOn("loadDocument", "ioError");
    const result = await harness.actions.beginRenameDocument(DOCUMENT_B);
    expect(result.ok).toBe(false);
    expect(ui(harness).renaming).toBeNull();
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "openDocument", error: { kind: "ioError" } },
    ]);
  });

  it("does nothing for a document that failed to load", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.beginRenameDocument(FAILED_DOCUMENT_ID);
    expect(ui(harness).renaming).toBeNull();
    expect(harness.gateway.methods("loadDocument")).toEqual([]);
  });

  it("renames with ONE history entry; undo and redo restore the names", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.beginRenameDocument(DOCUMENT_A);
    const result = await harness.actions.commitRename("Renamed");
    expect(result.ok).toBe(true);
    expect(ui(harness).renaming).toBeNull();
    expect(documentName(harness)).toBe("Renamed");
    expect(sessionOf(harness).getState().document.name).toBe("Renamed");
    expect(await undoDepth(harness)).toBe(1);

    await harness.canvasActions.undo(DOCUMENT_A);
    expect(documentName(harness)).toBe("Document A");
    await harness.canvasActions.redo(DOCUMENT_A);
    expect(documentName(harness)).toBe("Renamed");
    expect(ui(harness).operationErrors).toEqual([]);
  });

  it("creates no command for an unchanged name, and closes the editor", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.beginRenameDocument(DOCUMENT_A);
    const result = await harness.actions.commitRename("Document A");
    expect(result.ok).toBe(true);
    expect(ui(harness).renaming).toBeNull();
    expect(await undoDepth(harness)).toBe(0);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["control characters", "a\u0000b"],
    ["too long", "x".repeat(10_000)],
  ])(
    "refuses a %s name, keeps the editor open and records nothing",
    async (_label, name) => {
      const harness = await withOpenDocumentA();
      await harness.actions.beginRenameDocument(DOCUMENT_A);
      const result = await harness.actions.commitRename(name);
      expect(result.ok).toBe(false);
      expect(ui(harness).renaming).toEqual({
        kind: "document",
        documentId: DOCUMENT_A,
      });
      expect(ui(harness).operationErrors).toEqual([]);
      expect(documentName(harness)).toBe("Document A");
      expect(await undoDepth(harness)).toBe(0);
    },
  );

  it("cancel closes the editor without a command", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.beginRenameDocument(DOCUMENT_A);
    harness.actions.cancelRename();
    expect(ui(harness).renaming).toBeNull();
    expect(await undoDepth(harness)).toBe(0);
    expect((await harness.actions.commitRename("Late")).ok).toBe(true);
    expect(documentName(harness)).toBe("Document A");
  });

  it("records a failed command as an operation error and closes the editor", async () => {
    const harness = await withOpenDocumentA();
    await harness.workspace.closeDocument(DOCUMENT_A);
    // A rename that outlived its document (the UI normally ends it on close).
    harness.uiStateStore.setState((state) =>
      beginRenaming(state, { kind: "document", documentId: DOCUMENT_A }),
    );
    const result = await harness.actions.commitRename("Renamed");
    expect(result.ok).toBe(false);
    expect(ui(harness).renaming).toBeNull();
    expect(ui(harness).operationErrors).toMatchObject([
      { operation: "renameDocument", error: { kind: "notWritable" } },
    ]);
    expect(documentName(harness)).toBe("Document A");
  });
});

describe("renaming a sheet", () => {
  it("renames with one history entry and undo / redo restore the name", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.beginRenameSheet(DOCUMENT_A, SHEET_A2);
    expect(ui(harness).renaming).toEqual({
      kind: "sheet",
      documentId: DOCUMENT_A,
      sheetId: SHEET_A2,
    });
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_A)).toBe(SHEET_A1);

    await harness.actions.commitRename("Second");
    expect(sheetName(harness, SHEET_A2)).toBe("Second");
    expect(await undoDepth(harness)).toBe(1);
    await harness.canvasActions.undo(DOCUMENT_A);
    expect(sheetName(harness, SHEET_A2)).toBe("Sheet A2");
    await harness.canvasActions.redo(DOCUMENT_A);
    expect(sheetName(harness, SHEET_A2)).toBe("Second");
    expect(ui(harness).activeSheetIdByDocument.get(DOCUMENT_A)).toBe(SHEET_A1);
  });

  it("does nothing for a sheet that failed to load, an unchanged name or an invalid one", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.beginRenameSheet(DOCUMENT_A, FAILED_SHEET_ID);
    expect(ui(harness).renaming).toBeNull();

    await harness.actions.beginRenameSheet(DOCUMENT_A, SHEET_A1);
    expect((await harness.actions.commitRename("")).ok).toBe(false);
    expect(ui(harness).renaming).not.toBeNull();
    await harness.actions.commitRename("Sheet A1");
    expect(ui(harness).renaming).toBeNull();
    expect(await undoDepth(harness)).toBe(0);
  });
});

describe("moving a document", () => {
  it("moves one place with one project save and no history entry", async () => {
    const harness = await withOpenDocumentA();
    const result = await harness.actions.moveDocumentBy(DOCUMENT_B, "up");
    expect(result.ok).toBe(true);
    expect(childOrder(harness)).toEqual([
      DOCUMENT_B,
      DOCUMENT_A,
      FAILED_DOCUMENT_ID,
    ]);
    expect(harness.gateway.methods("saveProject")).toEqual(["saveProject"]);
    expect(await undoDepth(harness)).toBe(0);

    await harness.actions.moveDocumentBy(DOCUMENT_B, "down");
    expect(childOrder(harness)).toEqual([
      DOCUMENT_A,
      DOCUMENT_B,
      FAILED_DOCUMENT_ID,
    ]);
  });

  it("moves past an entry that failed to load, keeping its place", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.moveDocumentBy(DOCUMENT_B, "down");
    expect(childOrder(harness)).toEqual([
      DOCUMENT_A,
      FAILED_DOCUMENT_ID,
      DOCUMENT_B,
    ]);
  });

  it("is a safe no-op at the boundaries and for a document that failed to load", async () => {
    const harness = await withOpenDocumentA();
    const before = harness.store.getState();
    expect((await harness.actions.moveDocumentBy(DOCUMENT_A, "up")).ok).toBe(
      true,
    );
    expect(
      (await harness.actions.moveDocumentBy(FAILED_DOCUMENT_ID, "down")).ok,
    ).toBe(true);
    expect(
      (await harness.actions.moveDocumentBy(FAILED_DOCUMENT_ID, "up")).ok,
    ).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
    expect(harness.store.getState()).toBe(before);
    expect(ui(harness).operationErrors).toEqual([]);
  });

  it("records a failed save as an operation error", async () => {
    const harness = await withOpenDocumentA();
    harness.gateway.failOn("saveProject", "ioError");
    const result = await harness.actions.moveDocumentBy(DOCUMENT_B, "up");
    expect(result.ok).toBe(false);
    expect(ui(harness).operationErrors).toMatchObject([
      {
        operation: "moveDocument",
        subject: "Document B",
        error: { kind: "ioError" },
      },
    ]);
  });
});

describe("moving a sheet", () => {
  it("moves one place with one history entry; undo and redo restore the order", async () => {
    const harness = await withOpenDocumentA();
    const result = await harness.actions.moveSheetBy(
      DOCUMENT_A,
      SHEET_A2,
      "up",
    );
    expect(result.ok).toBe(true);
    expect(sheetOrder(harness)).toEqual([SHEET_A2, SHEET_A1, FAILED_SHEET_ID]);
    expect(await undoDepth(harness)).toBe(1);

    await harness.canvasActions.undo(DOCUMENT_A);
    expect(sheetOrder(harness)).toEqual([SHEET_A1, SHEET_A2, FAILED_SHEET_ID]);
    await harness.canvasActions.redo(DOCUMENT_A);
    expect(sheetOrder(harness)).toEqual([SHEET_A2, SHEET_A1, FAILED_SHEET_ID]);
  });

  it("moves down past a sheet that failed to load, which keeps its place", async () => {
    const harness = await withOpenDocumentA();
    await harness.actions.moveSheetBy(DOCUMENT_A, SHEET_A2, "down");
    expect(sheetOrder(harness)).toEqual([SHEET_A1, FAILED_SHEET_ID, SHEET_A2]);
  });

  it("is a safe no-op at the boundaries, for failed sheets and for closed documents", async () => {
    const harness = await withOpenDocumentA();
    const before = harness.store.getState();
    for (const [sheetId, direction] of [
      [SHEET_A1, "up"],
      [FAILED_SHEET_ID, "down"],
      [FAILED_SHEET_ID, "up"],
    ] as const) {
      expect(
        (await harness.actions.moveSheetBy(DOCUMENT_A, sheetId, direction)).ok,
      ).toBe(true);
    }
    expect(
      (await harness.actions.moveSheetBy(DOCUMENT_B, SHEET_A1, "down")).ok,
    ).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
    expect(harness.store.getState()).toBe(before);
    expect(await undoDepth(harness)).toBe(0);
    expect(ui(harness).operationErrors).toEqual([]);
  });
});
