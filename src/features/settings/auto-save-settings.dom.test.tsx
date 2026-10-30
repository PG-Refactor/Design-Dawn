// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_SETTINGS_ERROR } from "../../application/test-support/fake-theme";
import { settle } from "../../application/test-support/fakes";
import { renderOpenedCanvas } from "../markdown/test-support/markdown-harness";
import { makeDocumentADirty } from "../workspace/test-support/actions-harness";
import { menuItem } from "../workspace/test-support/menu-helpers";

afterEach(() => {
  cleanup();
});

const WRITE_METHODS = ["saveProject", "saveDocument", "saveSheet"] as const;
const writes = (shell: { gateway: { methods(...m: string[]): string[] } }) =>
  shell.gateway.methods(...WRITE_METHODS);

type Rendered = Awaited<ReturnType<typeof renderOpenedCanvas>>;
type Shell = Rendered["shell"];

// The setting lives in the File menu; looking it up opens the menu.
const toggle = (shell: Shell) =>
  menuItem(shell.user, "ファイル", "自動保存", "menuitemcheckbox");
const isChecked = async (shell: Shell) =>
  (await toggle(shell)).getAttribute("aria-checked") === "true";

// The app loads the setting at start-up (`startApp`); here the test does it.
async function renderWithSettingsLoaded() {
  const rendered = await renderOpenedCanvas();
  await act(async () => {
    await rendered.shell.autoSaveController.initialize();
  });
  return rendered;
}

describe("auto-save setting in a DOM", () => {
  it("shows the stored state, on by default", async () => {
    const { shell } = await renderWithSettingsLoaded();
    expect(await isChecked(shell)).toBe(true);
  });

  it("shows off when the stored setting is off", async () => {
    const { shell } = await renderOpenedCanvas();
    shell.settingsGateway.storage.autoSave = false;
    await act(async () => {
      await shell.autoSaveController.initialize();
    });
    expect(await isChecked(shell)).toBe(false);
  });

  it("saves the setting through the gateway when toggled", async () => {
    const { shell } = await renderWithSettingsLoaded();

    await shell.user.click(await toggle(shell));

    await waitFor(() => {
      expect(shell.settingsGateway.autoSaveCalls).toEqual([false]);
    });
    expect(shell.settingsGateway.storage.autoSave).toBe(false);
    await waitFor(async () => expect(await isChecked(shell)).toBe(false));
  });

  it("keeps the previous state and reports the error when saving fails", async () => {
    const { shell } = await renderWithSettingsLoaded();
    shell.settingsGateway.failSet = FAKE_SETTINGS_ERROR;

    await shell.user.click(await toggle(shell));

    await waitFor(() => {
      expect(shell.settingsGateway.autoSaveCalls).toEqual([false]);
    });
    expect(await isChecked(shell)).toBe(true);
    await waitFor(() => {
      expect(shell.autoSaveController.store.getState().saveError).toEqual(
        FAKE_SETTINGS_ERROR,
      );
    });
  });

  it("off: an edit is not written after the delay, Ctrl+S writes it, on resumes the pending save", async () => {
    const { shell } = await renderWithSettingsLoaded();
    await shell.user.click(await toggle(shell));
    await waitFor(async () => expect(await isChecked(shell)).toBe(false));
    shell.gateway.clearCalls();

    await makeDocumentADirty(shell);
    await shell.runAutoSave();
    expect(writes(shell)).toEqual([]);

    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      await settle();
    });
    expect(writes(shell).length).toBeGreaterThan(0);

    await makeDocumentADirty(shell, "Renamed again");
    shell.gateway.clearCalls();
    await shell.user.click(await toggle(shell));
    await waitFor(async () => expect(await isChecked(shell)).toBe(true));
    await shell.runAutoSave();
    expect(writes(shell).length).toBeGreaterThan(0);
  });
});
