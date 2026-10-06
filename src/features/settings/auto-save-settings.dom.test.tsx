// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_SETTINGS_ERROR } from "../../application/test-support/fake-theme";
import { settle } from "../../application/test-support/fakes";
import { renderOpenedCanvas } from "../markdown/test-support/markdown-harness";
import { makeDocumentADirty } from "../workspace/test-support/actions-harness";

afterEach(() => {
  cleanup();
});

const WRITE_METHODS = ["saveProject", "saveDocument", "saveSheet"] as const;
const writes = (shell: { gateway: { methods(...m: string[]): string[] } }) =>
  shell.gateway.methods(...WRITE_METHODS);

const toggle = () => screen.getByRole("checkbox", { name: "自動保存" });
const isChecked = () => (toggle() as HTMLInputElement).checked;

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
    await renderWithSettingsLoaded();
    expect(isChecked()).toBe(true);
  });

  it("shows off when the stored setting is off", async () => {
    const { shell } = await renderOpenedCanvas();
    shell.settingsGateway.storage.autoSave = false;
    await act(async () => {
      await shell.autoSaveController.initialize();
    });
    expect(isChecked()).toBe(false);
  });

  it("saves the setting through the gateway when toggled", async () => {
    const { shell } = await renderWithSettingsLoaded();

    await shell.user.click(toggle());

    await waitFor(() => {
      expect(shell.settingsGateway.autoSaveCalls).toEqual([false]);
    });
    expect(shell.settingsGateway.storage.autoSave).toBe(false);
    await waitFor(() => expect(isChecked()).toBe(false));
  });

  it("keeps the previous state and reports the error when saving fails", async () => {
    const { shell } = await renderWithSettingsLoaded();
    shell.settingsGateway.failSet = FAKE_SETTINGS_ERROR;

    await shell.user.click(toggle());

    await waitFor(() => {
      expect(shell.settingsGateway.autoSaveCalls).toEqual([false]);
    });
    expect(isChecked()).toBe(true);
    await waitFor(() => {
      expect(shell.autoSaveController.store.getState().saveError).toEqual(
        FAKE_SETTINGS_ERROR,
      );
    });
  });

  it("off: an edit is not written after the delay, Ctrl+S writes it, on resumes the pending save", async () => {
    const { shell } = await renderWithSettingsLoaded();
    await shell.user.click(toggle());
    await waitFor(() => expect(isChecked()).toBe(false));
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
    await shell.user.click(toggle());
    await waitFor(() => expect(isChecked()).toBe(true));
    await shell.runAutoSave();
    expect(writes(shell).length).toBeGreaterThan(0);
  });
});
