import { describe, expect, it } from "vitest";
import type { SystemLanguageSource } from "../ports/system-language-source";
import {
  createFakeAppSettingsGateway,
  FAKE_SETTINGS_ERROR,
} from "../test-support/fake-theme";
import { createLanguageController } from "./language-controller";

function setup(systemLanguages: readonly string[] = ["ja-JP"]) {
  const gateway = createFakeAppSettingsGateway();
  const systemLanguageSource: SystemLanguageSource = {
    current: () => systemLanguages,
  };
  const controller = createLanguageController({
    gateway,
    systemLanguageSource,
  });
  return { gateway, controller };
}

describe("initial state", () => {
  it("starts as system resolved from the system languages, still loading", () => {
    expect(setup(["ja-JP"]).controller.store.getState()).toEqual({
      preference: "system",
      language: "ja",
      status: "loading",
      loadIssue: null,
      saveError: null,
    });
    expect(setup(["en-US"]).controller.store.getState().language).toBe("en");
  });
});

describe("initialize", () => {
  it.each(["system", "en", "ja"] as const)(
    "loads a saved %s",
    async (saved) => {
      const { gateway, controller } = setup(["ja"]);
      gateway.storage.languagePreference = saved;
      await controller.initialize();
      const state = controller.store.getState();
      expect(state.preference).toBe(saved);
      expect(state.status).toBe("ready");
      expect(state.language).toBe(saved === "system" ? "ja" : saved);
    },
  );

  it("keeps the default and records the error when loading fails", async () => {
    const { gateway, controller } = setup(["en"]);
    gateway.failGet = FAKE_SETTINGS_ERROR;
    await controller.initialize();
    const state = controller.store.getState();
    expect(state.preference).toBe("system");
    expect(state.status).toBe("ready");
    expect(state.loadIssue).toEqual(FAKE_SETTINGS_ERROR);
  });

  it("records the load issue reported next to the settings", async () => {
    const { gateway, controller } = setup();
    gateway.storage.loadIssue = FAKE_SETTINGS_ERROR;
    await controller.initialize();
    expect(controller.store.getState().loadIssue).toEqual(FAKE_SETTINGS_ERROR);
  });

  it("loads only once", async () => {
    const { gateway, controller } = setup();
    gateway.storage.languagePreference = "en";
    await controller.initialize();
    gateway.storage.languagePreference = "ja";
    await controller.initialize();
    expect(controller.store.getState().preference).toBe("en");
  });
});

describe("setPreference", () => {
  it("saves through the gateway and then updates the state", async () => {
    const { gateway, controller } = setup(["en"]);
    await controller.initialize();
    const result = await controller.setPreference("ja");
    expect(result).toEqual({ ok: true, value: "ja" });
    expect(gateway.languageCalls).toEqual(["ja"]);
    expect(controller.store.getState()).toMatchObject({
      preference: "ja",
      language: "ja",
      saveError: null,
    });
  });

  it("keeps the state and records the error when saving fails", async () => {
    const { gateway, controller } = setup(["en"]);
    await controller.initialize();
    gateway.failSet = FAKE_SETTINGS_ERROR;
    const result = await controller.setPreference("ja");
    expect(result.ok).toBe(false);
    expect(controller.store.getState()).toMatchObject({
      preference: "system",
      language: "en",
      saveError: FAKE_SETTINGS_ERROR,
    });
    gateway.failSet = null;
    expect((await controller.setPreference("ja")).ok).toBe(true);
    expect(controller.store.getState().saveError).toBeNull();
  });

  it("stores the last requested value when requests overlap", async () => {
    const { gateway, controller } = setup();
    await controller.initialize();
    const release = gateway.holdNextSet();
    const first = controller.setPreference("en");
    const second = controller.setPreference("ja");
    release();
    await Promise.all([first, second]);
    expect(gateway.storage.languagePreference).toBe("ja");
    expect(controller.store.getState().preference).toBe("ja");
  });
});

describe("applyExternal", () => {
  it("applies a preference another window saved without calling the gateway", async () => {
    const { gateway, controller } = setup(["ja"]);
    await controller.initialize();
    controller.applyExternal("en");
    expect(controller.store.getState()).toMatchObject({
      preference: "en",
      language: "en",
    });
    controller.applyExternal("system");
    expect(controller.store.getState().language).toBe("ja");
    expect(gateway.languageCalls).toEqual([]);
  });
});
