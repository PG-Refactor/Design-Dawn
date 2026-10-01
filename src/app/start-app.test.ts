import { describe, expect, it } from "vitest";
import {
  createFakeAppSettingsGateway,
  createFakeOsThemeSource,
  FAKE_SETTINGS_ERROR,
} from "../application/test-support/fake-theme";
import { createThemeController } from "../application/theme/theme-controller";
import { startApp } from "./start-app";

function setup(osTheme: "light" | "dark") {
  const gateway = createFakeAppSettingsGateway();
  const osThemeSource = createFakeOsThemeSource(osTheme);
  const themeController = createThemeController({ gateway, osThemeSource });
  const log: string[] = [];
  const themeTarget = {
    style: { colorScheme: "" },
    setAttribute: (_name: string, value: string) => log.push(`apply:${value}`),
  };
  const errors: unknown[] = [];
  return { gateway, osThemeSource, themeController, log, themeTarget, errors };
}

describe("startApp", () => {
  it("applies the OS theme before initialization resolves", async () => {
    const { themeController, themeTarget, log } = setup("dark");
    const originalInitialize = themeController.initialize;
    const logAtInitialize: string[] = [];
    const started = startApp({
      themeController: {
        store: themeController.store,
        initialize: () => {
          logAtInitialize.push(...log);
          return originalInitialize();
        },
      },
      themeTarget,
      render: () => log.push("render"),
      reportError: () => {},
    });
    await started;
    expect(logAtInitialize).toEqual(["apply:dark"]);
  });

  it("applies the saved theme before rendering, and renders once", async () => {
    const { gateway, themeController, themeTarget, log } = setup("dark");
    gateway.storage.themePreference = "light";
    await startApp({
      themeController,
      themeTarget,
      render: () => log.push("render"),
      reportError: () => {},
    });
    expect(log).toEqual(["apply:dark", "apply:light", "render"]);
  });

  it("applies later theme changes", async () => {
    const { osThemeSource, themeController, themeTarget, log } = setup("dark");
    await startApp({
      themeController,
      themeTarget,
      render: () => {},
      reportError: () => {},
    });
    log.length = 0;
    osThemeSource.set("light");
    osThemeSource.set("light");
    expect(log).toEqual(["apply:light"]);
  });

  it("renders once with the default when the settings cannot be loaded", async () => {
    const { gateway, themeController, themeTarget, log } = setup("light");
    gateway.failGet = FAKE_SETTINGS_ERROR;
    await startApp({
      themeController,
      themeTarget,
      render: () => log.push("render"),
      reportError: () => {},
    });
    expect(log).toEqual(["apply:light", "render"]);
  });

  it("renders once and reports when initialize itself rejects", async () => {
    const { themeController, themeTarget, log, errors } = setup("light");
    const failure = new Error("init");
    await startApp({
      themeController: {
        store: themeController.store,
        initialize: () => Promise.reject(failure),
      },
      themeTarget,
      render: () => log.push("render"),
      reportError: (error) => errors.push(error),
    });
    expect(log).toEqual(["apply:light", "render"]);
    expect(errors).toEqual([failure]);
  });
});
