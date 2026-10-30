// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_SETTINGS_ERROR } from "../../application/test-support/fake-theme";
import {
  DISPLAY_LANGUAGE_NATIVE_NAMES,
  LANGUAGE_PREFERENCES,
} from "../../config/language-config";
import { openMenu } from "../workspace/test-support/menu-helpers";
import { renderShell } from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";

afterEach(cleanup);

const JA = WORKSPACE_MESSAGES.ja.topBar;
const EN = WORKSPACE_MESSAGES.en.topBar;

// The app loads the setting at start-up (`startApp`); here the test does it.
async function renderLoaded(systemLanguages?: readonly string[]) {
  const shell = await renderShell({ systemLanguages });
  await act(async () => {
    await shell.languageController.initialize();
  });
  return shell;
}

// "System" exists in both the language and the theme group, so a radio is looked up
// inside its group of the (opened) View menu.
async function radio(
  shell: Awaited<ReturnType<typeof renderLoaded>>,
  name: string,
  language: typeof JA | typeof EN = JA,
  legend: string = language.languageLegend,
) {
  const menu = await openMenu(shell.user, language.viewMenu);
  return within(within(menu).getByRole("group", { name: legend })).getByRole(
    "menuitemradio",
    { name },
  );
}
const isChecked = (element: HTMLElement) =>
  element.getAttribute("aria-checked") === "true";

describe("language selector", () => {
  it("offers System plus each language in its own name", async () => {
    const shell = await renderLoaded();
    const menu = await openMenu(shell.user, JA.viewMenu);
    const group = within(menu).getByRole("group", { name: JA.languageLegend });
    const labels = within(group)
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent);
    expect(labels).toEqual(
      LANGUAGE_PREFERENCES.map((preference) =>
        preference === "system"
          ? JA.systemOption
          : DISPLAY_LANGUAGE_NATIVE_NAMES[preference],
      ),
    );
    expect(isChecked(await radio(shell, JA.systemOption))).toBe(true);
    expect(await radio(shell, DISPLAY_LANGUAGE_NATIVE_NAMES.en)).toBeTruthy();
    expect(await radio(shell, DISPLAY_LANGUAGE_NATIVE_NAMES.ja)).toBeTruthy();
  });

  it("reflects the stored preference", async () => {
    const shell = await renderShell();
    shell.languageGateway.storage.languagePreference = "en";
    await act(async () => {
      await shell.languageController.initialize();
    });
    expect(isChecked(await radio(shell, "English", EN))).toBe(true);
  });

  it("saves the choice and switches the UI to English at once", async () => {
    const shell = await renderLoaded();
    await shell.user.click(await radio(shell, "English"));
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: EN.viewMenu })).toBeTruthy();
    });
    expect(shell.languageGateway.languageCalls).toEqual(["en"]);
    const menu = await openMenu(shell.user, EN.viewMenu);
    expect(
      within(menu).getByRole("group", { name: EN.themeLegend }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("group", { name: EN.languageLegend }),
    ).toBeTruthy();
    expect(screen.queryByText(JA.viewMenu)).toBeNull();
    // The language names do not change with the language.
    expect(await radio(shell, "日本語", EN)).toBeTruthy();
    expect(await radio(shell, EN.systemOption, EN)).toBeTruthy();
  });

  it("shows a failed save as a notification and keeps the choice", async () => {
    const shell = await renderLoaded();
    shell.languageGateway.failSet = FAKE_SETTINGS_ERROR;
    await shell.user.click(await radio(shell, "English"));
    await waitFor(() => {
      expect(shell.languageGateway.languageCalls).toEqual(["en"]);
    });
    expect(isChecked(await radio(shell, JA.systemOption))).toBe(true);
    await shell.user.click(
      screen.getByRole("button", { name: /エラー|error/i }),
    );
    expect(
      await screen.findByText(
        new RegExp(WORKSPACE_MESSAGES.ja.notifications.languageSaveError),
      ),
    ).toBeTruthy();
  });

  it("is disabled until the setting is loaded", async () => {
    const shell = await renderShell();
    const item = await radio(shell, JA.systemOption);
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("theme labels", () => {
  it("are shown in Japanese and in English", async () => {
    const shell = await renderLoaded();
    for (const label of [JA.themeLight, JA.themeDark]) {
      expect(await radio(shell, label, JA, JA.themeLegend)).toBeTruthy();
    }
    act(() => shell.languageController.applyExternal("en"));
    for (const label of [EN.themeLight, EN.themeDark]) {
      expect(await radio(shell, label, EN, EN.themeLegend)).toBeTruthy();
    }
  });
});
