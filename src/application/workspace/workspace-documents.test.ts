import { describe, expect, it } from "vitest";
import { moveBlocksCommand } from "../commands/block-commands";
import {
  renameDocumentCommand,
  renameSheetCommand,
} from "../commands/naming-commands";
import {
  blockIdOf,
  displayName,
  documentIdOf,
  position,
  settle,
} from "../test-support/fakes";
import {
  CONFIRMED,
  DOCUMENT_A,
  DOCUMENT_A_ISSUE,
  DOCUMENT_B,
  errorKind,
  FAILED_DOCUMENT_ID,
  FAILED_SHEET_ID,
  openedDocumentA,
  openedWorkspace,
  SHEET_A1,
  SHEET_A2,
} from "../test-support/workspace-harness";

const moveFirstBlock = (x: number) =>
  moveBlocksCommand(SHEET_A1, [
    { blockId: blockIdOf(1), position: position(x, x) },
  ]);

describe("openDocument", () => {
  it("builds a session with only the loaded sheets editable", async () => {
    const { workspace, store } = await openedWorkspace();
    expect((await workspace.openDocument(DOCUMENT_A)).ok).toBe(true);
    const state = store.getState();
    expect([...(state.documents.get(DOCUMENT_A)?.sheets.keys() ?? [])]).toEqual(
      [SHEET_A1, SHEET_A2],
    );
    const details = state.documentDetails.get(DOCUMENT_A);
    expect(details?.sheetEntries).toEqual([
      { sheetId: SHEET_A1, name: "Sheet A1", state: "loaded" },
      { sheetId: SHEET_A2, name: "Sheet A2", state: "loaded" },
      { sheetId: FAILED_SHEET_ID, name: null, state: "loadFailed" },
    ]);
    expect(details?.issues).toEqual([DOCUMENT_A_ISSUE]);
    expect(workspace.getDocumentSession(DOCUMENT_A)).not.toBeNull();
  });

  it("is idempotent", async () => {
    const { workspace, gateway } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    const session = workspace.getDocumentSession(DOCUMENT_A);
    expect((await workspace.openDocument(DOCUMENT_A)).ok).toBe(true);
    expect(workspace.getDocumentSession(DOCUMENT_A)).toBe(session);
    expect(gateway.methods("loadDocument")).toHaveLength(1);
  });

  it("reports unknown documents", async () => {
    const { workspace } = await openedWorkspace();
    expect(errorKind(await workspace.openDocument(documentIdOf(99)))).toBe(
      "entityNotFound",
    );
  });

  it("cannot open a document whose own metadata failed to load", async () => {
    const { workspace, store } = await openedWorkspace();
    const result = await workspace.openDocument(FAILED_DOCUMENT_ID);
    expect(errorKind(result)).toBe("invalidFileStructure");
    expect(store.getState().documents.size).toBe(0);
    expect(workspace.getDocumentSession(FAILED_DOCUMENT_ID)).toBeNull();
  });

  it("propagates a load failure and opens nothing", async () => {
    const { workspace, gateway, store } = await openedWorkspace();
    gateway.failOn("loadDocument", "ioError");
    expect(errorKind(await workspace.openDocument(DOCUMENT_A))).toBe("ioError");
    expect(store.getState().documents.size).toBe(0);
    expect((await workspace.openDocument(DOCUMENT_A)).ok).toBe(true);
  });
});

describe("document sessions through the workspace", () => {
  it("shows executed commands in the store, with undo and redo", async () => {
    const { workspace, store } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    // No blocks exist in the seeded sheets, so a rename is the observable command.
    await session?.execute(
      renameSheetCommand(SHEET_A1, displayName("Renamed")),
    );
    const sheetName = () =>
      store.getState().documents.get(DOCUMENT_A)?.sheets.get(SHEET_A1)?.name;
    expect(sheetName()).toBe("Renamed");
    expect(
      store
        .getState()
        .documentDetails.get(DOCUMENT_A)
        ?.sheetEntries.find((entry) => entry.sheetId === SHEET_A1)?.name,
    ).toBe("Renamed");
    expect(store.getState().documents.get(DOCUMENT_A)?.history.canUndo).toBe(
      true,
    );
    await session?.undo();
    expect(sheetName()).toBe("Sheet A1");
    await session?.redo();
    expect(sheetName()).toBe("Renamed");
  });

  it("renames the project's document entry with renameDocument", async () => {
    const { workspace, store } = await openedDocumentA();
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameDocumentCommand(displayName("New name")));
    const entry = store
      .getState()
      .project?.documents.find(
        (candidate) => candidate.documentId === DOCUMENT_A,
      );
    expect(entry?.name).toBe("New name");
  });
});

describe("closeDocument", () => {
  it("saves pending changes, then removes session and sibling data", async () => {
    const { workspace, store, gateway, events } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    await session?.execute(renameSheetCommand(SHEET_A1, displayName("Saved")));
    expect((await workspace.closeDocument(DOCUMENT_A)).ok).toBe(true);
    expect(gateway.methods()).toEqual(["saveSheet"]);
    expect(gateway.savedSheets.get(SHEET_A1)?.name).toBe("Saved");
    expect(store.getState().documents.size).toBe(0);
    expect(store.getState().documentDetails.size).toBe(0);
    expect(workspace.getDocumentSession(DOCUMENT_A)).toBeNull();
    expect(events).toEqual([
      {
        type: "documentClosed",
        documentId: DOCUMENT_A,
        sheetIds: [SHEET_A1, SHEET_A2, FAILED_SHEET_ID],
      },
    ]);
    // The old session object refuses everything, and a reopened document has no history.
    expect(
      errorKind(
        await (session?.execute(moveFirstBlock(1)) ?? Promise.reject()),
      ),
    ).toBe("notWritable");
    await workspace.openDocument(DOCUMENT_A);
    expect(store.getState().documents.get(DOCUMENT_A)?.history.canUndo).toBe(
      false,
    );
  });

  it("is idempotent", async () => {
    const { workspace, events } = await openedWorkspace();
    expect((await workspace.closeDocument(DOCUMENT_A)).ok).toBe(true);
    await workspace.openDocument(DOCUMENT_A);
    await workspace.closeDocument(DOCUMENT_A);
    expect((await workspace.closeDocument(DOCUMENT_A)).ok).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("fails and keeps the document, flags and history when saving fails", async () => {
    const { workspace, store, gateway, events } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    await session?.execute(renameSheetCommand(SHEET_A1, displayName("Dirty")));
    gateway.failOn("saveSheet", "ioError");
    expect(errorKind(await workspace.closeDocument(DOCUMENT_A))).toBe(
      "ioError",
    );
    const state = store.getState().documents.get(DOCUMENT_A);
    expect(state?.save.dirtySheetIds.has(SHEET_A1)).toBe(true);
    expect(state?.save.lastError?.kind).toBe("ioError");
    expect(state?.history.canUndo).toBe(true);
    expect(events).toEqual([]);
    expect(workspace.getDocumentSession(DOCUMENT_A)).toBe(session);
    // Still editable, and a later close succeeds without losing the change.
    expect(
      (
        await session?.execute(
          renameSheetCommand(SHEET_A2, displayName("More")),
        )
      )?.ok,
    ).toBe(true);
    expect((await workspace.closeDocument(DOCUMENT_A)).ok).toBe(true);
    expect(gateway.savedSheets.get(SHEET_A1)?.name).toBe("Dirty");
    expect(gateway.savedSheets.get(SHEET_A2)?.name).toBe("More");
  });

  it("waits for an in-flight save and does not lose later changes", async () => {
    const { workspace, store, gateway, scheduler } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    const release = gateway.hold("saveSheet");
    await session?.execute(renameSheetCommand(SHEET_A1, displayName("First")));
    scheduler.advance(1000);
    await settle();
    expect(gateway.methods("saveSheet")).toHaveLength(1);
    // Issued while the auto-save is in flight: queued behind it.
    const later = session?.execute(
      renameSheetCommand(SHEET_A2, displayName("Second")),
    );
    const closing = workspace.closeDocument(DOCUMENT_A);
    await settle();
    expect(store.getState().documents.has(DOCUMENT_A)).toBe(true);
    release();
    expect((await later)?.ok).toBe(true);
    expect((await closing).ok).toBe(true);
    expect(gateway.savedSheets.get(SHEET_A1)?.name).toBe("First");
    expect(gateway.savedSheets.get(SHEET_A2)?.name).toBe("Second");
    expect(store.getState().documents.size).toBe(0);
  });
});

describe("createDocument", () => {
  it("creates, then saves the order", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    const result = await workspace.createDocument("New document");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(gateway.methods()).toEqual(["createDocument", "saveProject"]);
    expect(gateway.disk.documents.has(result.value)).toBe(true);
    expect(gateway.disk.documentOrder.at(-1)).toBe(result.value);
    const project = store.getState().project;
    expect(project?.project.documentOrder.at(-1)).toBe(result.value);
    expect(project?.documents.at(-1)).toEqual({
      documentId: result.value,
      name: "New document",
      state: "loaded",
    });
    expect(project?.save.dirty).toBe(false);
  });

  it("changes nothing when the name is invalid or creation fails", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    const before = store.getState();
    expect(errorKind(await workspace.createDocument(""))).toBe(
      "invalidDisplayName",
    );
    gateway.failOn("createDocument", "ioError");
    expect(errorKind(await workspace.createDocument("X"))).toBe("ioError");
    expect(store.getState()).toBe(before);
    expect(gateway.methods("saveProject")).toHaveLength(0);
    expect(gateway.disk.documents.size).toBe(3);
  });

  it("keeps the document, dirty, when the order cannot be saved; retry persists", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    gateway.failOn("saveProject", "ioError");
    expect(errorKind(await workspace.createDocument("New"))).toBe("ioError");
    const project = store.getState().project;
    const created = project?.project.documentOrder.at(-1);
    expect(created).toBeDefined();
    expect(project?.documents.at(-1)?.name).toBe("New");
    expect(project?.save.dirty).toBe(true);
    expect(project?.save.lastError?.kind).toBe("ioError");
    // On disk: the directory exists but the order does not list it yet.
    expect(created !== undefined && gateway.disk.documents.has(created)).toBe(
      true,
    );
    expect(
      created !== undefined && gateway.disk.documentOrder.includes(created),
    ).toBe(false);
    expect((await workspace.saveProject()).ok).toBe(true);
    expect(
      created !== undefined && gateway.disk.documentOrder.includes(created),
    ).toBe(true);
    expect(store.getState().project?.save.dirty).toBe(false);
  });
});

describe("deleteDocument", () => {
  it("saves the order without the document, then deletes the directory", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    expect((await workspace.deleteDocument(DOCUMENT_B, CONFIRMED)).ok).toBe(
      true,
    );
    expect(gateway.methods()).toEqual(["saveProject", "deleteDocument"]);
    expect(gateway.disk.documents.has(DOCUMENT_B)).toBe(false);
    expect(gateway.disk.documentOrder).not.toContain(DOCUMENT_B);
    expect(
      store
        .getState()
        .project?.documents.some((entry) => entry.documentId === DOCUMENT_B),
    ).toBe(false);
    expect(store.getState().project?.project.documentOrder).not.toContain(
      DOCUMENT_B,
    );
  });

  it("requires an explicit confirmation by type", async () => {
    const { workspace } = await openedWorkspace();
    // Never called: only the compile-time check matters.
    const missingConfirmation = () =>
      // @ts-expect-error the confirmation parameter is required
      workspace.deleteDocument(DOCUMENT_B);
    const wrongConfirmation = () =>
      // @ts-expect-error the confirmation must say the user confirmed
      workspace.deleteDocument(DOCUMENT_B, { confirmedByUser: false });
    expect(missingConfirmation).toBeTypeOf("function");
    expect(wrongConfirmation).toBeTypeOf("function");
  });

  it("changes nothing when saving the order fails", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    const before = store.getState();
    gateway.failOn("saveProject", "ioError");
    expect(
      errorKind(await workspace.deleteDocument(DOCUMENT_B, CONFIRMED)),
    ).toBe("ioError");
    expect(store.getState()).toBe(before);
    expect(gateway.methods("deleteDocument")).toHaveLength(0);
    expect(gateway.disk.documents.has(DOCUMENT_B)).toBe(true);
    expect(gateway.disk.documentOrder).toContain(DOCUMENT_B);
  });

  it("puts the entry back at the end, dirty, when the directory cannot be deleted", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    gateway.failOn("deleteDocument", "ioError");
    expect(
      errorKind(await workspace.deleteDocument(DOCUMENT_A, CONFIRMED)),
    ).toBe("ioError");
    // Disk: directory still there, saved order without it.
    expect(gateway.disk.documents.has(DOCUMENT_A)).toBe(true);
    expect(gateway.disk.documentOrder).not.toContain(DOCUMENT_A);
    const project = store.getState().project;
    expect(project?.project.documentOrder.at(-1)).toBe(DOCUMENT_A);
    expect(project?.documents.at(-1)?.documentId).toBe(DOCUMENT_A);
    expect(project?.save.dirty).toBe(true);
    expect(project?.save.lastError?.kind).toBe("ioError");
    expect((await workspace.saveProject()).ok).toBe(true);
    expect(gateway.disk.documentOrder).toContain(DOCUMENT_A);
  });

  it("discards an open document without saving and emits the event", async () => {
    const { workspace, store, gateway, events } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    await session?.execute(
      renameSheetCommand(SHEET_A1, displayName("Unsaved")),
    );
    expect((await workspace.deleteDocument(DOCUMENT_A, CONFIRMED)).ok).toBe(
      true,
    );
    expect(gateway.methods()).toEqual(["saveProject", "deleteDocument"]);
    expect(store.getState().documents.size).toBe(0);
    expect(store.getState().documentDetails.size).toBe(0);
    expect(workspace.getDocumentSession(DOCUMENT_A)).toBeNull();
    expect(events.map((event) => event.type)).toEqual(["documentClosed"]);
    expect(errorKind(await (session?.flush() ?? Promise.reject()))).toBe(
      "notWritable",
    );
  });

  it("deletes a document that failed to load", async () => {
    const { workspace, gateway } = await openedWorkspace();
    expect(
      (await workspace.deleteDocument(FAILED_DOCUMENT_ID, CONFIRMED)).ok,
    ).toBe(true);
    expect(gateway.disk.documents.has(FAILED_DOCUMENT_ID)).toBe(false);
  });

  it("reports unknown documents", async () => {
    const { workspace } = await openedWorkspace();
    expect(
      errorKind(await workspace.deleteDocument(documentIdOf(99), CONFIRMED)),
    ).toBe("entityNotFound");
  });
});
