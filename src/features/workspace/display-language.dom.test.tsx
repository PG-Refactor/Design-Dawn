// @vitest-environment jsdom

import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { CANVAS_MESSAGES } from "../canvas/canvas-messages";
import { GIT_MESSAGES } from "../git/git-messages";
import { menuItem, openMenu } from "./test-support/menu-helpers";
import { renderShell } from "./test-support/shell-harness";
import { addOperationError } from "./ui-state/shell-ui-state";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

afterEach(cleanup);

const EN = WORKSPACE_MESSAGES.en;
const JA = WORKSPACE_MESSAGES.ja;
const IO_ERROR = { kind: "ioError", detail: "disk" } as const;

describe("display language in the shell", () => {
  it("shows the top bar, the project tree and the Git panel in English", async () => {
    const shell = await renderShell({ systemLanguages: ["en-US"] });
    expect(screen.getByText(EN.topBar.noProject)).toBeTruthy();
    expect(
      await menuItem(shell.user, EN.topBar.fileMenu, EN.topBar.createProject),
    ).toBeTruthy();
    await shell.openProjectInUi();
    expect(
      screen.getByRole("tree", { name: EN.appRegionTreeLabel }),
    ).toBeTruthy();
    expect(
      await menuItem(shell.user, EN.topBar.fileMenu, EN.topBar.closeProject),
    ).toBeTruthy();
    expect(screen.queryByText(JA.topBar.closeProject)).toBeNull();

    const modeTabs = screen.getByRole("tablist", {
      name: EN.leftPanel.tabsLabel,
    });
    await shell.user.click(within(modeTabs).getByRole("tab", { name: "Git" }));
    expect(
      await screen.findByRole("button", { name: GIT_MESSAGES.en.refresh }),
    ).toBeTruthy();
    expect(screen.queryByText(GIT_MESSAGES.ja.refresh)).toBeNull();
  });

  it("falls back to English when no system language has a catalog", async () => {
    await renderShell({ systemLanguages: ["fr"] });
    expect(screen.getByText(EN.topBar.noProject)).toBeTruthy();
  });

  it("switches the texts of the UI, including an existing notification, at runtime", async () => {
    const shell = await renderShell();
    await shell.openProjectInUi();
    act(() => {
      shell.uiStateStore.setState((state) =>
        addOperationError(state, "openDocument", "Document A", IO_ERROR),
      );
    });
    const message = (messages: typeof JA) =>
      messages.operationFailure(
        "Document A",
        messages.operationHeadlines.openDocument,
        messages.errorKinds.ioError,
      );
    // The File menu stays open while the language changes, so its items can be read.
    await openMenu(shell.user, JA.topBar.fileMenu);
    expect(screen.getByText(JA.topBar.closeProject)).toBeTruthy();
    expect(screen.getByText(message(JA))).toBeTruthy();

    act(() => shell.services.languageController.applyExternal("en"));
    expect(screen.getByText(EN.topBar.closeProject)).toBeTruthy();
    expect(screen.queryByText(JA.topBar.closeProject)).toBeNull();
    expect(screen.getByText(message(EN))).toBeTruthy();
    expect(screen.queryByText(message(JA))).toBeNull();

    await act(async () => {
      await shell.services.languageController.setPreference("ja");
    });
    expect(screen.getByText(JA.topBar.closeProject)).toBeTruthy();
    expect(screen.getByText(message(JA))).toBeTruthy();
  });

  it("translates the document tabs and the canvas while a sheet is open", async () => {
    const shell = await renderShell({ systemLanguages: ["en"] });
    await shell.openProjectInUi();
    await act(async () => {
      await shell.actions.openDocument(DOCUMENT_A);
      await shell.actions.selectSheet(DOCUMENT_A, SHEET_A1);
    });
    expect(
      await screen.findByRole("tablist", { name: EN.tabs.documentTabsLabel }),
    ).toBeTruthy();
    expect(
      screen.getByRole("toolbar", {
        name: CANVAS_MESSAGES.en.toolbar.label,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: CANVAS_MESSAGES.en.align.menuButton }),
    ).toBeTruthy();
  });
});
