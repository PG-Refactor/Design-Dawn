import { describe, expect, it } from "vitest";
import { PROJECT_ID, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import { createActiveSheetMemory } from "./active-sheet-memory";
import { createCanvasHarness } from "./test-support/canvas-harness";

async function harnessWithMemory() {
  const harness = createCanvasHarness();
  createActiveSheetMemory({
    gateway: harness.viewportGateway,
    applicationStore: harness.store,
    uiStateStore: harness.uiStateStore,
  });
  await harness.actions.openProjectViaDialog();
  return harness;
}

const activeSheet = (harness: Awaited<ReturnType<typeof harnessWithMemory>>) =>
  harness.uiStateStore.getState().activeSheetIdByDocument.get(DOCUMENT_A);

describe("the remembered active sheet", () => {
  it("opens on the first sheet and saves nothing when nothing is remembered", async () => {
    const harness = await harnessWithMemory();
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(activeSheet(harness)).toBe(SHEET_A1);
    expect(harness.viewportGateway.activeSheets.size).toBe(0);
  });

  it("remembers the sheet chosen and opens on it the next time", async () => {
    const harness = await harnessWithMemory();
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
    await settle();
    expect(
      harness.viewportGateway.activeSheets.get(`${PROJECT_ID}/${DOCUMENT_A}`),
    ).toBe(SHEET_A2);
    await harness.actions.closeDocument(DOCUMENT_A);
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(activeSheet(harness)).toBe(SHEET_A2);
  });

  it("ignores a remembered sheet the Document no longer has", async () => {
    const harness = await harnessWithMemory();
    harness.viewportGateway.activeSheets.set(
      `${PROJECT_ID}/${DOCUMENT_A}`,
      "01928f3a-7d8e-7f90-b123-456789abcd99" as typeof SHEET_A1,
    );
    await harness.actions.openDocument(DOCUMENT_A);
    await settle();
    expect(activeSheet(harness)).toBe(SHEET_A1);
  });
});
