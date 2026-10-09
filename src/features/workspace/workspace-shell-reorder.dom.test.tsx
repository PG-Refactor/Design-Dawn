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
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  FAILED_SHEET_ID,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import { reopenedWorkspace, undoDepth } from "./test-support/actions-harness";
import {
  applyOutsideUi,
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
    expect(screen.queryByRole("tablist", { name: "Document Tabs" })).toBeNull();
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

const CTRL_LEFT = "{Control>}{ArrowLeft}{/Control}";
const CTRL_RIGHT = "{Control>}{ArrowRight}{/Control}";
const TAB_WIDTH = 100;
const TAB_HEIGHT = 20;

const sheetTabElement = (name: string) =>
  within(screen.getByRole("tablist", { name: "Sheet Tabs" })).getByRole("tab", {
    name,
  });

// jsdom has no layout: gives every sheet tab a rectangle in a single row, in DOM order.
function layoutSheetTabs(): void {
  within(screen.getByRole("tablist", { name: "Sheet Tabs" }))
    .getAllByRole("tab")
    .forEach((tab, index) => {
      const left = index * TAB_WIDTH;
      const rect = {
        left,
        right: left + TAB_WIDTH,
        top: 0,
        bottom: TAB_HEIGHT,
        width: TAB_WIDTH,
        height: TAB_HEIGHT,
        x: left,
        y: 0,
        toJSON: () => ({}),
      };
      const container = tab.parentElement;
      if (container !== null) container.getBoundingClientRect = () => rect;
    });
}

// The x that puts the pointer at the given slot (0 = before the first tab).
// A tab is passed once the pointer is beyond its middle, so a slot boundary is a slot.
const xAtSlot = (slot: number) => slot * TAB_WIDTH;
const POINTER_Y = TAB_HEIGHT / 2;
const DRAG_DISTANCE = 40;

describe("sheet reorder (Sheet Tabs)", () => {
  async function withDocumentA() {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
    layoutSheetTabs();
    return harness;
  }

  it("shows no sheet rows in the tree, whichever document is open", async () => {
    const harness = await withDocumentA();
    expect(treeLabels()).toEqual([
      "Project",
      "Document A",
      "Document B",
      UNNAMED,
    ]);
    await openDocumentByClick(harness, "Document B");
    expect(screen.queryByRole("treeitem", { name: /Sheet/ })).toBeNull();
  });

  it("moves with Ctrl+Arrow, keeps focus on the moved tab, one history entry per step; undo and redo restore", async () => {
    const harness = await withDocumentA();
    sheetTabElement("Sheet A1").focus();

    await harness.user.keyboard(CTRL_RIGHT);
    // Moving past the last visible tab goes to the end of the stored order, behind the
    // sheet that failed to load.
    await waitFor(() =>
      expect(storedSheetOrder(harness)).toEqual([
        SHEET_A2,
        FAILED_SHEET_ID,
        SHEET_A1,
      ]),
    );
    expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]);
    expect(document.activeElement).toBe(sheetTabElement("Sheet A1"));
    // Reordering moves; it does not select.
    expect(sheetTabElement("Sheet A1").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(await undoDepth(harness)).toBe(1);

    await harness.user.keyboard(CTRL_LEFT);
    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]),
    );
    expect(document.activeElement).toBe(sheetTabElement("Sheet A1"));
    expect(await undoDepth(harness)).toBe(2);

    await applyOutsideUi(() => harness.canvasActions.undo(DOCUMENT_A));
    expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]);
    await applyOutsideUi(() => harness.canvasActions.undo(DOCUMENT_A));
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
    await applyOutsideUi(() => harness.canvasActions.redo(DOCUMENT_A));
    expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]);
  });

  it("keeps plain arrows for focus and selection", async () => {
    const harness = await withDocumentA();
    sheetTabElement("Sheet A1").focus();
    await harness.user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(sheetTabElement("Sheet A2").getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
    expect(await undoDepth(harness)).toBe(0);
  });

  it("is a no-op at the ends: no command, no history, no save", async () => {
    const harness = await withDocumentA();
    harness.gateway.clearCalls();
    sheetTabElement("Sheet A1").focus();
    await harness.user.keyboard(CTRL_LEFT);
    sheetTabElement("Sheet A2").focus();
    await harness.user.keyboard(CTRL_RIGHT);

    expect(await undoDepth(harness)).toBe(0);
    expect(storedSheetOrder(harness)).toEqual([
      SHEET_A1,
      SHEET_A2,
      FAILED_SHEET_ID,
    ]);
    expect(harness.gateway.calls).toEqual([]);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("moves past a sheet that failed to load without showing it, keeping its place", async () => {
    const harness = await withDocumentA();
    sheetTabElement("Sheet A1").focus();
    await harness.user.keyboard(CTRL_RIGHT + CTRL_RIGHT);
    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]),
    );
    // The second step is at the end of the visible tabs: nothing more happens.
    expect(storedSheetOrder(harness)).toEqual([
      SHEET_A2,
      FAILED_SHEET_ID,
      SHEET_A1,
    ]);
    expect(await undoDepth(harness)).toBe(1);
  });

  it("is saved: a new workspace over the same disk has the order", async () => {
    const harness = await withDocumentA();
    sheetTabElement("Sheet A2").focus();
    await harness.user.keyboard(CTRL_LEFT);
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

  describe("pointer drag", () => {
    async function dragTab(
      harness: ShellHarness,
      name: string,
      toSlot: number,
      release = true,
    ) {
      const tab = sheetTabElement(name);
      const fromX = tab.parentElement?.getBoundingClientRect().left ?? 0;
      await harness.user.pointer([
        {
          keys: "[MouseLeft>]",
          target: tab,
          coords: { clientX: fromX + 1, clientY: POINTER_Y },
        },
        {
          target: tab,
          coords: { clientX: fromX + 1 + DRAG_DISTANCE, clientY: POINTER_Y },
        },
        {
          target: tab,
          coords: { clientX: xAtSlot(toSlot), clientY: POINTER_Y },
        },
      ]);
      if (release)
        await harness.user.pointer({
          keys: "[/MouseLeft]",
          target: tab,
          coords: { clientX: xAtSlot(toSlot), clientY: POINTER_Y },
        });
    }

    it("shows the drop indicator while dragging and moves to it as ONE history entry on release", async () => {
      const harness = await withDocumentA();
      await dragTab(harness, "Sheet A1", 2, false);
      const indicated = () =>
        document.querySelectorAll(".tab--drop-before, .tab--drop-after");
      expect(indicated()).toHaveLength(1);
      expect(
        sheetTabElement("Sheet A2").parentElement?.classList.contains(
          "tab--drop-after",
        ),
      ).toBe(true);

      await harness.user.pointer({
        keys: "[/MouseLeft]",
        target: sheetTabElement("Sheet A1"),
      });
      await waitFor(() =>
        expect(sheetTabNames()).toEqual(["Sheet A2", "Sheet A1"]),
      );
      expect(indicated()).toHaveLength(0);
      expect(await undoDepth(harness)).toBe(1);
      // The click that ends a drag does not select the dragged tab.
      expect(sheetTabElement("Sheet A1").getAttribute("aria-selected")).toBe(
        "true",
      );
      await applyOutsideUi(() => harness.canvasActions.undo(DOCUMENT_A));
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
      expect(await undoDepth(harness)).toBe(0);
    });

    it("drops in front of a tab, however far it jumps, as one entry (three tabs)", async () => {
      const harness = await withDocumentA();
      await applyOutsideUi(async () => {
        await harness.actions.requestCreateSheet(DOCUMENT_A);
      });
      const dialog = await screen.findByRole("dialog", { name: "Sheetを作成" });
      await harness.user.type(
        within(dialog).getByRole("textbox", { name: "Sheet名" }),
        "Third{Enter}",
      );
      await waitFor(() =>
        expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2", "Third"]),
      );
      layoutSheetTabs();
      const depthBefore = await undoDepth(harness);

      await dragTab(harness, "Third", 0);

      await waitFor(() =>
        expect(sheetTabNames()).toEqual(["Third", "Sheet A1", "Sheet A2"]),
      );
      expect(await undoDepth(harness)).toBe(depthBefore + 1);
    });

    it("a click without movement only selects", async () => {
      const harness = await withDocumentA();
      const tab = sheetTabElement("Sheet A2");
      await harness.user.pointer([
        {
          keys: "[MouseLeft>]",
          target: tab,
          coords: { clientX: 150, clientY: POINTER_Y },
        },
        { target: tab, coords: { clientX: 152, clientY: POINTER_Y } },
        { keys: "[/MouseLeft]", target: tab },
      ]);
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
      expect(await undoDepth(harness)).toBe(0);
    });

    it("Escape cancels: nothing moves and the indicator goes away", async () => {
      const harness = await withDocumentA();
      await dragTab(harness, "Sheet A1", 2, false);
      expect(document.querySelectorAll(".tab--drop-after")).toHaveLength(1);

      await harness.user.keyboard("{Escape}");
      expect(document.querySelectorAll(".tab--drop-after")).toHaveLength(0);
      await harness.user.pointer({
        keys: "[/MouseLeft]",
        target: sheetTabElement("Sheet A1"),
      });

      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
      expect(await undoDepth(harness)).toBe(0);
      expect(sheetTabElement("Sheet A1").getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("pointercancel cancels", async () => {
      const harness = await withDocumentA();
      await dragTab(harness, "Sheet A1", 2, false);
      fireEvent.pointerCancel(sheetTabElement("Sheet A1"), { pointerId: 1 });
      expect(document.querySelectorAll(".tab--drop-after")).toHaveLength(0);
      await harness.user.pointer({
        keys: "[/MouseLeft]",
        target: sheetTabElement("Sheet A1"),
      });
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
      expect(await undoDepth(harness)).toBe(0);
    });

    it("dropping at the original position does nothing", async () => {
      const harness = await withDocumentA();
      harness.gateway.clearCalls();
      await dragTab(harness, "Sheet A2", 2);
      await dragTab(harness, "Sheet A2", 1);
      await dragTab(harness, "Sheet A1", 0);
      await dragTab(harness, "Sheet A1", 1);
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
      expect(await undoDepth(harness)).toBe(0);
      expect(harness.gateway.calls).toEqual([]);
    });

    it("ignores non-primary buttons", async () => {
      const harness = await withDocumentA();
      const tab = sheetTabElement("Sheet A1");
      await harness.user.pointer([
        {
          keys: "[MouseRight>]",
          target: tab,
          coords: { clientX: 1, clientY: POINTER_Y },
        },
        { target: tab, coords: { clientX: xAtSlot(2), clientY: POINTER_Y } },
        { keys: "[/MouseRight]", target: tab },
      ]);
      expect(document.querySelectorAll(".tab--drop-after")).toHaveLength(0);
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
      expect(await undoDepth(harness)).toBe(0);
    });

    it("leaves the close button and tab selection working", async () => {
      const harness = await withDocumentA();
      await harness.user.click(sheetTabElement("Sheet A2"));
      expect(sheetTabElement("Sheet A2").getAttribute("aria-selected")).toBe(
        "true",
      );
      await harness.user.click(
        screen.getByRole("button", { name: "Sheetを削除（Sheet A2）" }),
      );
      expect(
        await screen.findByRole("dialog", {
          name: "「Sheet A2」を削除しますか？",
        }),
      ).toBeTruthy();
      await harness.user.keyboard("{Escape}");
      expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
      expect(await undoDepth(harness)).toBe(0);
    });
  });
});

describe("sheet that failed to load", () => {
  it("is not in the tree or the tabs; the notification offers to delete it", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    expect(
      screen.queryByRole("treeitem", { name: /読み込み失敗/ }),
    ).not.toBeNull();
    // The only failed row left in the tree is the failed Document, not the failed Sheet.
    expect(
      screen.getAllByRole("treeitem", { name: /読み込み失敗/ }),
    ).toHaveLength(1);
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);

    await harness.user.click(screen.getByRole("button", { name: /^エラー/ }));
    await harness.user.click(
      await screen.findByRole("button", { name: "このSheetを削除" }),
    );
    await harness.user.click(
      await screen.findByRole("button", { name: "削除" }),
    );

    await waitFor(() =>
      expect(
        harness.store
          .getState()
          .documentDetails.get(DOCUMENT_A)
          ?.sheetEntries.some((entry) => entry.sheetId === FAILED_SHEET_ID),
      ).toBe(false),
    );
    expect(harness.gateway.methods("deleteSheet")).toEqual(["deleteSheet"]);
    expect(
      screen.queryByRole("button", { name: "このSheetを削除" }),
    ).toBeNull();
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
      MESSAGES.tree.moveTo,
      MESSAGES.tree.createSheet,
      MESSAGES.tree.deleteDocument,
    ]);
    expect(document.activeElement).toBe(items[0]);

    await harness.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await harness.user.keyboard("{End}");
    expect(document.activeElement).toBe(items[5]);
    await harness.user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[0]);
    await harness.user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(items[5]);
    await harness.user.keyboard("{Home}");
    expect(document.activeElement).toBe(items[0]);

    await harness.user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when focus leaves and offers the project row the create actions and open in a new window", async () => {
    const harness = await openedShell();
    const menu = await openRowMenu(harness.user, "Project");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      MESSAGES.tree.createFolder,
      MESSAGES.tree.createDocument,
      MESSAGES.tree.openProjectInNewWindow,
    ]);

    await harness.user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
