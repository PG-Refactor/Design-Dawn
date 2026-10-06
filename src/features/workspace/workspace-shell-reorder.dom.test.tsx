// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  FAILED_SHEET_ID,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import { reopenedWorkspace, undoDepth } from "./test-support/actions-harness";
import {
  chooseRowMenuItem,
  openRowMenu,
  renderShell,
  type ShellHarness,
  treeItemNamed,
} from "./test-support/shell-harness";
import { MESSAGES } from "./workspace-messages";

afterEach(() => {
  cleanup();
});

const UNDO_KEYS = "{Control>}z{/Control}";
const REDO_KEYS = "{Control>}{Shift>}z{/Shift}{/Control}";
const CTRL_UP = "{Control>}{ArrowUp}{/Control}";
const CTRL_DOWN = "{Control>}{ArrowDown}{/Control}";
const UNNAMED = MESSAGES.tree.unnamedEntity;

// Labels of every tree row in display order.
function treeLabels(): string[] {
  return screen
    .getAllByRole("treeitem")
    .map(
      (item) =>
        item.querySelector(":scope > .tree-item__row > .tree-item__label")
          ?.textContent ?? "",
    );
}

const documentRowLabels = () =>
  treeLabels().filter((label) => label.startsWith("Document"));

const sheetTabNames = () =>
  within(screen.getByRole("tablist", { name: "Sheet Tabs" }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent);
const documentTabNames = () =>
  within(screen.getByRole("tablist", { name: "Document Tabs" }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent?.replace(/保存.*|未保存/, "").trim());

const storedDocumentOrder = (harness: ShellHarness) =>
  harness.store.getState().project?.project.childOrder;
const storedSheetOrder = (harness: ShellHarness) =>
  harness.store.getState().documents.get(DOCUMENT_A)?.document.sheetOrder;

async function openedShell(): Promise<ShellHarness> {
  const harness = await renderShell();
  await harness.openProjectInUi();
  return harness;
}

async function openDocumentByClick(harness: ShellHarness, name: string) {
  await harness.user.click(within(treeItemNamed(name)).getByText(name));
  await screen.findByRole("tab", { name: new RegExp(name) });
}

const menuItemOf = (menu: HTMLElement, name: string) =>
  within(menu).getByRole("menuitem", { name });

describe("document reorder", () => {
  it("moves up and down from the menu, saves the project, and creates no undo entry", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    expect(
      treeLabels().filter((label) => label.startsWith("Document")),
    ).toEqual(["Document A", "Document B"]);
    harness.gateway.clearCalls();

    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveUp);

    await waitFor(() =>
      expect(storedDocumentOrder(harness)).toEqual([
        DOCUMENT_B,
        DOCUMENT_A,
        FAILED_DOCUMENT_ID,
      ]),
    );
    expect(treeLabels()).toEqual([
      "Project",
      "Document B",
      "Document A",
      "Sheet A1",
      "Sheet A2",
      UNNAMED,
      UNNAMED,
    ]);
    expect(harness.gateway.methods("saveProject")).toEqual(["saveProject"]);
    expect(await undoDepth(harness)).toBe(0);

    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveDown);
    await waitFor(() =>
      expect(storedDocumentOrder(harness)).toEqual([
        DOCUMENT_A,
        DOCUMENT_B,
        FAILED_DOCUMENT_ID,
      ]),
    );
    expect(harness.gateway.methods("saveProject")).toHaveLength(2);
    expect(await undoDepth(harness)).toBe(0);
  });

  it("moves with Ctrl+Arrow and keeps focus on the moved row", async () => {
    const harness = await openedShell();
    treeItemNamed("Document B").focus();

    await harness.user.keyboard(CTRL_UP);
    await waitFor(() =>
      expect(storedDocumentOrder(harness)?.[0]).toBe(DOCUMENT_B),
    );
    expect(document.activeElement).toBe(treeItemNamed("Document B"));

    await harness.user.keyboard(CTRL_DOWN);
    await waitFor(() =>
      expect(storedDocumentOrder(harness)?.[0]).toBe(DOCUMENT_A),
    );
    expect(document.activeElement).toBe(treeItemNamed("Document B"));
    // Ctrl+Arrow moves the entry; it never moves the focus.
    expect(harness.gateway.methods("saveProject")).toHaveLength(2);
  });

  it("is a no-op at the boundaries: items are disabled, nothing is saved", async () => {
    const harness = await openedShell();
    harness.gateway.clearCalls();

    const menu = await openRowMenu(harness.user, "Document A");
    const up = menuItemOf(menu, MESSAGES.tree.moveUp);
    expect(up.getAttribute("aria-disabled")).toBe("true");
    expect(
      menuItemOf(menu, MESSAGES.tree.moveDown).getAttribute("aria-disabled"),
    ).toBeNull();
    await harness.user.click(up);
    await harness.user.keyboard("{Escape}");

    treeItemNamed("Document A").focus();
    await harness.user.keyboard(CTRL_UP);

    // Document B down, then it is last: down is disabled and a no-op.
    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveDown);
    await waitFor(() =>
      expect(harness.gateway.methods("saveProject")).toHaveLength(1),
    );
    const lastMenu = await openRowMenu(harness.user, "Document B");
    expect(
      menuItemOf(lastMenu, MESSAGES.tree.moveDown).getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
    await harness.user.keyboard("{Escape}");
    treeItemNamed("Document B").focus();
    await harness.user.keyboard(CTRL_DOWN);

    expect(harness.gateway.methods("saveProject")).toHaveLength(1);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("moves past a document that failed to load, which keeps its place and cannot be moved", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveDown);
    await waitFor(() =>
      expect(storedDocumentOrder(harness)).toEqual([
        DOCUMENT_A,
        FAILED_DOCUMENT_ID,
        DOCUMENT_B,
      ]),
    );
    expect(treeLabels()).toEqual([
      "Project",
      "Document A",
      UNNAMED,
      "Document B",
    ]);

    const failed = treeItemNamed(/読み込み失敗/);
    const menu = await openRowMenu(harness.user, failed);
    for (const name of [
      MESSAGES.tree.rename,
      MESSAGES.tree.moveUp,
      MESSAGES.tree.moveDown,
    ]) {
      expect(menuItemOf(menu, name).getAttribute("aria-disabled")).toBe("true");
    }
    expect(
      menuItemOf(menu, MESSAGES.tree.deleteDocument).getAttribute(
        "aria-disabled",
      ),
    ).toBeNull();
    await harness.user.keyboard("{Escape}");
    harness.gateway.clearCalls();
    failed.focus();
    await harness.user.keyboard(CTRL_UP + CTRL_DOWN);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("leaves the order of the Document Tabs (opening order) alone", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await openDocumentByClick(harness, "Document B");
    expect(documentTabNames()).toEqual(["Document A", "Document B"]);

    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveUp);
    await waitFor(() =>
      expect(documentRowLabels()).toEqual(["Document B", "Document A"]),
    );
    expect(documentTabNames()).toEqual(["Document A", "Document B"]);
  });

  it("works for open and unopened documents without opening anything", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveUp);
    await waitFor(() =>
      expect(storedDocumentOrder(harness)?.[0]).toBe(DOCUMENT_B),
    );
    expect(harness.store.getState().documents.size).toBe(0);
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("is saved at once: a new workspace over the same disk has the order", async () => {
    const harness = await openedShell();
    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveUp);
    await waitFor(() =>
      expect(harness.gateway.methods("saveProject")).toHaveLength(1),
    );

    const { store } = await reopenedWorkspace(harness);
    expect(store.getState().project?.project.childOrder).toEqual([
      DOCUMENT_B,
      DOCUMENT_A,
      FAILED_DOCUMENT_ID,
    ]);
  });

  it("reports a failed save as an operation error", async () => {
    const harness = await openedShell();
    harness.gateway.failOn("saveProject", "ioError");
    await chooseRowMenuItem(harness.user, "Document B", MESSAGES.tree.moveUp);
    await waitFor(() =>
      expect(harness.uiStateStore.getState().operationErrors).toMatchObject([
        { operation: "moveDocument", error: { kind: "ioError" } },
      ]),
    );
  });
});

describe("sheet reorder", () => {
  async function withDocumentA() {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
    return harness;
  }

  it("moves up and down from the menu; tree and tabs follow; undo and redo work", async () => {
    const harness = await withDocumentA();

    await chooseRowMenuItem(harness.user, "Sheet A2", MESSAGES.tree.moveUp);

    await waitFor(() =>
      expect(storedSheetOrder(harness)).toEqual([
        SHEET_A2,
        SHEET_A1,
        FAILED_SHEET_ID,
      ]),
    );
    expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]);
    expect(treeLabels().slice(2, 5)).toEqual(["Sheet A2", "Sheet A1", UNNAMED]);
    expect(await undoDepth(harness)).toBe(1);

    treeItemNamed("Sheet A2").focus();
    await harness.user.keyboard(UNDO_KEYS);
    await waitFor(() =>
      expect(storedSheetOrder(harness)).toEqual([
        SHEET_A1,
        SHEET_A2,
        FAILED_SHEET_ID,
      ]),
    );
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);

    await harness.user.keyboard(REDO_KEYS);
    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]),
    );

    await chooseRowMenuItem(harness.user, "Sheet A2", MESSAGES.tree.moveDown);
    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]),
    );
  });

  it("moves with Ctrl+Arrow and keeps focus on the moved sheet", async () => {
    const harness = await withDocumentA();
    treeItemNamed("Sheet A1").focus();

    await harness.user.keyboard(CTRL_DOWN);

    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]),
    );
    expect(document.activeElement).toBe(treeItemNamed("Sheet A1"));
    await harness.user.keyboard(CTRL_UP);
    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]),
    );
    expect(document.activeElement).toBe(treeItemNamed("Sheet A1"));
    expect(await undoDepth(harness)).toBe(2);
  });

  it("is a no-op at the boundaries: disabled items, no command, no history", async () => {
    const harness = await withDocumentA();
    harness.gateway.clearCalls();

    const menu = await openRowMenu(harness.user, "Sheet A1");
    const up = menuItemOf(menu, MESSAGES.tree.moveUp);
    expect(up.getAttribute("aria-disabled")).toBe("true");
    await harness.user.click(up);
    await harness.user.keyboard("{Escape}");
    treeItemNamed("Sheet A1").focus();
    await harness.user.keyboard(CTRL_UP);

    expect(await undoDepth(harness)).toBe(0);
    expect(storedSheetOrder(harness)).toEqual([
      SHEET_A1,
      SHEET_A2,
      FAILED_SHEET_ID,
    ]);
    expect(harness.gateway.calls).toEqual([]);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("keeps a sheet that failed to load listed, out of the tabs, in place and immovable", async () => {
    const harness = await withDocumentA();

    await chooseRowMenuItem(harness.user, "Sheet A2", MESSAGES.tree.moveDown);

    await waitFor(() =>
      expect(storedSheetOrder(harness)).toEqual([
        SHEET_A1,
        FAILED_SHEET_ID,
        SHEET_A2,
      ]),
    );
    expect(treeLabels().slice(2, 5)).toEqual(["Sheet A1", UNNAMED, "Sheet A2"]);
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);

    const failed = within(treeItemNamed("Document A")).getByRole("treeitem", {
      name: /読み込み失敗/,
    });
    const menu = await openRowMenu(harness.user, failed);
    for (const name of [
      MESSAGES.tree.rename,
      MESSAGES.tree.moveUp,
      MESSAGES.tree.moveDown,
    ]) {
      expect(menuItemOf(menu, name).getAttribute("aria-disabled")).toBe("true");
    }
    await harness.user.keyboard("{Escape}");
    harness.gateway.clearCalls();
    failed.focus();
    await harness.user.keyboard(CTRL_UP + CTRL_DOWN);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("is saved: a new workspace over the same disk has the order", async () => {
    const harness = await withDocumentA();
    await chooseRowMenuItem(harness.user, "Sheet A2", MESSAGES.tree.moveUp);
    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]),
    );
    await harness.runAutoSave();

    const { store, workspace } = await reopenedWorkspace(harness);
    await workspace.openDocument(DOCUMENT_A);
    expect(
      store.getState().documents.get(DOCUMENT_A)?.document.sheetOrder,
    ).toEqual([SHEET_A2, SHEET_A1, FAILED_SHEET_ID]);
  });
});

describe("row menu accessibility", () => {
  it("has a labelled menu button per row, menu semantics, arrow keys, Escape and focus return", async () => {
    const harness = await openedShell();
    const tree = screen.getByRole("tree");
    expect(
      within(tree).getAllByRole("button", { name: /のメニュー$/ }),
    ).toHaveLength(4);

    const button = within(treeItemNamed("Document A")).getByRole("button", {
      name: "Document A のメニュー",
    });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await harness.user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Document A のメニュー" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      MESSAGES.tree.rename,
      MESSAGES.tree.moveUp,
      MESSAGES.tree.moveDown,
      MESSAGES.tree.createSheet,
      MESSAGES.tree.deleteDocument,
    ]);
    expect(document.activeElement).toBe(items[0]);

    await harness.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await harness.user.keyboard("{End}");
    expect(document.activeElement).toBe(items[4]);
    await harness.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[0]);
    await harness.user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(items[4]);
    await harness.user.keyboard("{Home}");
    expect(document.activeElement).toBe(items[0]);

    await harness.user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when focus leaves and offers the project row only the create action", async () => {
    const harness = await openedShell();
    const menu = await openRowMenu(harness.user, "Project");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([MESSAGES.tree.createDocument]);

    await harness.user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers the sheet row rename, moves and delete; the tree semantics are unchanged", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    const menu = await openRowMenu(harness.user, "Sheet A1");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      MESSAGES.tree.rename,
      MESSAGES.tree.moveUp,
      MESSAGES.tree.moveDown,
      MESSAGES.tree.deleteSheet,
    ]);
    await harness.user.keyboard("{Escape}");
    expect(screen.getByRole("tree").getAttribute("aria-label")).toBe(
      "Project Tree",
    );
    expect(treeItemNamed("Sheet A1").getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});
