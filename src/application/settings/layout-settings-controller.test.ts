import { describe, expect, it } from "vitest";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import {
  createFakeAppSettingsGateway,
  FAKE_SETTINGS_ERROR,
} from "../test-support/fake-theme";
import { createLayoutSettingsController } from "./layout-settings-controller";

const { defaultWidthPx, minWidthPx, maxWidthPx } = LAYOUT_CONFIG.projectTree;

function setup() {
  const gateway = createFakeAppSettingsGateway();
  const controller = createLayoutSettingsController({
    gateway,
    defaultProjectTreeWidth: defaultWidthPx,
  });
  return { gateway, controller };
}

describe("initial state", () => {
  it("has the default width and is still loading", () => {
    const { controller } = setup();
    expect(controller.store.getState()).toEqual({
      projectTreeWidth: defaultWidthPx,
      status: "loading",
      loadIssue: null,
      saveError: null,
    });
  });
});

describe("initialize", () => {
  it("loads the stored width", async () => {
    const { gateway, controller } = setup();
    gateway.storage.projectTreeWidth = 480;
    await controller.initialize();
    expect(controller.store.getState()).toMatchObject({
      projectTreeWidth: 480,
      status: "ready",
    });
  });

  it("keeps the default and records the issue when reading fails", async () => {
    const { gateway, controller } = setup();
    gateway.failGet = FAKE_SETTINGS_ERROR;
    await controller.initialize();
    expect(controller.store.getState()).toMatchObject({
      projectTreeWidth: defaultWidthPx,
      status: "ready",
      loadIssue: FAKE_SETTINGS_ERROR,
    });
  });

  it("reads the settings only once", async () => {
    const { gateway, controller } = setup();
    await controller.initialize();
    gateway.storage.projectTreeWidth = 500;
    await controller.initialize();
    expect(controller.store.getState().projectTreeWidth).toBe(defaultWidthPx);
  });
});

describe("setProjectTreeWidth", () => {
  it("saves the width and updates the state", async () => {
    const { gateway, controller } = setup();
    const result = await controller.setProjectTreeWidth(400);
    expect(result).toEqual({ ok: true, value: 400 });
    expect(gateway.projectTreeWidthCalls).toEqual([400]);
    expect(controller.store.getState().projectTreeWidth).toBe(400);
  });

  it("keeps the previous width and records the error when saving fails", async () => {
    const { gateway, controller } = setup();
    gateway.failSet = FAKE_SETTINGS_ERROR;
    const result = await controller.setProjectTreeWidth(400);
    expect(result.ok).toBe(false);
    expect(controller.store.getState().projectTreeWidth).toBe(defaultWidthPx);
    expect(controller.store.getState().saveError).toEqual(FAKE_SETTINGS_ERROR);
    gateway.failSet = null;
    await controller.setProjectTreeWidth(400);
    expect(controller.store.getState().saveError).toBeNull();
    expect(controller.store.getState().projectTreeWidth).toBe(400);
  });

  it("rejects an invalid width without calling the gateway", async () => {
    const { gateway, controller } = setup();
    for (const width of [minWidthPx - 1, maxWidthPx + 1, 300.5, Number.NaN]) {
      const result = await controller.setProjectTreeWidth(width);
      expect(!result.ok && result.error.kind).toBe("invalidProjectTreeWidth");
    }
    expect(gateway.projectTreeWidthCalls).toEqual([]);
    expect(controller.store.getState().projectTreeWidth).toBe(defaultWidthPx);
  });

  it("stores the last requested width when requests overlap", async () => {
    const { gateway, controller } = setup();
    const release = gateway.holdNextSet();
    const first = controller.setProjectTreeWidth(300);
    const second = controller.setProjectTreeWidth(500);
    release();
    await Promise.all([first, second]);
    expect(gateway.projectTreeWidthCalls).toEqual([300, 500]);
    expect(gateway.storage.projectTreeWidth).toBe(500);
    expect(controller.store.getState().projectTreeWidth).toBe(500);
  });
});
