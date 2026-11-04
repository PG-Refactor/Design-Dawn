// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import licenseText from "../../../LICENSE?raw";
import { APP_CONFIG } from "../../config/app-config";
import {
  chooseMenuItem,
  openMenu,
} from "../workspace/test-support/menu-helpers";
import { renderShell } from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";

afterEach(cleanup);

const EN = WORKSPACE_MESSAGES.en;
const NOTICES_HEADING = "# Third-Party Notices";

describe("Help menu", () => {
  it("lists About, License and Third-Party Licenses", async () => {
    const shell = await renderShell({ systemLanguages: ["en"] });
    const menu = await openMenu(shell.user, EN.topBar.helpMenu);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      EN.topBar.about,
      EN.topBar.license,
      EN.topBar.thirdPartyLicenses,
    ]);
  });

  it("shows the version and the license name in About, and closes with Escape", async () => {
    const shell = await renderShell({ systemLanguages: ["en"] });
    await chooseMenuItem(shell.user, EN.topBar.helpMenu, EN.topBar.about);
    const dialog = screen.getByRole("dialog", { name: APP_CONFIG.displayName });
    expect(within(dialog).getByText(APP_CONFIG.version)).toBeTruthy();
    expect(within(dialog).getByText(APP_CONFIG.licenseName)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: EN.help.close }),
    );
    await shell.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the repository's LICENSE text", async () => {
    const shell = await renderShell({ systemLanguages: ["en"] });
    await chooseMenuItem(shell.user, EN.topBar.helpMenu, EN.topBar.license);
    const dialog = screen.getByRole("dialog", { name: EN.topBar.license });
    await waitFor(() =>
      expect(dialog.querySelector("pre")?.textContent).toBe(licenseText),
    );
    expect(licenseText).toContain(APP_CONFIG.licenseName);
  });

  it("opens the third-party notices from About and returns to nothing on Close", async () => {
    const shell = await renderShell({ systemLanguages: ["en"] });
    await chooseMenuItem(shell.user, EN.topBar.helpMenu, EN.topBar.about);
    await shell.user.click(
      screen.getByRole("button", { name: EN.help.showThirdPartyLicenses }),
    );
    const dialog = screen.getByRole("dialog", {
      name: EN.topBar.thirdPartyLicenses,
    });
    await waitFor(() =>
      expect(
        dialog.querySelector("pre")?.textContent?.startsWith(NOTICES_HEADING),
      ).toBe(true),
    );
    await shell.user.click(
      within(dialog).getByRole("button", { name: EN.help.close }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
