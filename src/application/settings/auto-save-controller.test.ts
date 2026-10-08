import { describe, expect, it } from "vitest";
import {
  createFakeAppSettingsGateway,
  FAKE_SETTINGS_ERROR,
} from "../test-support/fake-theme";
import { createAutoSaveController } from "./auto-save-controller";

function setup() {
  const gateway = createFakeAppSettingsGateway();
  const controller = createAutoSaveController({
    gateway,
    defaultEnabled: true,
  });
  const changes: boolean[] = [];
  controller.subscribe((enabled) => changes.push(enabled));
  return { gateway, controller, changes };
}

describe("initial state", () => {
  it("is enabled and still loading before the stored value is known", () => {
    const { controller } = setup();
    expect(controller.isEnabled()).toBe(true);
    expect(controller.store.getState()).toEqual({
      enabled: true,
      status: "loading",
      loadIssue: null,
      saveError: null,
    });
  });
});

describe("initialize", () => {
  it("stays enabled for a stored on (or an absent / version 1 file)", async () => {
    const { controller, changes } = setup();
    await controller.initialize();
    expect(controller.isEnabled()).toBe(true);
    expect(controller.store.getState().status).toBe("ready");
    expect(changes).toEqual([]);
  });

  it("loads a stored off and notifies once", async () => {
    const { gateway, controller, changes } = setup();
    gateway.storage.autoSave = false;
    await controller.initialize();
    expect(controller.isEnabled()).toBe(false);
    expect(changes).toEqual([false]);
  });

  it("keeps the default and records the issue when reading fails", async () => {
    const { gateway, controller } = setup();
    gateway.failGet = FAKE_SETTINGS_ERROR;
    await controller.initialize();
    expect(controller.isEnabled()).toBe(true);
    expect(controller.store.getState()).toMatchObject({
      status: "ready",
      loadIssue: FAKE_SETTINGS_ERROR,
    });
  });

  it("reads the settings only once", async () => {
    const { gateway, controller } = setup();
    await controller.initialize();
    gateway.storage.autoSave = false;
    await controller.initialize();
    expect(controller.isEnabled()).toBe(true);
  });
});

describe("setEnabled", () => {
  it("saves, updates the state and notifies listeners", async () => {
    const { gateway, controller, changes } = setup();
    const result = await controller.setEnabled(false);
    expect(result).toEqual({ ok: true, value: false });
    expect(gateway.autoSaveCalls).toEqual([false]);
    expect(controller.isEnabled()).toBe(false);
    await controller.setEnabled(true);
    expect(changes).toEqual([false, true]);
  });

  it("does not notify when the value does not change", async () => {
    const { controller, changes } = setup();
    await controller.setEnabled(true);
    expect(changes).toEqual([]);
  });

  it("keeps the previous value and records the error when saving fails", async () => {
    const { gateway, controller, changes } = setup();
    gateway.failSet = FAKE_SETTINGS_ERROR;
    const result = await controller.setEnabled(false);
    expect(result.ok).toBe(false);
    expect(controller.isEnabled()).toBe(true);
    expect(controller.store.getState().saveError).toEqual(FAKE_SETTINGS_ERROR);
    expect(changes).toEqual([]);
    gateway.failSet = null;
    await controller.setEnabled(false);
    expect(controller.store.getState().saveError).toBeNull();
  });

  it("stops notifying after unsubscribe", async () => {
    const { controller } = setup();
    const received: boolean[] = [];
    const unsubscribe = controller.subscribe((enabled) =>
      received.push(enabled),
    );
    unsubscribe();
    await controller.setEnabled(false);
    expect(received).toEqual([]);
  });
});

describe("applyExternal", () => {
  it("applies a value another window saved, notifies on change and never calls the gateway", async () => {
    const { gateway, controller, changes } = setup();
    controller.applyExternal(false);
    expect(controller.isEnabled()).toBe(false);
    expect(controller.store.getState().enabled).toBe(false);
    controller.applyExternal(true);
    expect(changes).toEqual([false, true]);
    expect(gateway.autoSaveCalls).toEqual([]);
  });

  it("does not notify when the value is unchanged", () => {
    const { controller, changes } = setup();
    controller.applyExternal(true);
    expect(changes).toEqual([]);
  });
});
