import { describe, expect, it } from "vitest";
import { operationOk } from "../../application/ports/operation-error";
import {
  DOCUMENT_A,
  DOCUMENT_B,
} from "../../application/test-support/workspace-harness";
import {
  type ActionsHarness,
  makeDocumentADirty,
  openedActionsHarness,
} from "./test-support/actions-harness";

const WRITE_METHODS = ["saveProject", "saveDocument", "saveSheet"] as const;

async function dirtyHarness(autoSave: boolean): Promise<ActionsHarness> {
  const harness = await openedActionsHarness();
  if (!autoSave) await harness.autoSaveController.setEnabled(false);
  await harness.actions.openDocument(DOCUMENT_A);
  await harness.actions.openDocument(DOCUMENT_B);
  await makeDocumentADirty(harness);
  harness.gateway.clearCalls();
  return harness;
}

function dialog(harness: ActionsHarness) {
  return harness.uiStateStore.getState().dialog;
}

interface SpyDraft {
  readonly committed: () => number;
  readonly discarded: () => boolean;
}

function registerDraft(
  harness: ActionsHarness,
  documentId: typeof DOCUMENT_A,
): SpyDraft {
  let commits = 0;
  let discarded = false;
  harness.draftRegistry.register({
    documentId,
    hasPendingDraft: () => !discarded,
    async commitDraft() {
      if (!discarded) commits += 1;
      return operationOk(undefined);
    },
    discardDraft: () => {
      discarded = true;
    },
  });
  return { committed: () => commits, discarded: () => discarded };
}

describe("closing a document with auto-save off", () => {
  it("asks first when the document has unsaved changes and closes nothing", async () => {
    const harness = await dirtyHarness(false);
    await harness.actions.closeDocument(DOCUMENT_A);
    expect(dialog(harness)).toMatchObject({
      kind: "confirmUnsavedClose",
      target: { kind: "document", documentId: DOCUMENT_A },
    });
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("closes a clean document without asking", async () => {
    const harness = await dirtyHarness(false);
    await harness.actions.closeDocument(DOCUMENT_B);
    expect(dialog(harness).kind).toBe("none");
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(false);
  });

  it("with auto-save on saves and closes without asking", async () => {
    const harness = await dirtyHarness(true);
    await harness.actions.closeDocument(DOCUMENT_A);
    expect(dialog(harness).kind).toBe("none");
    expect(harness.gateway.methods(...WRITE_METHODS).length).toBeGreaterThan(0);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(false);
  });

  it("saves, then closes, on 保存", async () => {
    const harness = await dirtyHarness(false);
    const draft = registerDraft(harness, DOCUMENT_A);
    await harness.actions.closeDocument(DOCUMENT_A);
    const result = await harness.actions.answerUnsavedClose("save");
    expect(result.ok).toBe(true);
    expect(draft.committed()).toBe(1);
    expect(harness.gateway.methods(...WRITE_METHODS).length).toBeGreaterThan(0);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(false);
    expect(dialog(harness).kind).toBe("none");
  });

  it("keeps the document open and shows the error when 保存 fails", async () => {
    const harness = await dirtyHarness(false);
    harness.gateway.failOn("saveSheet", "ioError");
    harness.gateway.failOn("saveDocument", "ioError");
    await harness.actions.closeDocument(DOCUMENT_A);
    const result = await harness.actions.answerUnsavedClose("save");
    expect(result.ok).toBe(false);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(
      harness.uiStateStore.getState().operationErrors.length,
    ).toBeGreaterThan(0);
  });

  it("closes without any write, drops the draft and still notifies the gateway on 保存せずに閉じる", async () => {
    const harness = await dirtyHarness(false);
    const draft = registerDraft(harness, DOCUMENT_A);
    const other = registerDraft(harness, DOCUMENT_B);
    await harness.actions.closeDocument(DOCUMENT_A);
    const result = await harness.actions.answerUnsavedClose("discard");
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(harness.gateway.methods("closeDocument")).toHaveLength(1);
    expect(draft.discarded()).toBe(true);
    expect(draft.committed()).toBe(0);
    expect(other.discarded()).toBe(false);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(false);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_B);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("does nothing on キャンセル", async () => {
    const harness = await dirtyHarness(false);
    await harness.actions.closeDocument(DOCUMENT_A);
    harness.actions.cancelDialog();
    expect(dialog(harness).kind).toBe("none");
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
    await harness.actions.closeDocument(DOCUMENT_A);
    expect(dialog(harness).kind).toBe("confirmUnsavedClose");
  });
});

describe("closing the project with auto-save off", () => {
  it("asks first and closes nothing", async () => {
    const harness = await dirtyHarness(false);
    await harness.actions.closeProject();
    expect(dialog(harness)).toMatchObject({
      kind: "confirmUnsavedClose",
      target: { kind: "project" },
    });
    expect(harness.store.getState().project).not.toBeNull();
    expect(harness.gateway.calls).toEqual([]);
  });

  it("closes a clean project without asking", async () => {
    const harness = await openedActionsHarness();
    await harness.autoSaveController.setEnabled(false);
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.closeProject();
    expect(dialog(harness).kind).toBe("none");
    expect(harness.store.getState().project).toBeNull();
  });

  it("asks when only a Markdown draft is pending", async () => {
    const harness = await openedActionsHarness();
    await harness.autoSaveController.setEnabled(false);
    await harness.actions.openDocument(DOCUMENT_A);
    registerDraft(harness, DOCUMENT_A);
    await harness.actions.closeProject();
    expect(dialog(harness).kind).toBe("confirmUnsavedClose");
  });

  it("with auto-save on saves and closes without asking", async () => {
    const harness = await dirtyHarness(true);
    await harness.actions.closeProject();
    expect(dialog(harness).kind).toBe("none");
    expect(harness.gateway.methods(...WRITE_METHODS).length).toBeGreaterThan(0);
    expect(harness.store.getState().project).toBeNull();
  });

  it("saves, then closes, on 保存; a failure keeps the project open", async () => {
    const harness = await dirtyHarness(false);
    harness.gateway.failOn("saveSheet", "ioError");
    harness.gateway.failOn("saveDocument", "ioError");
    await harness.actions.closeProject();
    expect((await harness.actions.answerUnsavedClose("save")).ok).toBe(false);
    expect(harness.store.getState().project).not.toBeNull();
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);

    harness.gateway.clearFailures();
    await harness.actions.closeProject();
    expect((await harness.actions.answerUnsavedClose("save")).ok).toBe(true);
    expect(harness.store.getState().project).toBeNull();
  });

  it("closes without any write on 保存せずに閉じる", async () => {
    const harness = await dirtyHarness(false);
    const draft = registerDraft(harness, DOCUMENT_A);
    await harness.actions.closeProject();
    const result = await harness.actions.answerUnsavedClose("discard");
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(harness.gateway.methods("closeDocument")).toHaveLength(2);
    expect(draft.committed()).toBe(0);
    expect(harness.store.getState().project).toBeNull();
    expect(harness.store.getState().documents.size).toBe(0);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });
});

describe("opening another project with auto-save off", () => {
  it("asks before showing the folder dialog", async () => {
    const harness = await dirtyHarness(false);
    await harness.actions.openProjectViaDialog();
    expect(dialog(harness)).toMatchObject({
      kind: "confirmUnsavedClose",
      target: { kind: "openProject" },
    });
    expect(harness.gateway.calls).toEqual([]);
  });

  it("opens without saving on 保存せずに閉じる", async () => {
    const harness = await dirtyHarness(false);
    await harness.actions.openProjectViaDialog();
    await harness.actions.answerUnsavedClose("discard");
    expect(harness.gateway.methods("selectProjectFolder")).toHaveLength(1);
    expect(harness.gateway.methods("openProject")).toHaveLength(1);
    expect(harness.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(harness.store.getState().documents.size).toBe(0);
    expect(dialog(harness).kind).toBe("none");
  });

  it("keeps the unsaved document when the folder dialog is cancelled after 保存せずに閉じる", async () => {
    const harness = await dirtyHarness(false);
    await harness.actions.openProjectViaDialog();
    harness.gateway.selectNext({ status: "cancelled" });
    await harness.actions.answerUnsavedClose("discard");
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
  });

  it("creating a project asks as well, and saves on 保存", async () => {
    const harness = await dirtyHarness(false);
    harness.actions.requestCreateProject();
    await harness.actions.createProjectViaDialog("Other");
    expect(dialog(harness)).toMatchObject({
      kind: "confirmUnsavedClose",
      target: { kind: "createProject", name: "Other" },
    });
    await harness.actions.answerUnsavedClose("save");
    expect(harness.gateway.methods(...WRITE_METHODS).length).toBeGreaterThan(0);
    expect(harness.gateway.methods("createProject")).toHaveLength(1);
  });
});

describe("closing the window with auto-save off", () => {
  it("needs a confirmation only when auto-save is off and something is unsaved", async () => {
    const off = await dirtyHarness(false);
    expect(off.actions.windowCloseNeedsConfirmation()).toBe(true);
    const on = await dirtyHarness(true);
    expect(on.actions.windowCloseNeedsConfirmation()).toBe(false);
    const clean = await openedActionsHarness();
    await clean.autoSaveController.setEnabled(false);
    await clean.actions.openDocument(DOCUMENT_A);
    expect(clean.actions.windowCloseNeedsConfirmation()).toBe(false);
  });

  it("counts a pending Markdown draft as unsaved", async () => {
    const harness = await openedActionsHarness();
    await harness.autoSaveController.setEnabled(false);
    await harness.actions.openDocument(DOCUMENT_A);
    registerDraft(harness, DOCUMENT_A);
    expect(harness.actions.windowCloseNeedsConfirmation()).toBe(true);
  });

  it("delivers the answer of the dialog to the pending request", async () => {
    const harness = await dirtyHarness(false);
    const answer = harness.actions.askUnsavedWindowClose();
    expect(dialog(harness)).toMatchObject({
      kind: "confirmUnsavedClose",
      target: { kind: "window" },
    });
    await harness.actions.answerUnsavedClose("discard");
    expect(await answer).toBe("discard");
    expect(dialog(harness).kind).toBe("none");
    expect(harness.gateway.calls).toEqual([]);
  });

  it("resolves to cancel when the dialog is cancelled, and can ask again", async () => {
    const harness = await dirtyHarness(false);
    const first = harness.actions.askUnsavedWindowClose();
    harness.actions.cancelDialog();
    expect(await first).toBe("cancel");
    const second = harness.actions.askUnsavedWindowClose();
    await harness.actions.answerUnsavedClose("save");
    expect(await second).toBe("save");
  });
});
