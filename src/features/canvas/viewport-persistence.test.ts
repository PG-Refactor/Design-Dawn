import { describe, expect, it } from "vitest";
import { moveBlocksCommand } from "../../application/commands/block-commands";
import { viewportKey } from "../../application/test-support/fake-viewport";
import {
  PROJECT_ID,
  position,
  settle,
} from "../../application/test-support/fakes";
import {
  CONFIRMED,
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
  SHEET_A2,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import type { SheetId } from "../../domain/shared/entity-id";
import { setViewport } from "../workspace/ui-state/ui-state";
import { clampViewport, DEFAULT_VIEWPORT } from "./geometry/viewport-math";
import {
  BLOCK_ONE,
  type CanvasHarness,
  createCanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

const SAVED = clampViewport({ panX: 120, panY: -45.5, zoom: 2 });

function pan(harness: CanvasHarness, sheetId: SheetId, panX: number): void {
  harness.uiStateStore.setState((state) =>
    setViewport(state, sheetId, clampViewport({ panX, panY: 0, zoom: 1 })),
  );
}

function shown(harness: CanvasHarness, sheetId: SheetId) {
  return harness.uiStateStore.getState().viewportBySheet.get(sheetId);
}

// The canvas harness saves an identity view for the sheets of document A; these tests are
// about sheets without a saved view.
async function openedWithoutSavedViews(): Promise<CanvasHarness> {
  const harness = createCanvasHarness();
  harness.viewportGateway.storage.clear();
  await harness.actions.openProjectViaDialog();
  await harness.actions.openDocument(DOCUMENT_A);
  return harness;
}

async function openedWithSaved(): Promise<CanvasHarness> {
  const harness = createCanvasHarness();
  harness.viewportGateway.storage.set(
    viewportKey(PROJECT_ID, DOCUMENT_A, SHEET_A1),
    SAVED,
  );
  await harness.actions.openProjectViaDialog();
  await harness.actions.openDocument(DOCUMENT_A);
  await settle();
  return harness;
}

describe("restoring", () => {
  it("uses the saved viewport when the sheet becomes visible and does not save it back", async () => {
    const harness = await openedWithSaved();
    expect(shown(harness, SHEET_A1)).toEqual(SAVED);
    await harness.viewportPersistence.flush();
    expect(harness.viewportGateway.saveCalls).toEqual([]);
  });

  it("falls back to the default when nothing is saved", async () => {
    const harness = await openedWithoutSavedViews();
    await settle();
    expect(shown(harness, SHEET_A1)).toEqual(DEFAULT_VIEWPORT);
    expect(harness.viewportGateway.saveCalls).toEqual([]);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("loads once per sheet, not on every state change", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    pan(harness, SHEET_A1, 5);
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
    await settle();
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A1);
    await settle();
    expect(
      harness.viewportGateway.getCalls.map((call) => call.sheetId),
    ).toEqual([SHEET_A1, SHEET_A2]);
  });

  it("uses the default and records the error when loading fails, without blocking", async () => {
    const harness = createCanvasHarness();
    harness.viewportGateway.failGet = { kind: "ioError", detail: "disk" };
    await harness.actions.openProjectViaDialog();
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(shown(harness, SHEET_A1)).toEqual(DEFAULT_VIEWPORT);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "loadViewport", error: { kind: "ioError" } },
    ]);
  });

  it("records a load issue (damaged file) and still shows the default", async () => {
    const harness = createCanvasHarness();
    harness.viewportGateway.storage.clear();
    harness.viewportGateway.loadIssue = { kind: "invalidJson", detail: "x" };
    await harness.actions.openProjectViaDialog();
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(shown(harness, SHEET_A1)).toEqual(DEFAULT_VIEWPORT);
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "loadViewport", error: { kind: "invalidJson" } },
    ]);
  });

  it("keeps a viewport the user changed while the load was still running", async () => {
    const harness = createCanvasHarness();
    const release = harness.viewportGateway.holdNextGet();
    await harness.actions.openProjectViaDialog();
    await harness.actions.openDocument(DOCUMENT_A);
    pan(harness, SHEET_A1, 77);
    release();
    await settle();
    expect(shown(harness, SHEET_A1)?.panX).toBe(77);
  });

  it("restores the saved value after the document was closed and opened again", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    pan(harness, SHEET_A1, 321);
    // Saved explicitly (Ctrl+S); a view that was never saved would be dropped on close.
    await harness.viewportPersistence.flush();
    await harness.actions.closeDocument(DOCUMENT_A);
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(shown(harness, SHEET_A1)?.panX).toBe(321);
  });
});

describe("saving", () => {
  // A content change of document A that the session then saves.
  async function editAndSaveDocumentA(harness: CanvasHarness): Promise<void> {
    await harness.session.execute(
      moveBlocksCommand(SHEET_A1, [
        { blockId: BLOCK_ONE, position: position(48, 48) },
      ]),
    );
    await harness.session.flush();
    await settle();
  }

  it("keeps a change unsaved: nothing is written by panning or switching sheets", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    for (let step = 1; step <= 20; step += 1) pan(harness, SHEET_A1, step);
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
    await settle();
    expect(harness.viewportGateway.saveCalls).toEqual([]);
  });

  it("saves the views of a Document, latest value only, when a save of it completes", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    for (let step = 1; step <= 20; step += 1) pan(harness, SHEET_A1, step);
    await editAndSaveDocumentA(harness);
    expect(harness.viewportGateway.saveCalls).toHaveLength(1);
    expect(harness.viewportGateway.saveCalls[0]).toMatchObject({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      viewport: { panX: 20 },
    });
  });

  it("does not save the views of another Document with it", async () => {
    const harness = await openedCanvasHarness();
    await harness.actions.openDocument(DOCUMENT_B);
    await settle();
    pan(harness, SHEET_B1, 7);
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    await editAndSaveDocumentA(harness);
    expect(harness.viewportGateway.saveCalls).toEqual([]);
  });

  it("saves every view on an explicit save, even with no content to save", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    pan(harness, SHEET_A1, 30);
    await harness.viewportPersistence.flush();
    expect(harness.viewportGateway.saveCalls).toMatchObject([
      { sheetId: SHEET_A1, viewport: { panX: 30 } },
    ]);
    // Saved once: a second explicit save has nothing new.
    await harness.viewportPersistence.flush();
    expect(harness.viewportGateway.saveCalls).toHaveLength(1);
  });

  it("drops an unsaved view when the Document closes without a save, so it opens as saved last", async () => {
    const harness = await openedWithSaved();
    pan(harness, SHEET_A1, 41);
    await harness.actions.closeDocument(DOCUMENT_A);
    await settle();
    expect(harness.viewportGateway.saveCalls).toEqual([]);
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(shown(harness, SHEET_A1)).toEqual(SAVED);
  });

  it("keeps sheets and documents independent", async () => {
    const harness = await openedWithoutSavedViews();
    await harness.actions.openDocument(DOCUMENT_B);
    await settle();
    pan(harness, SHEET_B1, 9);
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    pan(harness, SHEET_A2, 8);
    await harness.viewportPersistence.flush();
    const saved = harness.viewportGateway.saveCalls.map((call) => [
      call.documentId,
      call.sheetId,
      call.viewport.panX,
    ]);
    expect(saved).toContainEqual([DOCUMENT_B, SHEET_B1, 9]);
    expect(saved).toContainEqual([DOCUMENT_A, SHEET_A2, 8]);
    expect(saved).toHaveLength(2);
    expect(shown(harness, SHEET_A1)).toEqual(DEFAULT_VIEWPORT);
  });

  it("records a failed save", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    harness.viewportGateway.failSave = { kind: "ioError", detail: "disk" };
    pan(harness, SHEET_A1, 3);
    await harness.viewportPersistence.flush();
    expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
      { operation: "saveViewport", error: { kind: "ioError" } },
    ]);
  });

  it("does not save the viewport of a sheet that was deleted", async () => {
    const harness = await openedCanvasHarness();
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
    await settle();
    pan(harness, SHEET_A2, 11);
    await harness.workspace.deleteSheet(DOCUMENT_A, SHEET_A2, CONFIRMED);
    await harness.viewportPersistence.flush();
    expect(harness.viewportGateway.saveCalls).toEqual([]);
  });

  it("stops watching after dispose and forgets what was unsaved", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    pan(harness, SHEET_A1, 4);
    harness.viewportPersistence.dispose();
    pan(harness, SHEET_A1, 5);
    await harness.viewportPersistence.flush();
    expect(harness.viewportGateway.saveCalls).toEqual([]);
  });
});
