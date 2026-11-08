// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_D,
  FOLDER_1,
  FOLDER_2,
  seedFolderTree,
} from "../../application/test-support/workspace-harness";
import {
  renderShell,
  type ShellHarness,
  treeItemNamed,
} from "./test-support/shell-harness";
import {
  dragTreeRow,
  yBelowRows,
  yOnRow,
} from "./test-support/tree-drag-helpers";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const MESSAGES = WORKSPACE_MESSAGES.ja;
const TREE = MESSAGES.tree;

afterEach(() => {
  cleanup();
});

async function openedShell(): Promise<ShellHarness> {
  const harness = await renderShell({
    seed: (seeded) => seedFolderTree(seeded.gateway),
  });
  await harness.openProjectInUi();
  harness.gateway.clearCalls();
  return harness;
}

const selected = (name: string) =>
  treeItemNamed(name).getAttribute("aria-selected");
const expanded = (name: string) =>
  treeItemNamed(name).getAttribute("aria-expanded");
const level = (name: string) => treeItemNamed(name).getAttribute("aria-level");
const toolbarButtonNames = () =>
  within(screen.getByRole("toolbar", { name: TREE.toolbarLabel }))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
const treeArea = () => {
  const area = document.querySelector<HTMLElement>(".project-tree-area");
  if (area === null) throw new Error("no tree area");
  return area;
};
const menuItemNames = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);

describe("selection in the Project Tree", () => {
  it("selects a folder on click (which also folds it), and new entries go into it", async () => {
    const harness = await openedShell();
    await harness.user.click(
      within(treeItemNamed("Folder 2")).getByText("Folder 2"),
    );
    expect(selected("Folder 2")).toBe("true");
    expect(expanded("Folder 2")).toBe("false");
    expect(toolbarButtonNames()).toEqual([
      TREE.createFolderIn("Folder 2"),
      TREE.createDocumentIn("Folder 2"),
    ]);
  });

  it("clears the selection on a click in the empty space; new entries then go to the top level", async () => {
    const harness = await openedShell();
    await harness.user.click(
      within(treeItemNamed("Folder 2")).getByText("Folder 2"),
    );
    await harness.user.click(treeArea());
    expect(
      screen
        .getAllByRole("treeitem")
        .filter((item) => item.getAttribute("aria-selected") === "true"),
    ).toEqual([]);
    expect(toolbarButtonNames()).toEqual([
      TREE.createFolderIn("Project"),
      TREE.createDocumentIn("Project"),
    ]);
  });

  it("follows the active Document", async () => {
    const harness = await openedShell();
    await act(async () => {
      await harness.actions.openDocument(DOCUMENT_D);
    });
    expect(selected("Document D")).toBe("true");
    await act(async () => {
      await harness.actions.openDocument(DOCUMENT_A);
    });
    expect(selected("Document A")).toBe("true");
    expect(selected("Document D")).toBe("false");
  });
});

describe("the empty space of the tree", () => {
  it("offers to create a folder or a Document at the top level on a right-click", async () => {
    const harness = await openedShell();
    await harness.user.pointer({ keys: "[MouseRight]", target: treeArea() });
    const menu = screen.getByRole("menu");
    expect(menuItemNames(menu)).toEqual([
      TREE.createFolder,
      TREE.createDocument,
    ]);
    await harness.user.click(
      within(menu).getByRole("menuitem", { name: TREE.createFolder }),
    );
    const dialog = screen.getByRole("dialog", {
      name: MESSAGES.dialogs.createFolder.title,
    });
    await harness.user.type(
      within(dialog).getByRole("textbox", {
        name: MESSAGES.dialogs.createFolder.nameLabel,
      }),
      "Top{Enter}",
    );
    await waitFor(() => expect(level("Top")).toBe("2"));
  });
});

describe("dragging rows between folders", () => {
  it("moves a Document into a folder dropped on, and out to the top level on the empty space", async () => {
    const harness = await openedShell();
    await dragTreeRow(harness.user, "Document A", yOnRow("Folder 2", 0.6));
    await waitFor(() =>
      expect(harness.gateway.disk.documentParents.get(DOCUMENT_A)).toBe(
        FOLDER_2,
      ),
    );
    expect(level("Document A")).toBe("4");

    await dragTreeRow(harness.user, "Document A", yBelowRows());
    await waitFor(() =>
      expect(
        harness.gateway.disk.documentParents.get(DOCUMENT_A) ?? null,
      ).toBeNull(),
    );
    expect(level("Document A")).toBe("2");
  });

  it("puts a moved Document in front of the row it is dropped on in another folder", async () => {
    const harness = await openedShell();
    await dragTreeRow(harness.user, "Document A", yOnRow("Document D", 0.1));
    await waitFor(() =>
      expect(harness.gateway.disk.documentParents.get(DOCUMENT_A)).toBe(
        FOLDER_2,
      ),
    );
    await waitFor(() =>
      expect(
        harness.store
          .getState()
          .project?.folders.find((folder) => folder.folderId === FOLDER_2)
          ?.childOrder,
      ).toEqual([DOCUMENT_A, DOCUMENT_D]),
    );
  });

  it("does not drop a folder into its own folder", async () => {
    const harness = await openedShell();
    await dragTreeRow(harness.user, "Folder 1", yOnRow("Folder 2", 0.6), false);
    expect(
      document.querySelectorAll('[class*="tree-item--drop-"]'),
    ).toHaveLength(0);
    await dragTreeRow(harness.user, "Folder 1", yOnRow("Folder 2", 0.6));
    expect(harness.gateway.calls).toEqual([]);
    expect(level("Folder 1")).toBe("2");
    expect(harness.store.getState().project?.project.childOrder[0]).toBe(
      FOLDER_1,
    );
  });
});

describe("the sidebar", () => {
  it("folds away and comes back", async () => {
    const harness = await openedShell();
    await harness.user.click(
      screen.getByRole("button", { name: MESSAGES.leftPanel.collapseSidebar }),
    );
    expect(screen.queryByRole("tree")).toBeNull();
    await harness.user.click(
      screen.getByRole("button", { name: MESSAGES.leftPanel.expandSidebar }),
    );
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});

describe("without a Project", () => {
  it("offers to create or open one in the tree's right-click menu and on the main panel", async () => {
    const harness = await renderShell();
    await harness.user.pointer({ keys: "[MouseRight]", target: treeArea() });
    const menu = screen.getByRole("menu");
    expect(menuItemNames(menu)).toEqual([
      MESSAGES.topBar.createProject,
      MESSAGES.topBar.openProject,
    ]);
    await harness.user.keyboard("{Escape}");

    const main = screen.getByRole("main");
    await harness.user.click(
      within(main).getByRole("button", { name: MESSAGES.topBar.createProject }),
    );
    expect(
      screen.getByRole("dialog", {
        name: MESSAGES.dialogs.createProject.title,
      }),
    ).toBeTruthy();
    await harness.user.keyboard("{Escape}");

    await harness.user.click(
      within(main).getByRole("button", { name: MESSAGES.topBar.openProject }),
    );
    await screen.findByRole("tree");
  });
});

describe("a Document without Sheets", () => {
  it("offers a button under the message that creates the first Sheet", async () => {
    const harness = await openedShell();
    await act(async () => {
      await harness.actions.createDocument("Empty");
    });
    // The Sheet area (no Sheet tab is active, so it is named after the area).
    const sheetArea = await screen.findByRole("tabpanel", {
      name: MESSAGES.tabs.sheetPanelLabel,
    });
    const create = within(sheetArea).getByRole("button", {
      name: MESSAGES.tabs.createSheet,
    });
    await harness.user.click(create);
    const dialog = screen.getByRole("dialog", {
      name: MESSAGES.dialogs.createSheet.title,
    });
    await harness.user.type(
      within(dialog).getByRole("textbox", {
        name: MESSAGES.dialogs.createSheet.nameLabel,
      }),
      "First{Enter}",
    );
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("tablist", { name: MESSAGES.tabs.sheetTabsLabel }),
        ).getAllByRole("tab"),
      ).toHaveLength(1),
    );
  });
});
