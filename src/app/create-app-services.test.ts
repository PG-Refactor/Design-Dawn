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

  it("wires the theme controller to the app settings commands", async () => {
    invokeMock.mockResolvedValue({
      themePreference: "dark",
      autoSave: true,
      projectTreeWidth: 320,
      loadIssue: null,
    });
    const { themeController } = createAppServices();
    await themeController.initialize();
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.getAppSettings, {});
    expect(themeController.store.getState().resolvedTheme).toBe("dark");
    themeController.dispose();
  });

  it("provides the drop event source and the asset URL resolver", () => {
    const { dropEventSource, assetUrlResolver, disconnectUiState } =
      createAppServices();
    expect(typeof dropEventSource.subscribeFilesDropped).toBe("function");
    expect(typeof dropEventSource.subscribeDragState).toBe("function");
    expect(typeof assetUrlResolver.urlFor).toBe("function");
    disconnectUiState();
  });

  it("provides a Git controller that has no status without a Project", () => {
    const { gitController, disconnectUiState } = createAppServices();
    expect(gitController.store.getState()).toEqual({
      projectId: null,
      status: null,
      refreshing: false,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      COMMANDS.gitStatus,
      expect.anything(),
    );
    gitController.dispose();
    disconnectUiState();
  });

  it("provides the close request source", () => {
    const { closeRequestSource, disconnectUiState } = createAppServices();
    expect(typeof closeRequestSource.subscribe).toBe("function");
    expect(typeof closeRequestSource.confirmClose).toBe("function");
    disconnectUiState();
  });
});
