import { describe, expect, it } from "vitest";
import {
  createFakeAppSettingsGateway,
  createFakeOsThemeSource,
  FAKE_SETTINGS_ERROR,
} from "../test-support/fake-theme";
import { createThemeController } from "./theme-controller";

function setup(osTheme: "light" | "dark" | null = "dark") {
  const gateway = createFakeAppSettingsGateway();
  const osThemeSource = createFakeOsThemeSource(osTheme);
  const controller = createThemeController({ gateway, osThemeSource });
  return { gateway, osThemeSource, controller };
}

describe("initial state", () => {
  it("starts as system following the OS theme, still loading", () => {
    const { controller } = setup("dark");
    expect(controller.store.getState()).toEqual({
      preference: "system",
      osTheme: "dark",
      resolvedTheme: "dark",
      status: "loading",
      loadIssue: null,
      saveError: null,
    });
  });

  it("falls back to light when the OS theme is unknown", async () => {
    const { controller } = setup(null);
    await controller.initialize();
    expect(controller.store.getState().resolvedTheme).toBe("light");
  });
});

describe("initialize", () => {
  it.each(["system", "light", "dark"] as const)(
    "loads a saved %s",
    async (saved) => {
      const { gateway, controller } = setup("dark");
      gateway.storage.themePreference = saved;
      await controller.initialize();
      const state = controller.store.getState();
      expect(state.preference).toBe(saved);
      expect(state.status).toBe("ready");
      expect(state.resolvedTheme).toBe(saved === "system" ? "dark" : saved);
    },
  );

  it("keeps the default and records the error when loading fails", async () => {
    const { gateway, controller } = setup("dark");
    gateway.failGet = FAKE_SETTINGS_ERROR;
    await controller.initialize();
    const state = controller.store.getState();
    expect(state.preference).toBe("system");
    expect(state.status).toBe("ready");
    expect(state.loadIssue).toEqual(FAKE_SETTINGS_ERROR);
    gateway.failGet = null;
    expect((await controller.setPreference("light")).ok).toBe(true);
    expect(controller.store.getState().resolvedTheme).toBe("light");
  });

  it("does not reject when the gateway throws", async () => {
    const { gateway, controller } = setup();
    gateway.getAppSettings = () => Promise.reject(new Error("boom"));
    await controller.initialize();
    expect(controller.store.getState().loadIssue?.kind).toBe(
      "unexpectedCommandError",
    );
  });

  it("surfaces a load issue next to the default value", async () => {
    const { gateway, controller } = setup();
    gateway.storage.loadIssue = { kind: "invalidJson", detail: "broken" };
    await controller.initialize();
    const state = controller.store.getState();
    expect(state.loadIssue?.kind).toBe("invalidJson");
    expect(state.preference).toBe("system");
  });

  it("subscribes to the OS theme once", async () => {
    const { osThemeSource, controller } = setup();
    await Promise.all([controller.initialize(), controller.initialize()]);
    expect(osThemeSource.listenerCount()).toBe(1);
  });
});

describe("setPreference", () => {
  it.each(["system", "light", "dark"] as const)(
    "saves %s then updates the state",
    async (preference) => {
      const { gateway, controller } = setup("dark");
      await controller.initialize();
      const release = gateway.holdNextSet();
      const pending = controller.setPreference(preference);
      await Promise.resolve();
      // Not applied before the save has succeeded.
      expect(controller.store.getState().preference).toBe("system");
      release();
      expect(await pending).toEqual({ ok: true, value: preference });
      expect(controller.store.getState().preference).toBe(preference);
      expect(gateway.storage.themePreference).toBe(preference);
    },
  );

  it("keeps the previous preference and sets saveError on failure, cleared by the next success", async () => {
    const { gateway, controller } = setup("dark");
    await controller.initialize();
    await controller.setPreference("light");
    gateway.failSet = FAKE_SETTINGS_ERROR;
    const failed = await controller.setPreference("dark");
    expect(failed.ok).toBe(false);
    let state = controller.store.getState();
    expect(state.preference).toBe("light");
    expect(state.resolvedTheme).toBe("light");
    expect(state.saveError).toEqual(FAKE_SETTINGS_ERROR);
    gateway.failSet = null;
    await controller.setPreference("dark");
    state = controller.store.getState();
    expect(state.preference).toBe("dark");
    expect(state.saveError).toBeNull();
  });

  it("serializes rapid changes and ends with the last requested value", async () => {
    const { gateway, controller } = setup();
    await controller.initialize();
    const release = gateway.holdNextSet();
    const results = Promise.all([
      controller.setPreference("light"),
      controller.setPreference("dark"),
      controller.setPreference("system"),
      controller.setPreference("dark"),
    ]);
    await Promise.resolve();
    expect(gateway.setCalls).toEqual(["light"]);
    release();
    await results;
    expect(gateway.setCalls).toEqual(["light", "dark", "system", "dark"]);
    expect(controller.store.getState().preference).toBe("dark");
    expect(gateway.storage.themePreference).toBe("dark");
  });
});

describe("OS theme changes", () => {
  it("updates the applied theme while the preference is system", async () => {
    const { osThemeSource, controller } = setup("dark");
    await controller.initialize();
    osThemeSource.set("light");
    expect(controller.store.getState().resolvedTheme).toBe("light");
    osThemeSource.set("dark");
    expect(controller.store.getState().resolvedTheme).toBe("dark");
  });

  it.each(["light", "dark"] as const)(
    "does not change a fixed %s theme but remembers the OS theme",
    async (fixed) => {
      const { osThemeSource, controller } = setup("dark");
      await controller.initialize();
      await controller.setPreference(fixed);
      const other = fixed === "light" ? "dark" : "light";
      osThemeSource.set(other);
      expect(controller.store.getState().resolvedTheme).toBe(fixed);
      expect(controller.store.getState().osTheme).toBe(other);
      await controller.setPreference("system");
      expect(controller.store.getState().resolvedTheme).toBe(other);
    },
  );

  it("stops listening after dispose", async () => {
    const { osThemeSource, controller } = setup("dark");
    await controller.initialize();
    controller.dispose();
    expect(osThemeSource.listenerCount()).toBe(0);
    osThemeSource.set("light");
    expect(controller.store.getState().resolvedTheme).toBe("dark");
  });
});

describe("persistence across restarts", () => {
  it("a second controller over the same storage starts with the saved preference", async () => {
    const { gateway, controller } = setup("light");
    await controller.initialize();
    await controller.setPreference("dark");
    controller.dispose();
    const second = createThemeController({
      gateway,
      osThemeSource: createFakeOsThemeSource("light"),
    });
    await second.initialize();
    expect(second.store.getState().preference).toBe("dark");
    expect(second.store.getState().resolvedTheme).toBe("dark");
  });
});
