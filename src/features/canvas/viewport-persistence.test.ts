import { describe, expect, it } from "vitest";
import { viewportKey } from "../../application/test-support/fake-viewport";
import { PROJECT_ID, settle } from "../../application/test-support/fakes";
import {
  CONFIRMED,
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
  SHEET_A2,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import type { SheetId } from "../../domain/shared/entity-id";
import { setViewport } from "../workspace/ui-state/ui-state";
import { clampViewport, DEFAULT_VIEWPORT } from "./geometry/viewport-math";
import {
  type CanvasHarness,
  createCanvasHarness,
  openedCanvasHarness,
} from "./test-support/canvas-harness";

const SAVED = clampViewport({ panX: 120, panY: -45.5, zoom: 2 });
const { saveDelayMs } = CANVAS_CONFIG.viewport;

function pan(harness: CanvasHarness, sheetId: SheetId, panX: number): void {
  harness.uiStateStore.setState((state) =>
    setViewport(state, sheetId, clampViewport({ panX, panY: 0, zoom: 1 })),
  );
}

function shown(harness: CanvasHarness, sheetId: SheetId) {
  return harness.uiStateStore.getState().viewportBySheet.get(sheetId);
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
    harness.viewportScheduler.advance(saveDelayMs * 2);
    await harness.viewportPersistence.flush();
    expect(harness.viewportGateway.saveCalls).toEqual([]);
  });

  it("falls back to the default when nothing is saved", async () => {
    const harness = await openedCanvasHarness();
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
    await harness.actions.closeDocument(DOCUMENT_A);
    await harness.viewportPersistence.flush();
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(shown(harness, SHEET_A1)?.panX).toBe(321);
  });
});

describe("saving", () => {
  it("saves once, with the latest value, after the quiet period", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    for (let step = 1; step <= 20; step += 1) pan(harness, SHEET_A1, step);
    expect(harness.viewportGateway.saveCalls).toEqual([]);

    harness.viewportScheduler.advance(saveDelayMs);
    await settle();
    expect(harness.viewportGateway.saveCalls).toHaveLength(1);
    expect(harness.viewportGateway.saveCalls[0]?.viewport.panX).toBe(20);
  });

  it("waits for the delay and restarts it on every change", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    pan(harness, SHEET_A1, 1);
    harness.viewportScheduler.advance(saveDelayMs - 1);
    pan(harness, SHEET_A1, 2);
    harness.viewportScheduler.advance(saveDelayMs - 1);
    await settle();
    expect(harness.viewportGateway.saveCalls).toEqual([]);

    harness.viewportScheduler.advance(1);
    await settle();
    expect(harness.viewportGateway.saveCalls).toHaveLength(1);
    expect(harness.viewportGateway.saveCalls[0]).toMatchObject({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_A,
      sheetId: SHEET_A1,
      viewport: { panX: 2 },
    });
    expect(harness.viewportScheduler.pendingCount()).toBe(0);
  });

  it("flushes the pending save when the sheet is switched", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    pan(harness, SHEET_A1, 40);
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
    await settle();
    expect(harness.viewportGateway.saveCalls).toMatchObject([
      { sheetId: SHEET_A1, viewport: { panX: 40 } },
    ]);
    expect(harness.viewportScheduler.pendingCount()).toBe(0);
  });

  it("flushes the pending save when the document is closed", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    pan(harness, SHEET_A1, 41);
    await harness.actions.closeDocument(DOCUMENT_A);
    await settle();
    expect(harness.viewportGateway.saveCalls).toMatchObject([
      { documentId: DOCUMENT_A, sheetId: SHEET_A1, viewport: { panX: 41 } },
    ]);
  });

  it("keeps sheets and documents independent", async () => {
    const harness = await openedCanvasHarness();
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

  it("stops watching after dispose", async () => {
    const harness = await openedCanvasHarness();
    await settle();
    harness.viewportPersistence.dispose();
    pan(harness, SHEET_A1, 5);
    harness.viewportScheduler.advance(saveDelayMs * 2);
    await settle();
    expect(harness.viewportGateway.saveCalls).toEqual([]);
  });
});
