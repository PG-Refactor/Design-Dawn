import { describe, expect, it } from "vitest";
import { createLanguageController } from "../application/language/language-controller";
import { createAutoSaveController } from "../application/settings/auto-save-controller";
import { createLayoutSettingsController } from "../application/settings/layout-settings-controller";
import { createTextSizeController } from "../application/settings/text-size-controller";
import {
  createFakeAppSettingsGateway,
  createFakeOsThemeSource,
  FAKE_SETTINGS_ERROR,
} from "../application/test-support/fake-theme";
import { createThemeController } from "../application/theme/theme-controller";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZE_ROOT_PX,
} from "../config/text-size-config";
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

  it("loads the auto-save setting before rendering", async () => {
    const { gateway, themeController, themeTarget, log } = setup("light");
    gateway.storage.autoSave = false;
    const autoSaveController = createAutoSaveController({
      gateway,
      defaultEnabled: true,
    });
    await startApp({
      themeController,
      autoSaveController,
      themeTarget,
      render: () => log.push(`render:${autoSaveController.isEnabled()}`),
      reportError: () => {},
    });
    expect(log).toContain("render:false");
  });

  it("loads the Project Tree width before rendering", async () => {
    const { gateway, themeController, themeTarget, log } = setup("light");
    gateway.storage.projectTreeWidth = 480;
    const layoutSettingsController = createLayoutSettingsController({
      gateway,
      defaultProjectTreeWidth: 320,
    });
    await startApp({
      themeController,
      layoutSettingsController,
      themeTarget,
      render: () =>
        log.push(
          `render:${layoutSettingsController.store.getState().projectTreeWidth}`,
        ),
      reportError: () => {},
    });
    expect(log).toContain("render:480");
  });

  it("keeps the lang attribute in sync with the display language", async () => {
    const { gateway, themeController, themeTarget } = setup("light");
    gateway.storage.languagePreference = "en";
    let systemLanguages = ["ja"];
    const languageController = createLanguageController({
      gateway,
      systemLanguageSource: { current: () => systemLanguages },
    });
    const languageTarget = { lang: "" };
    const langAtRender: string[] = [];
    await startApp({
      themeController,
      languageController,
      themeTarget,
      languageTarget,
      render: () => langAtRender.push(languageTarget.lang),
      reportError: () => {},
    });
    expect(langAtRender).toEqual(["en"]);

    systemLanguages = ["ja"];
    await languageController.setPreference("system");
    expect(languageTarget.lang).toBe("ja");
    await languageController.setPreference("en");
    expect(languageTarget.lang).toBe("en");
  });

  it("renders with the stored text size and follows later changes", async () => {
    const { gateway, themeController, themeTarget } = setup("light");
    gateway.storage.textSize = "large";
    const textSizeController = createTextSizeController({ gateway });
    const textSizeTarget = { style: { fontSize: "" } };
    const sizeAtRender: string[] = [];
    const started = startApp({
      themeController,
      textSizeController,
      themeTarget,
      textSizeTarget,
      render: () => sizeAtRender.push(textSizeTarget.style.fontSize),
      reportError: () => {},
    });
    // The default applies before the stored size is known.
    expect(textSizeTarget.style.fontSize).toBe(
      `${TEXT_SIZE_ROOT_PX[DEFAULT_TEXT_SIZE]}px`,
    );
    await started;
    expect(sizeAtRender).toEqual([`${TEXT_SIZE_ROOT_PX.large}px`]);
    await textSizeController.setSize("small");
    expect(textSizeTarget.style.fontSize).toBe(`${TEXT_SIZE_ROOT_PX.small}px`);
  });
});
