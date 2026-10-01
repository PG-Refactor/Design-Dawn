import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID } from "../../application/test-support/fakes";
import { DOCUMENT_ID, SHEET_ID } from "../../domain/shared/test-fixtures";
import { clampViewport } from "../../features/canvas/geometry/viewport-math";
import { createTauriViewportGateway } from "./tauri-viewport-gateway";

const client = vi.hoisted(() => ({
  getSheetViewport: vi.fn(),
  saveSheetViewport: vi.fn(),
}));
vi.mock("./local-state-client", () => client);

beforeEach(() => {
  client.getSheetViewport.mockReset();
  client.saveSheetViewport.mockReset();
});

describe("createTauriViewportGateway", () => {
  it("passes the load result through unchanged", async () => {
    const viewport = clampViewport({ panX: 1, panY: 2, zoom: 3 });
    client.getSheetViewport.mockResolvedValue({
      ok: true,
      value: { viewport, loadIssue: null },
    });
    const result = await createTauriViewportGateway().getSheetViewport(
      PROJECT_ID,
      DOCUMENT_ID,
      SHEET_ID,
    );
    expect(result).toEqual({ ok: true, value: { viewport, loadIssue: null } });
    expect(client.getSheetViewport).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      SHEET_ID,
    );
  });

  it("turns the null payload of a save into void and keeps errors", async () => {
    const viewport = clampViewport({ panX: 1, panY: 2, zoom: 3 });
    const gateway = createTauriViewportGateway();
    client.saveSheetViewport.mockResolvedValueOnce({ ok: true, value: null });
    expect(
      await gateway.saveSheetViewport(
        PROJECT_ID,
        DOCUMENT_ID,
        SHEET_ID,
        viewport,
      ),
    ).toEqual({ ok: true, value: undefined });
    client.saveSheetViewport.mockResolvedValueOnce({
      ok: false,
      error: { kind: "ioError", detail: "disk" },
    });
    expect(
      await gateway.saveSheetViewport(
        PROJECT_ID,
        DOCUMENT_ID,
        SHEET_ID,
        viewport,
      ),
    ).toEqual({ ok: false, error: { kind: "ioError", detail: "disk" } });
  });
});
