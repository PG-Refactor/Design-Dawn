// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeAppSettingsGateway,
  createFakeOsThemeSource,
  FAKE_SETTINGS_ERROR,
} from "../../application/test-support/fake-theme";
import { createThemeController } from "../../application/theme/theme-controller";
import { applyTheme } from "./apply-theme";
import { ThemeSettings } from "./theme-settings";

// Real DOM interaction for the theme selector: what the node-only tests cannot cover
// (clicks, keyboard operation, the applied root attribute).

async function renderThemeSettings() {
  const gateway = createFakeAppSettingsGateway();
  const osThemeSource = createFakeOsThemeSource("light");
  const controller = createThemeController({ gateway, osThemeSource });
  controller.store.subscribe(() => {
    applyTheme(
      document.documentElement,
      controller.store.getState().resolvedTheme,
    );
  });
  await controller.initialize();
  applyTheme(
    document.documentElement,
    controller.store.getState().resolvedTheme,
  );
  render(
    <ThemeSettings
      controller={controller}
      legend="Theme"
      labels={{ system: "System", light: "Light", dark: "Dark" }}
    />,
  );
  return { gateway, osThemeSource, controller, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
});

describe("ThemeSettings in a DOM", () => {
  it("shows the three options as a labelled radio group with System selected", async () => {
    await renderThemeSettings();

    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual([
      "system",
      "light",
      "dark",
    ]);
    expect(
      (screen.getByRole("radio", { name: "System" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("saves and applies the theme when an option is clicked", async () => {
    const { gateway, user } = await renderThemeSettings();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    expect(gateway.setCalls).toEqual(["dark"]);
    expect(gateway.storage.themePreference).toBe("dark");
    expect(
      (screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("can be operated with the keyboard alone", async () => {
    const { gateway, user } = await renderThemeSettings();

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "System" }),
    );
    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(gateway.setCalls).toEqual(["light"]);
    });
    await waitFor(() => {
      expect(
        (screen.getByRole("radio", { name: "Light" }) as HTMLInputElement)
          .checked,
      ).toBe(true);
    });
  });

  it("follows an OS theme change while System is selected", async () => {
    const { osThemeSource } = await renderThemeSettings();

    osThemeSource.set("dark");

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
  });

  it("keeps the previous selection when saving fails", async () => {
    const { gateway, user } = await renderThemeSettings();
    gateway.failSet = FAKE_SETTINGS_ERROR;

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => {
      expect(gateway.setCalls).toEqual(["dark"]);
    });
    expect(
      (screen.getByRole("radio", { name: "System" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
