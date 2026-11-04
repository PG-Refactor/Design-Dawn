// @vitest-environment jsdom

import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { AI_ACCESS_MESSAGES } from "../ai-access/ai-access-messages";
import { makeDocumentADirty } from "./test-support/actions-harness";
import {
  chooseMenuItem,
  menuItem,
  openMenu,
} from "./test-support/menu-helpers";
import { renderShell } from "./test-support/shell-harness";
import { addOperationError } from "./ui-state/shell-ui-state";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

afterEach(cleanup);

const JA = WORKSPACE_MESSAGES.ja.topBar;
const EN = WORKSPACE_MESSAGES.en.topBar;

describe("top bar as a menu bar", () => {
  it("is one row with the app name and the File / View / Help menus", async () => {
    const shell = await renderShell();
    const bar = screen.getByRole("banner");
    const menubar = within(bar).getByRole("menubar", { name: JA.menubarLabel });
    expect(
      within(menubar)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([JA.fileMenu, JA.viewMenu, JA.helpMenu]);
    expect(within(bar).queryAllByRole("button")).toHaveLength(1);
    await shell.openProjectInUi();
    // The Project's name is in the window's title bar, not repeated here.
    expect(within(bar).queryByText("Project")).toBeNull();
  });

  it("names the open Project in the window's title bar", async () => {
    const shell = await renderShell();
    await waitFor(() => expect(shell.windowTitles.at(-1)).toBeNull());
    await shell.openProjectInUi();
    await waitFor(() => expect(shell.windowTitles.at(-1)).toBe("Project"));
    await chooseMenuItem(shell.user, JA.fileMenu, JA.closeProject);
    await waitFor(() => expect(shell.windowTitles.at(-1)).toBeNull());
  });
});

describe("File menu", () => {
  it("lists the items in order, with Save showing the shortcut and Auto Save a checkbox", async () => {
    const shell = await renderShell({ systemLanguages: ["en"] });
    await shell.openProjectInUi();
    const menu = await openMenu(shell.user, EN.fileMenu);
    expect(
      [...menu.querySelectorAll('[role^="menuitem"]')].map((item) => [
        item.getAttribute("role"),
        item.textContent?.trim(),
      ]),
    ).toEqual([
      ["menuitem", EN.createProject],
      ["menuitem", EN.openProject],
      ["menuitem", EN.openProjectInNewWindow],
      ["menuitem", `${EN.save}Ctrl+S`],
      ["menuitemcheckbox", EN.autoSave],
      ["menuitem", AI_ACCESS_MESSAGES.en.menuItem],
      ["menuitem", EN.closeProject],
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(3);
  });

  it("opens the project via its item and shows the tree", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("closes the Project via its item", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    await chooseMenuItem(shell.user, JA.fileMenu, JA.closeProject);
    await waitFor(() => expect(screen.queryByRole("tree")).toBeNull());
    expect(
      screen.getAllByText(WORKSPACE_MESSAGES.ja.placeholder.noProject).length,
    ).toBeGreaterThan(0);
  });

  it("disables Save and Close Project without a Project, enables them with one", async () => {
    const shell = await renderShell();
    for (const name of [JA.save, JA.closeProject]) {
      const item = await menuItem(shell.user, JA.fileMenu, name);
      expect(item.getAttribute("aria-disabled")).toBe("true");
    }
    const open = await menuItem(shell.user, JA.fileMenu, JA.openProject);
    expect(open.getAttribute("aria-disabled")).toBeNull();
    await shell.openProjectInUi();
    for (const name of [JA.save, JA.closeProject]) {
      const item = await menuItem(shell.user, JA.fileMenu, name);
      expect(item.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("disables the Project items while an operation is running", async () => {
    const shell = await renderShell();
    act(() => {
      shell.uiStateStore.setState((state) => ({ ...state, busy: true }));
    });
    for (const name of [
      JA.createProject,
      JA.openProject,
      JA.openProjectInNewWindow,
    ]) {
      const item = await menuItem(shell.user, JA.fileMenu, name);
      expect(item.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("saves everything with the Save item", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    await act(async () => {
      await shell.actions.openDocument(DOCUMENT_A);
      await shell.autoSaveController.initialize();
      await shell.autoSaveController.setEnabled(false);
    });
    await makeDocumentADirty(shell);
    shell.gateway.clearCalls();
    await chooseMenuItem(shell.user, JA.fileMenu, JA.save);
    await waitFor(() =>
      expect(
        shell.gateway.methods("saveProject", "saveDocument", "saveSheet")
          .length,
      ).toBeGreaterThan(0),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: JA.fileMenu }),
    );
  });

  it("reflects the Auto Save state in aria-checked", async () => {
    const shell = await renderShell();
    await act(async () => {
      await shell.autoSaveController.initialize();
    });
    const item = await menuItem(
      shell.user,
      JA.fileMenu,
      JA.autoSave,
      "menuitemcheckbox",
    );
    expect(item.getAttribute("aria-checked")).toBe("true");
  });

  it("creates a Project from the New Project item", async () => {
    const shell = await renderShell({ systemLanguages: ["en"] });
    await chooseMenuItem(shell.user, EN.fileMenu, EN.createProject);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("View menu", () => {
  it("offers the theme and language radios with the current choice checked", async () => {
    const shell = await renderShell();
    const menu = await openMenu(shell.user, JA.viewMenu);
    const theme = within(menu).getByRole("group", { name: JA.themeLegend });
    expect(
      within(theme)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual([JA.systemOption, JA.themeLight, JA.themeDark]);
    const language = within(menu).getByRole("group", {
      name: JA.languageLegend,
    });
    expect(
      within(language)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual([JA.systemOption, "English", "日本語"]);
  });

  it("saves and applies the theme chosen in the menu, one radio checked", async () => {
    const shell = await renderShell();
    await act(async () => {
      await shell.themeController.initialize();
    });
    const menu = await openMenu(shell.user, JA.viewMenu);
    const theme = within(menu).getByRole("group", { name: JA.themeLegend });
    expect(
      within(theme)
        .getByRole("menuitemradio", { name: JA.systemOption })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await shell.user.click(
      within(theme).getByRole("menuitemradio", { name: JA.themeDark }),
    );
    await waitFor(() =>
      expect(shell.themeController.store.getState().preference).toBe("dark"),
    );
    const reopened = within(await openMenu(shell.user, JA.viewMenu)).getByRole(
      "group",
      { name: JA.themeLegend },
    );
    const checked = within(reopened)
      .getAllByRole("menuitemradio")
      .filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked.map((item) => item.textContent)).toEqual([JA.themeDark]);
  });

  it("offers the text sizes with the stored one checked, and saves the one chosen", async () => {
    const shell = await renderShell();
    await act(async () => {
      await shell.textSizeController.initialize();
    });
    const menu = await openMenu(shell.user, JA.viewMenu);
    const sizes = within(menu).getByRole("group", { name: JA.textSizeLegend });
    const radios = within(sizes).getAllByRole("menuitemradio");
    expect(radios.map((item) => item.textContent)).toEqual([
      JA.textSizeSmall,
      JA.textSizeMedium,
      JA.textSizeLarge,
      JA.textSizeXLarge,
    ]);
    expect(
      radios
        .filter((item) => item.getAttribute("aria-checked") === "true")
        .map((item) => item.textContent),
    ).toEqual([JA.textSizeMedium]);
    await shell.user.click(
      within(sizes).getByRole("menuitemradio", { name: JA.textSizeLarge }),
    );
    await waitFor(() =>
      expect(shell.textSizeController.store.getState().size).toBe("large"),
    );
    expect(shell.textSizeGateway.textSizeCalls).toEqual(["large"]);
  });

  it("shows a failed text size save in the notifications", async () => {
    const shell = await renderShell();
    await act(async () => {
      await shell.textSizeController.initialize();
    });
    shell.textSizeGateway.failSet = { kind: "ioError", detail: "disk" };
    await chooseMenuItem(
      shell.user,
      JA.viewMenu,
      JA.textSizeXLarge,
      "menuitemradio",
    );
    expect(
      await screen.findByRole("button", { name: "エラー 1件" }),
    ).toBeTruthy();
    expect(shell.textSizeController.store.getState().size).toBe("medium");
  });

  it("disables the radios until the settings are loaded", async () => {
    const shell = await renderShell();
    const item = await menuItem(
      shell.user,
      JA.viewMenu,
      JA.themeDark,
      "menuitemradio",
    );
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("notifications button", () => {
  it("shows an icon, a count badge and the count in its accessible name", async () => {
    const shell = await renderShell();
    const quiet = screen.getByRole("button", { name: "通知なし" });
    expect(quiet.querySelector(".notifications__badge")).toBeNull();
    act(() => {
      shell.uiStateStore.setState((state) =>
        addOperationError(state, "openDocument", "Document A", {
          kind: "ioError",
          detail: "disk",
        }),
      );
    });
    const button = screen.getByRole("button", { name: "エラー 1件" });
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.querySelector(".notifications__badge")?.textContent).toBe(
      "1",
    );
  });
});
