// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_SETTINGS_ERROR } from "../../application/test-support/fake-theme";
import {
  DISPLAY_LANGUAGE_NATIVE_NAMES,
  LANGUAGE_PREFERENCES,
} from "../../config/language-config";
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
// inside its group.
const radio = (name: string, legend: string = JA.languageLegend) =>
  within(screen.getByRole("group", { name: legend })).getByRole("radio", {
    name,
  }) as HTMLInputElement;

describe("language selector", () => {
  it("offers System plus each language in its own name", async () => {
    await renderLoaded();
    const group = screen.getByRole("group", { name: JA.languageLegend });
    const values = within(group)
      .getAllByRole("radio")
      .map((item) => item.getAttribute("value"));
    expect(values).toEqual([...LANGUAGE_PREFERENCES]);
    expect(radio(JA.systemOption).checked).toBe(true);
    expect(radio(DISPLAY_LANGUAGE_NATIVE_NAMES.en)).toBeTruthy();
    expect(radio(DISPLAY_LANGUAGE_NATIVE_NAMES.ja)).toBeTruthy();
  });

  it("reflects the stored preference", async () => {
    const shell = await renderShell();
    shell.languageGateway.storage.languagePreference = "en";
    await act(async () => {
      await shell.languageController.initialize();
    });
    expect(radio("English", EN.languageLegend).checked).toBe(true);
  });

  it("saves the choice and switches the UI to English at once", async () => {
    const shell = await renderLoaded();
    await shell.user.click(radio("English"));
    await waitFor(() => {
      expect(
        screen.getByRole("group", { name: EN.languageLegend }),
      ).toBeTruthy();
    });
    expect(shell.languageGateway.languageCalls).toEqual(["en"]);
    expect(screen.getByRole("group", { name: EN.themeLegend })).toBeTruthy();
    expect(screen.queryByText(JA.openProject)).toBeNull();
    expect(screen.getByText(EN.openProject)).toBeTruthy();
    // The language names do not change with the language.
    expect(radio("日本語", EN.languageLegend)).toBeTruthy();
    expect(radio(EN.systemOption, EN.languageLegend)).toBeTruthy();
  });

  it("shows a failed save as a notification and keeps the choice", async () => {
    const shell = await renderLoaded();
    shell.languageGateway.failSet = FAKE_SETTINGS_ERROR;
    await shell.user.click(radio("English"));
    await waitFor(() => {
      expect(shell.languageGateway.languageCalls).toEqual(["en"]);
    });
    expect(radio(JA.systemOption).checked).toBe(true);
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
    await renderShell();
    expect(radio(JA.systemOption).disabled).toBe(true);
  });
});

describe("theme labels", () => {
  it("are shown in Japanese and in English", async () => {
    const shell = await renderLoaded();
    for (const label of [JA.themeLight, JA.themeDark]) {
      expect(radio(label, JA.themeLegend)).toBeTruthy();
    }
    act(() => shell.languageController.applyExternal("en"));
    for (const label of [EN.themeLight, EN.themeDark]) {
      expect(radio(label, EN.themeLegend)).toBeTruthy();
    }
  });
});
