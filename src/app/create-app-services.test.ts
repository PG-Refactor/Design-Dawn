import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../infrastructure/tauri/command-constants";
import { createAppServices } from "./create-app-services";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("createAppServices", () => {
  it("wires the workspace to the Tauri gateway and the stores", async () => {
    invokeMock.mockResolvedValue({ status: "cancelled" });
    const services = createAppServices();
    expect(services.applicationStore.getState().project).toBeNull();
    expect(services.uiStateStore.getState().activeDocumentId).toBeNull();
    const selection = await services.workspace.selectProjectFolder();
    expect(selection).toEqual({ ok: true, value: { status: "cancelled" } });
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.selectProjectFolder, {});
    services.disconnectUiState();
  });

  it("reports a command failure as an error result, not a throw", async () => {
    invokeMock.mockRejectedValue({
      kind: "invalidFolderSelection",
      detail: "x",
    });
    const { workspace } = createAppServices();
    const result = await workspace.openProject("stale");
    expect(!result.ok && result.error.kind).toBe("invalidFolderSelection");
  });
});
