// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderShell,
  type ShellHarness,
  treeItemNamed,
} from "./test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const MESSAGES = WORKSPACE_MESSAGES.ja;

afterEach(() => {
  cleanup();
});

async function withDocumentA(): Promise<ShellHarness> {
  const harness = await renderShell();
  await harness.openProjectInUi();
  await harness.user.click(
    within(treeItemNamed("Document A")).getByText("Document A"),
  );
  await screen.findByRole("tab", { name: /Document A/ });
  return harness;
}

const tabIn = (listName: string, name: string | RegExp) =>
  within(screen.getByRole("tablist", { name: listName })).getByRole("tab", {
    name,
  });
const sheetTabNames = () =>
  within(screen.getByRole("tablist", { name: "Sheet Tabs" }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent);

function openMenuOn(tab: HTMLElement, name: string): HTMLElement {
  fireEvent.contextMenu(tab, { clientX: 1, clientY: 1, button: 2 });
  return screen.getByRole("menu", { name: MESSAGES.tabMenuLabel(name) });
}

const itemNames = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);

describe("the right-click menu of a Sheet tab", () => {
  it("moves the sheet, disabling the move past either end", async () => {
    const harness = await withDocumentA();
    const menu = openMenuOn(tabIn("Sheet Tabs", "Sheet A1"), "Sheet A1");
    expect(itemNames(menu)).toEqual([
      MESSAGES.tree.rename,
      MESSAGES.tabs.moveLeft,
      MESSAGES.tabs.moveRight,
      MESSAGES.tabs.createSheet,
      MESSAGES.tabs.deleteSheet,
    ]);
    expect(
      within(menu)
        .getByRole("menuitem", { name: MESSAGES.tabs.moveLeft })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    await harness.user.click(
      within(menu).getByRole("menuitem", { name: MESSAGES.tabs.moveRight }),
    );
    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]),
    );
  });

  it("asks before deleting the sheet", async () => {
    const harness = await withDocumentA();
    const menu = openMenuOn(tabIn("Sheet Tabs", "Sheet A2"), "Sheet A2");
    await harness.user.click(
      within(menu).getByRole("menuitem", { name: MESSAGES.tabs.deleteSheet }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("starts renaming the sheet in place", async () => {
    const harness = await withDocumentA();
    const menu = openMenuOn(tabIn("Sheet Tabs", "Sheet A1"), "Sheet A1");
    await harness.user.click(
      within(menu).getByRole("menuitem", { name: MESSAGES.tree.rename }),
    );
    expect(
      screen.getByRole("textbox", {
        name: MESSAGES.renameInputLabel("Sheet A1"),
      }),
    ).toBeTruthy();
  });
});

describe("the right-click menu of a Document tab", () => {
  it("closes the document", async () => {
    const harness = await withDocumentA();
    const menu = openMenuOn(tabIn("Document Tabs", /Document A/), "Document A");
    await harness.user.click(
      within(menu).getByRole("menuitem", { name: MESSAGES.tabs.close }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: /Document A/ })).toBeNull(),
    );
  });

  it("opens the create-sheet dialog for that document", async () => {
    const harness = await withDocumentA();
    const menu = openMenuOn(tabIn("Document Tabs", /Document A/), "Document A");
    await harness.user.click(
      within(menu).getByRole("menuitem", { name: MESSAGES.tabs.createSheet }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
