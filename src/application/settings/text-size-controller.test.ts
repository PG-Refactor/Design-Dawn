import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_SIZE } from "../../config/text-size-config";
import {
  createFakeAppSettingsGateway,
  FAKE_SETTINGS_ERROR,
} from "../test-support/fake-theme";
import { createTextSizeController } from "./text-size-controller";

function setup() {
  const gateway = createFakeAppSettingsGateway();
  const controller = createTextSizeController({ gateway });
  return { gateway, controller };
}

describe("text size controller", () => {
  it("starts with the default size, still loading", () => {
    const { controller } = setup();
    expect(controller.store.getState()).toEqual({
      size: DEFAULT_TEXT_SIZE,
      status: "loading",
      loadIssue: null,
      saveError: null,
    });
  });

  it("loads the stored size once", async () => {
    const { gateway, controller } = setup();
    gateway.storage.textSize = "xlarge";
    await controller.initialize();
    await controller.initialize();
    expect(controller.store.getState()).toMatchObject({
      size: "xlarge",
      status: "ready",
    });
  });

  it("keeps the default and records the issue when reading fails", async () => {
    const { gateway, controller } = setup();
    gateway.failGet = FAKE_SETTINGS_ERROR;
    await controller.initialize();
    expect(controller.store.getState()).toMatchObject({
      size: DEFAULT_TEXT_SIZE,
      status: "ready",
      loadIssue: FAKE_SETTINGS_ERROR,
    });
  });

  it("saves a size and changes the state only after the save succeeded", async () => {
    const { gateway, controller } = setup();
    const release = gateway.holdNextSet();
    const pending = controller.setSize("large");
    expect(controller.store.getState().size).toBe(DEFAULT_TEXT_SIZE);
    release();
    expect(await pending).toEqual({ ok: true, value: "large" });
    expect(controller.store.getState().size).toBe("large");
    expect(gateway.textSizeCalls).toEqual(["large"]);
    expect(gateway.storage.textSize).toBe("large");
  });

  it("keeps the size and records the error when saving fails, and clears it on the next save", async () => {
    const { gateway, controller } = setup();
    gateway.failSet = FAKE_SETTINGS_ERROR;
    const failed = await controller.setSize("small");
    expect(failed.ok).toBe(false);
    expect(controller.store.getState()).toMatchObject({
      size: DEFAULT_TEXT_SIZE,
      saveError: FAKE_SETTINGS_ERROR,
    });
    gateway.failSet = null;
    await controller.setSize("small");
    expect(controller.store.getState()).toMatchObject({
      size: "small",
      saveError: null,
    });
  });

  it("stores the last requested size when requests overlap", async () => {
    const { gateway, controller } = setup();
    const release = gateway.holdNextSet();
    const first = controller.setSize("small");
    const second = controller.setSize("xlarge");
    release();
    await Promise.all([first, second]);
    expect(gateway.textSizeCalls).toEqual(["small", "xlarge"]);
    expect(controller.store.getState().size).toBe("xlarge");
  });

  it("applies a size saved by another window without saving it again", () => {
    const { gateway, controller } = setup();
    controller.applyExternal("large");
    expect(controller.store.getState().size).toBe("large");
    expect(gateway.textSizeCalls).toEqual([]);
  });
});
