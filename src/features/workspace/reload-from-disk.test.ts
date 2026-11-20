import { describe, expect, it } from "vitest";
import { parseViewport } from "../../application/local-state/viewport";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import {
  reloadDocumentFromDisk,
  reloadProjectFromDisk,
} from "./reload-from-disk";
import { openedActionsHarness } from "./test-support/actions-harness";
import { setViewport } from "./ui-state/ui-state";

const parsed = parseViewport({ panX: -120, panY: 340, zoom: 0.67 });
if (!parsed.ok) throw new Error("a valid viewport");
const ZOOMED_OUT = parsed.value;

async function twoDocuments() {
  const harness = await openedActionsHarness();
  await harness.actions.openDocument(DOCUMENT_A);
  await harness.actions.openDocument(DOCUMENT_B);
  await harness.actions.selectSheet(DOCUMENT_A, SHEET_A2);
  await harness.actions.openDocument(DOCUMENT_B);
  harness.gateway.clearCalls();
  return harness;
}

const openOrder = (harness: Awaited<ReturnType<typeof twoDocuments>>) => [
  ...harness.store.getState().documents.keys(),
];

describe("reloadDocumentFromDisk", () => {
  it("reads one Document again and keeps its sheet, its tab position and the active tab", async () => {
    const harness = await twoDocuments();

    const result = await reloadDocumentFromDisk(harness.services, DOCUMENT_A);
    await settle();

    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("loadDocument")).toHaveLength(1);
    expect(openOrder(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(
      harness.uiStateStore.getState().activeSheetIdByDocument.get(DOCUMENT_A),
    ).toBe(SHEET_A2);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_B);
  });

  it("keeps the zoom and position of the Document's sheets", async () => {
    const harness = await twoDocuments();
    harness.uiStateStore.setState((state) =>
      setViewport(state, SHEET_A2, ZOOMED_OUT),
    );

    await reloadDocumentFromDisk(harness.services, DOCUMENT_A);
    await settle();

    expect(
      harness.uiStateStore.getState().viewportBySheet.get(SHEET_A2),
    ).toEqual(ZOOMED_OUT);
  });

  it("writes nothing: the in-memory state is dropped, not saved", async () => {
    const harness = await twoDocuments();
    await reloadDocumentFromDisk(harness.services, DOCUMENT_A);
    expect(
      harness.gateway.methods("saveSheet", "saveDocument", "writeBlockContent"),
    ).toEqual([]);
  });

  it("is a quiet success for a Document that is not open", async () => {
    const harness = await openedActionsHarness();
    const result = await reloadDocumentFromDisk(harness.services, DOCUMENT_A);
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("loadDocument")).toEqual([]);
  });

  it("reports a Document that cannot be opened again and leaves it closed", async () => {
    const harness = await twoDocuments();
    harness.gateway.failOn("loadDocument", "invalidJson");
    const result = await reloadDocumentFromDisk(harness.services, DOCUMENT_A);
    expect(result.ok).toBe(false);
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(false);
    expect(
      harness.uiStateStore.getState().operationErrors.length,
    ).toBeGreaterThan(0);
  });
});

describe("reloadProjectFromDisk", () => {
  it("keeps the zoom and position of the open sheets", async () => {
    const harness = await twoDocuments();
    harness.uiStateStore.setState((state) =>
      setViewport(state, SHEET_A2, ZOOMED_OUT),
    );

    await reloadProjectFromDisk(harness.services);
    await settle();

    expect(
      harness.uiStateStore.getState().viewportBySheet.get(SHEET_A2),
    ).toEqual(ZOOMED_OUT);
  });

  it("reads the Project and every Document again and restores the tabs", async () => {
    const harness = await twoDocuments();

    const result = await reloadProjectFromDisk(harness.services);
    await settle();

    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("reloadProject")).toHaveLength(1);
    expect(openOrder(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_B);
    expect(
      harness.uiStateStore.getState().activeSheetIdByDocument.get(DOCUMENT_A),
    ).toBe(SHEET_A2);
  });
});
