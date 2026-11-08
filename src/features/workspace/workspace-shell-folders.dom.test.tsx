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
  applyOutsideUi,
  chooseRowMenuItem,
  openRowMenu,
  renderShell,
  type ShellHarness,
  treeItemNamed,
} from "./test-support/shell-harness";
import { dragTreeRow, yOnRow } from "./test-support/tree-drag-helpers";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const MESSAGES = WORKSPACE_MESSAGES.ja;

afterEach(() => {
  cleanup();
});

const CTRL_UP = "{Control>}{ArrowUp}{/Control}";
const CTRL_DOWN = "{Control>}{ArrowDown}{/Control}";
const TREE = MESSAGES.tree;

async function openedShell(): Promise<ShellHarness> {
  const harness = await renderShell({
    seed: (seeded) => seedFolderTree(seeded.gateway),
  });
  await harness.openProjectInUi();
  harness.gateway.clearCalls();
  return harness;
}

// Labels of the visible tree rows in display order.
function treeLabels(): string[] {
  return screen
    .getAllByRole("treeitem")
    .map(
      (item) =>
        item.querySelector(":scope > .tree-item__row > .tree-item__label")
          ?.textContent ?? "",
    );
}

const level = (name: string) => treeItemNamed(name).getAttribute("aria-level");
const expanded = (name: string) =>
  treeItemNamed(name).getAttribute("aria-expanded");

const menuItemNames = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);

const menuItem = (menu: HTMLElement, name: string) =>
  within(menu).getByRole("menuitem", { name });

describe("folder rows", () => {
  it("shows folders with their documents nested, with tree semantics", async () => {
    await openedShell();
    expect(treeLabels()).toEqual([
      "Project",
      "Folder 1",
      "Folder 2",
      "Document D",
      "Document C",
      "Document A",
      "Document B",
    ]);
    expect(level("Project")).toBe("1");
    expect(level("Folder 1")).toBe("2");
    expect(level("Document A")).toBe("2");
    expect(level("Folder 2")).toBe("3");
    expect(level("Document C")).toBe("3");
    expect(level("Document D")).toBe("4");
    // Folders are expanded by default; documents have no children, so no aria-expanded.
    expect(expanded("Folder 1")).toBe("true");
    expect(expanded("Folder 2")).toBe("true");
    expect(expanded("Document A")).toBeNull();
    // Nested items live in role="group" lists.
    expect(
      within(treeItemNamed("Folder 1")).getAllByRole("group").length,
    ).toBeGreaterThan(0);
  });

  it("folds and unfolds by clicking the row, without persisting anything", async () => {
    const harness = await openedShell();
    harness.gateway.clearCalls();
    await harness.user.click(
      within(treeItemNamed("Folder 1")).getByText("Folder 1"),
    );
    expect(expanded("Folder 1")).toBe("false");
    expect(treeLabels()).toEqual([
      "Project",
      "Folder 1",
      "Document A",
      "Document B",
    ]);
    await harness.user.click(
      within(treeItemNamed("Folder 1")).getByText("Folder 1"),
    );
    expect(expanded("Folder 1")).toBe("true");
    expect(treeLabels()).toContain("Document D");
    expect(harness.gateway.calls).toEqual([]);
  });

  it("folds with ArrowLeft, unfolds with ArrowRight, and moves into and out of a folder", async () => {
    const harness = await openedShell();
    treeItemNamed("Folder 2").focus();
    await harness.user.keyboard("{ArrowLeft}");
    expect(expanded("Folder 2")).toBe("false");
    expect(screen.queryByRole("treeitem", { name: "Document D" })).toBeNull();
    // Collapsed: ArrowLeft goes to the parent.
    await harness.user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(treeItemNamed("Folder 1"));
    // Expanded: ArrowLeft folds it; ArrowRight unfolds it again.
    await harness.user.keyboard("{ArrowLeft}");
    expect(expanded("Folder 1")).toBe("false");
    await harness.user.keyboard("{ArrowRight}");
    expect(expanded("Folder 1")).toBe("true");
    // Expanded: ArrowRight moves to the first child.
    await harness.user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(treeItemNamed("Folder 2"));
    // Home / End still span the visible rows.
    await harness.user.keyboard("{End}");
    expect(document.activeElement).toBe(treeItemNamed("Document B"));
    await harness.user.keyboard("{Home}");
    expect(document.activeElement).toBe(treeItemNamed("Project"));
  });

  it("toggles with Enter", async () => {
    const harness = await openedShell();
    treeItemNamed("Folder 2").focus();
    await harness.user.keyboard("{Enter}");
    expect(expanded("Folder 2")).toBe("false");
    await harness.user.keyboard("{Enter}");
    expect(expanded("Folder 2")).toBe("true");
  });
});

describe("row menus", () => {
  it("offers the project folder and document creation", async () => {
    const harness = await openedShell();
    const menu = await openRowMenu(harness.user, "Project");
    expect(menuItemNames(menu)).toEqual([
      TREE.createFolder,
      TREE.createDocument,
      TREE.openProjectInNewWindow,
    ]);
  });

  it("offers a folder every action, and delete only when it is empty", async () => {
    const harness = await openedShell();
    const menu = await openRowMenu(harness.user, "Folder 1");
    expect(menuItemNames(menu)).toEqual([
      TREE.createFolder,
      TREE.createDocument,
      TREE.rename,
      TREE.moveTo,
      TREE.deleteFolder,
    ]);
    const remove = menuItem(menu, TREE.deleteFolder);
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.getAttribute("title")).toBe(TREE.deleteFolderNotEmptyHint);
    // Choosing the disabled item does nothing.
    await harness.user.click(remove);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a document the move item", async () => {
    const harness = await openedShell();
    const menu = await openRowMenu(harness.user, "Document A");
    expect(menuItemNames(menu)).toEqual([
      TREE.rename,
      TREE.moveTo,
      TREE.createSheet,
      TREE.deleteDocument,
    ]);
    expect(menuItem(menu, TREE.moveTo).getAttribute("aria-disabled")).toBe(
      null,
    );
  });

  it("enables the move item of an open document and of a folder holding one", async () => {
    const harness = await openedShell();
    await applyOutsideUi(async () => {
      await harness.actions.openDocument(DOCUMENT_D);
    });
    const documentMenu = await openRowMenu(harness.user, "Document D");
    const documentMove = menuItem(documentMenu, TREE.moveTo);
    expect(documentMove.getAttribute("aria-disabled")).toBe(null);
    expect(documentMove.getAttribute("title")).toBe(null);
    await harness.user.keyboard("{Escape}");
    const folderMenu = await openRowMenu(harness.user, "Folder 1");
    const folderMove = menuItem(folderMenu, TREE.moveTo);
    expect(folderMove.getAttribute("aria-disabled")).toBe(null);
    await harness.user.click(folderMove);
    expect(screen.getByRole("dialog", { name: /Folder 1/ })).toBeTruthy();
  });
});

describe("creating and renaming", () => {
  it("creates a folder inside a folder through the name dialog", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Folder 2", TREE.createFolder);
    const dialog = screen.getByRole("dialog", {
      name: MESSAGES.dialogs.createFolder.title,
    });
    await harness.user.type(
      within(dialog).getByRole("textbox", {
        name: MESSAGES.dialogs.createFolder.nameLabel,
      }),
      "Inner{Enter}",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(level("Inner")).toBe("4");
    expect(treeLabels().indexOf("Inner")).toBeGreaterThan(
      treeLabels().indexOf("Folder 2"),
    );
    expect(harness.gateway.methods()).toEqual(["createFolder", "saveFolder"]);
  });

  it("creates a document in a folder and opens it", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Folder 1", TREE.createDocument);
    const dialog = screen.getByRole("dialog", {
      name: MESSAGES.dialogs.createDocument.title,
    });
    await harness.user.type(
      within(dialog).getByRole("textbox", {
        name: MESSAGES.dialogs.createDocument.nameLabel,
      }),
      "Nested{Enter}",
    );
    await screen.findByRole("tab", { name: /Nested/ });
    expect(level("Nested")).toBe("3");
  });

  it("renames a folder inline with F2 and Enter, saving its file", async () => {
    const harness = await openedShell();
    treeItemNamed("Folder 1").focus();
    await harness.user.keyboard("{F2}");
    const input = screen.getByRole("textbox", {
      name: "Folder 1の名前を変更",
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Folder 1");
    await harness.user.keyboard("Renamed{Enter}");
    await screen.findByRole("treeitem", { name: "Renamed" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(harness.gateway.disk.folders.get(FOLDER_1)?.folder.name).toBe(
      "Renamed",
    );
    expect(document.activeElement).toBe(treeItemNamed("Renamed"));
  });

  it("cancels a folder rename with Escape and from the menu starts it too", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Folder 2", TREE.rename);
    await harness.user.keyboard("Other{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(treeItemNamed("Folder 2")).toBeTruthy();
    expect(harness.gateway.methods("saveFolder")).toEqual([]);
  });
});

describe("toolbar buttons that create where the cursor is", () => {
  const toolbarButton = (name: string) =>
    within(screen.getByRole("toolbar", { name: TREE.toolbarLabel })).getByRole(
      "button",
      { name },
    );

  function putCursorOn(name: string): void {
    act(() => treeItemNamed(name).focus());
  }

  async function submitName(
    harness: ShellHarness,
    dialogs: { readonly title: string; readonly nameLabel: string },
    name: string,
  ): Promise<void> {
    const dialog = screen.getByRole("dialog", { name: dialogs.title });
    await harness.user.type(
      within(dialog).getByRole("textbox", { name: dialogs.nameLabel }),
      `${name}{Enter}`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  it("creates a folder inside the folder the cursor is on", async () => {
    const harness = await openedShell();
    putCursorOn("Folder 2");
    await harness.user.click(toolbarButton(TREE.createFolderIn("Folder 2")));
    await submitName(harness, MESSAGES.dialogs.createFolder, "Inner");
    expect(level("Inner")).toBe("4");
    expect(harness.gateway.methods()).toEqual(["createFolder", "saveFolder"]);
  });

  it("creates a document next to the document the cursor is on, in its folder", async () => {
    const harness = await openedShell();
    putCursorOn("Document D");
    await harness.user.click(toolbarButton(TREE.createDocumentIn("Folder 2")));
    await submitName(harness, MESSAGES.dialogs.createDocument, "Sibling");
    await screen.findByRole("tab", { name: /Sibling/ });
    expect(level("Sibling")).toBe(level("Document D"));
  });

  it("creates at the top level from the Project row", async () => {
    const harness = await openedShell();
    putCursorOn("Project");
    await harness.user.click(toolbarButton(TREE.createFolderIn("Project")));
    await submitName(harness, MESSAGES.dialogs.createFolder, "Top");
    expect(level("Top")).toBe("2");
  });

  it("shows an icon on every row without changing the row names", async () => {
    await openedShell();
    for (const item of screen.getAllByRole("treeitem")) {
      expect(
        item.querySelectorAll(":scope > .tree-item__row svg.tree-icon"),
      ).toHaveLength(1);
    }
    expect(treeItemNamed("Folder 1")).toBeTruthy();
  });
});

describe("reordering", () => {
  it("moves a folder down and up among mixed siblings with Ctrl+Arrow, saving the project", async () => {
    const harness = await openedShell();
    treeItemNamed("Folder 1").focus();
    await harness.user.keyboard(CTRL_DOWN);
    await waitFor(() =>
      expect(
        treeLabels().filter((l) => /^(Folder 1|Document [AB])$/.test(l)),
      ).toEqual(["Document A", "Folder 1", "Document B"]),
    );
    expect(harness.gateway.disk.childOrder).toEqual([
      DOCUMENT_A,
      FOLDER_1,
      harness.store.getState().project?.project.childOrder[2],
    ]);
    await harness.user.keyboard(CTRL_UP);
    await waitFor(() => expect(treeLabels()[1]).toBe("Folder 1"));
  });

  it("moves a nested document by dragging it in front of its sibling, saving its folder", async () => {
    const harness = await openedShell();
    await dragTreeRow(harness.user, "Document C", yOnRow("Folder 2", 0.1));
    await waitFor(() =>
      expect(treeLabels().indexOf("Document C")).toBeLessThan(
        treeLabels().indexOf("Folder 2"),
      ),
    );
    expect(harness.gateway.methods("saveFolder")).toHaveLength(1);
  });
});

describe("moving to another place", () => {
  const MOVE = MESSAGES.dialogs.moveEntry;

  it("lists the folders as a tree, disabling the current parent, and moves the document there", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Document A", TREE.moveTo);
    const dialog = screen.getByRole("dialog", { name: /Document A/ });
    const rows = within(dialog).getAllByRole("treeitem");
    expect(
      rows.map((row) => [
        row.textContent,
        row.getAttribute("aria-level"),
        row.getAttribute("aria-disabled"),
      ]),
    ).toEqual([
      [`▾${MOVE.projectRoot}`, "1", "true"],
      ["▾Folder 1", "2", null],
      ["Folder 2", "3", null],
    ]);
    expect(rows[0]?.getAttribute("title")).toBe(MOVE.currentParentHint);
    // The first possible target starts highlighted and focused.
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(rows[1]);

    await harness.user.click(within(dialog).getByText("Folder 2"));
    await harness.user.click(
      within(dialog).getByRole("button", { name: MOVE.choose }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(level("Document A")).toBe("4");
    expect(harness.gateway.disk.documentParents.get(DOCUMENT_A)).toBe(FOLDER_2);
    expect(harness.gateway.methods()).toEqual([
      "moveEntry",
      "saveFolder",
      "saveProject",
    ]);
  });

  it("disables the folder itself and its descendants as targets of a folder", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Folder 1", TREE.moveTo);
    const dialog = screen.getByRole("dialog", { name: /Folder 1/ });
    const rows = within(dialog).getAllByRole("treeitem");
    expect(rows.map((row) => row.getAttribute("aria-disabled"))).toEqual([
      "true",
      "true",
      "true",
    ]);
    expect(rows[1]?.getAttribute("title")).toBe(MOVE.selfOrDescendantHint);
    // Nothing can be chosen, by button, Enter or double-click.
    const choose = within(dialog).getByRole("button", { name: MOVE.choose });
    expect((choose as HTMLButtonElement).disabled).toBe(true);
    await harness.user.dblClick(rows[2] as HTMLElement);
    rows[1]?.focus();
    await harness.user.keyboard("{Enter}");
    expect(harness.gateway.methods("moveEntry")).toEqual([]);
  });

  it("closes without moving on Cancel", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Document A", TREE.moveTo);
    await harness.user.click(
      screen.getByRole("button", { name: MESSAGES.dialogs.cancel }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(harness.gateway.methods("moveEntry")).toEqual([]);
  });
});

describe("deleting a folder", () => {
  it("asks for confirmation, then deletes the empty folder", async () => {
    const harness = await openedShell();
    await applyOutsideUi(async () => {
      await harness.workspace.deleteDocument(DOCUMENT_D, {
        confirmedByUser: true,
      });
    });
    const menu = await openRowMenu(harness.user, "Folder 2");
    expect(
      menuItem(menu, TREE.deleteFolder).getAttribute("aria-disabled"),
    ).toBe(null);
    await harness.user.click(menuItem(menu, TREE.deleteFolder));
    const dialog = screen.getByRole("dialog", { name: /Folder 2/ });
    expect(dialog.textContent).toContain(MESSAGES.dialogs.undoNotice);
    // Focus starts on Cancel, so Enter right away deletes nothing.
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: MESSAGES.dialogs.cancel }),
    );
    await harness.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.dialogs.delete }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("treeitem", { name: "Folder 2" })).toBeNull(),
    );
    expect(harness.gateway.disk.folders.has(FOLDER_2)).toBe(false);
  });

  it("shows a refused deletion in the notifications", async () => {
    const harness = await openedShell();
    await applyOutsideUi(async () => {
      await harness.workspace.deleteDocument(DOCUMENT_D, {
        confirmedByUser: true,
      });
    });
    harness.gateway.failOn("deleteFolder", "ioError");
    await chooseRowMenuItem(harness.user, "Folder 2", TREE.deleteFolder);
    await harness.user.click(
      screen.getByRole("button", { name: MESSAGES.dialogs.delete }),
    );
    await waitFor(() =>
      expect(screen.getByText(/フォルダを削除できませんでした/)).toBeTruthy(),
    );
    expect(screen.getByRole("treeitem", { name: "Folder 2" })).toBeTruthy();
  });
});

describe("the right-click menu of the tree", () => {
  async function rightClick(
    harness: ShellHarness,
    name: string,
  ): Promise<HTMLElement> {
    const row = treeItemNamed(name).querySelector(".tree-item__label");
    if (row === null) throw new Error(`no label for ${name}`);
    await harness.user.pointer({ keys: "[MouseRight]", target: row });
    return screen.getByRole("menu", { name: MESSAGES.treeMenuLabel(name) });
  }

  it("offers the row's own menu on a folder and makes it the focused row", async () => {
    const harness = await openedShell();
    const names = menuItemNames(await rightClick(harness, "Folder 2"));
    await harness.user.keyboard("{Escape}");
    expect(document.activeElement).toBe(treeItemNamed("Folder 2"));
    expect(names).toEqual(
      menuItemNames(await openRowMenu(harness.user, "Folder 2")),
    );
  });

  it("creates a document beside the right-clicked document, in its folder", async () => {
    const harness = await openedShell();
    const menu = await rightClick(harness, "Document D");
    // A document's menu makes another document beside it, but no folder.
    expect(menuItemNames(menu)[0]).toBe(TREE.createDocument);
    expect(menuItemNames(menu)).not.toContain(TREE.createFolder);
    await harness.user.click(menuItem(menu, TREE.createDocument));
    const dialog = screen.getByRole("dialog", {
      name: MESSAGES.dialogs.createDocument.title,
    });
    await harness.user.type(
      within(dialog).getByRole("textbox", {
        name: MESSAGES.dialogs.createDocument.nameLabel,
      }),
      "Sibling{Enter}",
    );
    await screen.findByRole("tab", { name: /Sibling/ });
    expect(level("Sibling")).toBe(level("Document D"));
  });

  it("opens the nearest row's menu only, and Escape gives focus back", async () => {
    const harness = await openedShell();
    await rightClick(harness, "Document D");
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    await harness.user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(treeItemNamed("Document D"));
  });
});
