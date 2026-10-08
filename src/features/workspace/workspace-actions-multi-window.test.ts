import { describe, expect, it } from "vitest";
import { OPEN_IN_NEW_WINDOW_STATUS } from "../../application/ports/persistence-types";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SELECTION_ID,
} from "../../application/test-support/workspace-harness";
import {
  createActionsHarness,
  openedActionsHarness,
} from "./test-support/actions-harness";

describe("opening a Project in a new window", () => {
  it("selects a folder, opens its Project in a new window and leaves this window alone", async () => {
    const harness = await openedActionsHarness();

    const result = await harness.actions.openProjectInNewWindowViaDialog();

    expect(result.ok).toBe(true);
    expect(harness.gateway.methods()).toEqual([
      "selectProjectFolder",
      "openProjectInNewWindow",
    ]);
    // This window's own Project and notices are untouched.
    expect(harness.store.getState().project).not.toBeNull();
    expect(harness.uiStateStore.getState().notice).toBeNull();
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("does nothing when the folder dialog is cancelled", async () => {
    const harness = createActionsHarness();
    harness.gateway.selectNext({ status: "cancelled" });

    const result = await harness.actions.openProjectInNewWindowViaDialog();

    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("openProjectInNewWindow")).toEqual([]);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("says the Project is open in another window when Rust focused that window", async () => {
    const harness = createActionsHarness();
    harness.gateway.setOpenInNewWindowResult({
      status: OPEN_IN_NEW_WINDOW_STATUS.focusedExisting,
      inThisWindow: false,
    });

    await harness.actions.openProjectInNewWindowViaDialog();

    expect(harness.uiStateStore.getState().notice?.kind).toBe(
      "projectOpenInOtherWindow",
    );
  });

  it("says the Project is open here when this window has it", async () => {
    const harness = createActionsHarness();
    harness.gateway.setOpenInNewWindowResult({
      status: OPEN_IN_NEW_WINDOW_STATUS.focusedExisting,
      inThisWindow: true,
    });

    await harness.actions.openProjectInNewWindowViaDialog();

    expect(harness.uiStateStore.getState().notice?.kind).toBe(
      "projectOpenInThisWindow",
    );
  });

  it("records a failure of the command as an operation error", async () => {
    const harness = createActionsHarness();
    harness.gateway.failOn("openProjectInNewWindow", "fileNotFound");

    const result = await harness.actions.openProjectInNewWindowViaDialog();

    expect(result.ok).toBe(false);
    const [error] = harness.uiStateStore.getState().operationErrors;
    expect(error).toMatchObject({ operation: "openProject" });
    expect(harness.uiStateStore.getState().notice).toBeNull();
  });

  it("uses the selection it was given", async () => {
    const harness = createActionsHarness();
    await harness.actions.openProjectInNewWindowViaDialog();
    const call = harness.gateway.calls.find(
      (entry) => entry.method === "openProjectInNewWindow",
    );
    expect(call?.detail).toBe(SELECTION_ID);
  });
});

describe("a Project folder launch request", () => {
  it("installs the project and opens no document", async () => {
    const harness = createActionsHarness();
    harness.gateway.queueProjectFolderRequest();

    const result = await harness.actions.openLaunchRequest();

    expect(result.ok).toBe(true);
    expect(harness.store.getState().project).not.toBeNull();
    expect(harness.store.getState().documents.size).toBe(0);
    expect(harness.uiStateStore.getState().activeDocumentId).toBeNull();
  });
});

describe("an openDocument request", () => {
  it("opens and activates a document that is not open yet", async () => {
    const harness = await openedActionsHarness();

    const result = await harness.actions.openDocumentFromRequest(DOCUMENT_B);

    expect(result.ok).toBe(true);
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(true);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_B);
    expect(harness.uiStateStore.getState().notice).toBeNull();
  });

  it("activates the tab of an open document and shows a light notice", async () => {
    const harness = await openedActionsHarness();
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.openDocument(DOCUMENT_B);
    harness.gateway.clearCalls();

    const result = await harness.actions.openDocumentFromRequest(DOCUMENT_A);

    expect(result.ok).toBe(true);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_A);
    expect(harness.uiStateStore.getState().notice?.kind).toBe(
      "documentAlreadyOpen",
    );
    // Not loaded again.
    expect(harness.gateway.methods("loadDocument")).toEqual([]);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("reports a document that cannot be opened as an operation error", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.failOn("loadDocument", "ioError");

    const result = await harness.actions.openDocumentFromRequest(DOCUMENT_B);

    expect(result.ok).toBe(false);
    expect(harness.uiStateStore.getState().operationErrors).toHaveLength(1);
  });
});
