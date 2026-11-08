import { describe, expect, it } from "vitest";
import { renameSheetCommand } from "../../application/commands/naming-commands";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import { displayName } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_D,
  FOLDER_1,
  FOLDER_2,
  SHEET_A1,
  SHEET_D1,
} from "../../application/test-support/workspace-harness";
import {
  type ActionsHarness,
  openedFolderActionsHarness,
} from "./test-support/actions-harness";

const state = (harness: ActionsHarness) => harness.uiStateStore.getState();

async function renameSheetOf(
  harness: ActionsHarness,
  documentId: typeof DOCUMENT_A,
  sheetId: typeof SHEET_A1,
): Promise<void> {
  const result = await harness.workspace
    .getDocumentSession(documentId)
    ?.execute(renameSheetCommand(sheetId, displayName("Dirty")));
  if (result === undefined || !result.ok) throw new Error("rename failed");
}

// Documents A (root) and D (inside Folder 2) are open; both can be made dirty.
async function openedAAndD(): Promise<ActionsHarness> {
  const harness = await openedFolderActionsHarness();
  await harness.actions.openDocument(DOCUMENT_A);
  await harness.actions.openDocument(DOCUMENT_D);
  harness.gateway.clearCalls();
  return harness;
}

const isDirty = (harness: ActionsHarness, documentId: typeof DOCUMENT_A) =>
  (harness.store.getState().documents.get(documentId)?.save.dirtySheetIds
    .size ?? 0) > 0;

describe("moving without unsaved changes", () => {
  it("moves an open document at once and keeps it open", async () => {
    const harness = await openedAAndD();
    const result = await harness.actions.moveEntryTo(DOCUMENT_D, null);
    expect(result.ok).toBe(true);
    expect(state(harness).dialog.kind).toBe("none");
    expect(harness.gateway.methods("moveEntry")).toHaveLength(1);
    expect(harness.store.getState().documents.has(DOCUMENT_D)).toBe(true);
    expect(state(harness).activeDocumentId).toBe(DOCUMENT_D);
  });

  it("does not ask when only an unrelated document has unsaved changes", async () => {
    const harness = await openedAAndD();
    await renameSheetOf(harness, DOCUMENT_A, SHEET_A1);
    await harness.actions.moveEntryTo(FOLDER_2, null);
    expect(state(harness).dialog.kind).toBe("none");
    expect(harness.gateway.methods("moveEntry")).toHaveLength(1);
    expect(isDirty(harness, DOCUMENT_A)).toBe(true);
  });
});

describe("moving with unsaved changes", () => {
  it("asks first and moves nothing yet", async () => {
    const harness = await openedAAndD();
    await renameSheetOf(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.clearCalls();
    const result = await harness.actions.moveEntryTo(FOLDER_1, null);
    expect(result.ok).toBe(true);
    expect(state(harness).dialog).toEqual({
      kind: "confirmMoveSave",
      entryId: FOLDER_1,
      name: "Folder 1",
      targetParentFolderId: null,
      beforeEntryId: null,
    });
    expect(harness.gateway.calls).toEqual([]);
  });

  it("asks for a failed earlier save too", async () => {
    const harness = await openedAAndD();
    await renameSheetOf(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.failOn("saveSheet", "ioError");
    await harness.workspace.flushDocuments([DOCUMENT_D]);
    await harness.actions.moveEntryTo(DOCUMENT_D, null);
    expect(state(harness).dialog.kind).toBe("confirmMoveSave");
  });

  it("saves only what moves, then moves; other documents stay dirty", async () => {
    const harness = await openedAAndD();
    await renameSheetOf(harness, DOCUMENT_A, SHEET_A1);
    await renameSheetOf(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.clearCalls();
    await harness.actions.moveEntryTo(FOLDER_2, null);
    const result = await harness.actions.confirmMoveSave();
    expect(result.ok).toBe(true);
    const methods = harness.gateway.methods();
    expect(methods.filter((method) => method === "saveSheet")).toHaveLength(1);
    expect(methods.indexOf("saveSheet")).toBeLessThan(
      methods.indexOf("moveEntry"),
    );
    expect(isDirty(harness, DOCUMENT_D)).toBe(false);
    expect(isDirty(harness, DOCUMENT_A)).toBe(true);
    expect(harness.store.getState().documents.has(DOCUMENT_D)).toBe(true);
    expect(state(harness).dialog.kind).toBe("none");
  });

  it("changes nothing on cancel", async () => {
    const harness = await openedAAndD();
    await renameSheetOf(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.clearCalls();
    await harness.actions.moveEntryTo(DOCUMENT_D, null);
    harness.actions.cancelDialog();
    expect(state(harness).dialog.kind).toBe("none");
    expect(harness.gateway.calls).toEqual([]);
    expect(isDirty(harness, DOCUMENT_D)).toBe(true);
  });

  it("does not move when saving fails, keeps the error visible and closes the dialog", async () => {
    const harness = await openedAAndD();
    await renameSheetOf(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.clearCalls();
    harness.gateway.failAlways("saveSheet", "ioError");
    await harness.actions.moveEntryTo(DOCUMENT_D, null);
    const result = await harness.actions.confirmMoveSave();
    expect(result.ok).toBe(false);
    expect(harness.gateway.methods("moveEntry")).toEqual([]);
    expect(state(harness).dialog.kind).toBe("none");
    expect(
      harness.store.getState().documents.get(DOCUMENT_D)?.save.lastError?.kind,
    ).toBe("ioError");
  });

  it("commits a Markdown draft of the moved document first, and only of that document", async () => {
    const harness = await openedAAndD();
    const committed: string[] = [];
    let pending = true;
    harness.draftRegistry.register({
      documentId: DOCUMENT_D,
      hasPendingDraft: () => pending,
      discardDraft: () => undefined,
      async commitDraft() {
        committed.push("D");
        pending = false;
        await renameSheetOf(harness, DOCUMENT_D, SHEET_D1);
        return operationOk(undefined);
      },
    });
    harness.draftRegistry.register({
      documentId: DOCUMENT_A,
      hasPendingDraft: () => true,
      discardDraft: () => undefined,
      async commitDraft() {
        committed.push("A");
        return operationOk(undefined);
      },
    });
    harness.gateway.clearCalls();
    await harness.actions.moveEntryTo(FOLDER_2, null);
    expect(state(harness).dialog.kind).toBe("confirmMoveSave");
    await harness.actions.confirmMoveSave();
    expect(committed).toEqual(["D"]);
    const methods = harness.gateway.methods();
    expect(methods.indexOf("saveSheet")).toBeLessThan(
      methods.indexOf("moveEntry"),
    );
    expect(isDirty(harness, DOCUMENT_D)).toBe(false);
  });

  it("does not save or move when a draft cannot be committed", async () => {
    const harness = await openedAAndD();
    harness.draftRegistry.register({
      documentId: DOCUMENT_D,
      hasPendingDraft: () => true,
      discardDraft: () => undefined,
      commitDraft: async () => operationErr("notWritable", "draft failed"),
    });
    harness.gateway.clearCalls();
    await harness.actions.moveEntryTo(DOCUMENT_D, null);
    const result = await harness.actions.confirmMoveSave();
    expect(result.ok).toBe(false);
    expect(harness.gateway.calls).toEqual([]);
    expect(state(harness).dialog.kind).toBe("none");
  });

  it("does nothing when confirmed without the dialog", async () => {
    const harness = await openedAAndD();
    expect((await harness.actions.confirmMoveSave()).ok).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
  });
});

describe("creating a folder from the move picker", () => {
  it("creates it inside the target, keeps the dialog open and returns the id", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.requestMoveEntry(DOCUMENT_A);
    const result = await harness.actions.createFolderForMove(FOLDER_2, "Inner");
    expect(result.ok).toBe(true);
    expect(state(harness).dialog.kind).toBe("moveEntry");
    expect(state(harness).busy).toBe(false);
    if (!result.ok) return;
    const created = harness.store
      .getState()
      .project?.folders.find((entry) => entry.folderId === result.value);
    expect(created?.parentFolderId).toBe(FOLDER_2);
    expect(harness.gateway.methods()).toEqual(["createFolder", "saveFolder"]);
    // The folder is still there after the picker is cancelled.
    harness.actions.cancelDialog();
    expect(
      harness.store
        .getState()
        .project?.folders.some((entry) => entry.folderId === result.value),
    ).toBe(true);
  });

  it("records a failure and keeps the dialog open", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.requestMoveEntry(DOCUMENT_A);
    harness.gateway.failOn("createFolder", "ioError");
    const result = await harness.actions.createFolderForMove(null, "Nope");
    expect(result.ok).toBe(false);
    expect(state(harness).dialog.kind).toBe("moveEntry");
    expect(state(harness).operationErrors).toMatchObject([
      { operation: "createFolder", error: { kind: "ioError" } },
    ]);
  });
});
