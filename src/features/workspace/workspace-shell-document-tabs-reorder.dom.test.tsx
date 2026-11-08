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
} from "../../application/test-support/workspace-harness";
import { undoDepth } from "./test-support/actions-harness";
import {
  renderShell,
  type ShellHarness,
  treeItemNamed,
} from "./test-support/shell-harness";
import { dragTreeRow, yOnRow } from "./test-support/tree-drag-helpers";

afterEach(() => {
  cleanup();
});

const CTRL_LEFT = "{Control>}{ArrowLeft}{/Control}";
const CTRL_RIGHT = "{Control>}{ArrowRight}{/Control}";
const TAB_WIDTH = 100;
const TAB_HEIGHT = 20;
const POINTER_Y = TAB_HEIGHT / 2;
const DRAG_DISTANCE = 40;

const documentTabList = () =>
  screen.getByRole("tablist", { name: "Document Tabs" });
const tabElement = (name: string) =>
  within(documentTabList()).getByRole("tab", { name: new RegExp(name) });
const tabNames = () =>
  within(documentTabList())
    .getAllByRole("tab")
    .map((tab) => tab.textContent?.replace(/保存.*|未保存/, "").trim());
const openOrder = (harness: ShellHarness) => [
  ...harness.store.getState().documents.keys(),
];
const storedDocumentOrder = (harness: ShellHarness) =>
  harness.store.getState().project?.project.childOrder;

// jsdom has no layout: gives every tab a rectangle in a single row, in DOM order.
function layoutTabs(): void {
  within(documentTabList())
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

// A tab is passed once the pointer is beyond its middle, so a slot boundary is a slot.
const xAtSlot = (slot: number) => slot * TAB_WIDTH;

async function withTwoOpenDocuments(): Promise<ShellHarness> {
  const harness = await renderShell();
  await harness.openProjectInUi();
  for (const name of ["Document A", "Document B"]) {
    await harness.user.click(within(treeItemNamed(name)).getByText(name));
    await screen.findByRole("tab", { name: new RegExp(name) });
  }
  expect(tabNames()).toEqual(["Document A", "Document B"]);
  layoutTabs();
  harness.gateway.clearCalls();
  return harness;
}

async function dragTab(
  harness: ShellHarness,
  name: string,
  toSlot: number,
  release = true,
) {
  const tab = tabElement(name);
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
    { target: tab, coords: { clientX: xAtSlot(toSlot), clientY: POINTER_Y } },
  ]);
  if (release) {
    await harness.user.pointer({
      keys: "[/MouseLeft]",
      target: tab,
      coords: { clientX: xAtSlot(toSlot), clientY: POINTER_Y },
    });
  }
}

const indicated = () =>
  document.querySelectorAll(".tab--drop-before, .tab--drop-after");

describe("Document Tabs reorder", () => {
  it("moves with Ctrl+Arrow, keeps focus on the moved tab, and is not history, save or tree order", async () => {
    const harness = await withTwoOpenDocuments();
    const treeOrderBefore = storedDocumentOrder(harness);
    tabElement("Document B").focus();
    await harness.user.keyboard(CTRL_LEFT);
    await waitFor(() =>
      expect(tabNames()).toEqual(["Document B", "Document A"]),
    );
    expect(document.activeElement).toBe(tabElement("Document B"));
    expect(openOrder(harness)).toEqual([DOCUMENT_B, DOCUMENT_A]);

    layoutTabs();
    await harness.user.keyboard(CTRL_RIGHT);
    await waitFor(() =>
      expect(tabNames()).toEqual(["Document A", "Document B"]),
    );
    expect(document.activeElement).toBe(tabElement("Document B"));

    expect(await undoDepth(harness)).toBe(0);
    expect(harness.gateway.calls).toEqual([]);
    expect(storedDocumentOrder(harness)).toEqual(treeOrderBefore);
  });

  it("is a no-op at the ends", async () => {
    const harness = await withTwoOpenDocuments();
    tabElement("Document A").focus();
    await harness.user.keyboard(CTRL_LEFT);
    tabElement("Document B").focus();
    await harness.user.keyboard(CTRL_RIGHT);
    expect(tabNames()).toEqual(["Document A", "Document B"]);
    expect(openOrder(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("keeps plain arrows for focus and activation", async () => {
    const harness = await withTwoOpenDocuments();
    tabElement("Document B").focus();
    await harness.user.keyboard("{ArrowLeft}");
    expect(tabNames()).toEqual(["Document A", "Document B"]);
    expect(tabElement("Document A").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabElement("Document A"));
  });

  it("does not change the Project Tree order, and tree reorder does not change the tabs", async () => {
    const harness = await withTwoOpenDocuments();
    const treeOrderBefore = storedDocumentOrder(harness);
    await harness.user.pointer({ target: tabElement("Document B") });
    tabElement("Document B").focus();
    await harness.user.keyboard(CTRL_LEFT);
    await waitFor(() =>
      expect(tabNames()).toEqual(["Document B", "Document A"]),
    );
    expect(storedDocumentOrder(harness)).toEqual(treeOrderBefore);

    await dragTreeRow(harness.user, "Document B", yOnRow("Document A", 0.1));
    await waitFor(() =>
      expect(storedDocumentOrder(harness)?.[0]).toBe(DOCUMENT_B),
    );
    expect(tabNames()).toEqual(["Document B", "Document A"]);
  });

  describe("pointer drag", () => {
    it("shows the drop indicator and moves to it on release without history or writes", async () => {
      const harness = await withTwoOpenDocuments();
      await dragTab(harness, "Document A", 2, false);
      expect(indicated()).toHaveLength(1);
      expect(
        tabElement("Document B").parentElement?.classList.contains(
          "tab--drop-after",
        ),
      ).toBe(true);

      await harness.user.pointer({
        keys: "[/MouseLeft]",
        target: tabElement("Document A"),
      });
      await waitFor(() =>
        expect(tabNames()).toEqual(["Document B", "Document A"]),
      );
      expect(indicated()).toHaveLength(0);
      // The click that ends a drag does not activate the dragged tab.
      expect(tabElement("Document B").getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(await undoDepth(harness)).toBe(0);
      expect(harness.gateway.calls).toEqual([]);
    });

    it("a click without movement only selects", async () => {
      const harness = await withTwoOpenDocuments();
      const tab = tabElement("Document A");
      await harness.user.pointer([
        {
          keys: "[MouseLeft>]",
          target: tab,
          coords: { clientX: 50, clientY: POINTER_Y },
        },
        { target: tab, coords: { clientX: 52, clientY: POINTER_Y } },
        { keys: "[/MouseLeft]", target: tab },
      ]);
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(tabNames()).toEqual(["Document A", "Document B"]);
    });

    it("Escape cancels: nothing moves and the indicator goes away", async () => {
      const harness = await withTwoOpenDocuments();
      await dragTab(harness, "Document A", 2, false);
      expect(indicated()).toHaveLength(1);
      await harness.user.keyboard("{Escape}");
      expect(indicated()).toHaveLength(0);
      await harness.user.pointer({
        keys: "[/MouseLeft]",
        target: tabElement("Document A"),
      });
      expect(tabNames()).toEqual(["Document A", "Document B"]);
      expect(tabElement("Document B").getAttribute("aria-selected")).toBe(
        "true",
      );
    });

    it("pointercancel cancels", async () => {
      const harness = await withTwoOpenDocuments();
      await dragTab(harness, "Document A", 2, false);
      fireEvent.pointerCancel(tabElement("Document A"), { pointerId: 1 });
      expect(indicated()).toHaveLength(0);
      await harness.user.pointer({
        keys: "[/MouseLeft]",
        target: tabElement("Document A"),
      });
      expect(tabNames()).toEqual(["Document A", "Document B"]);
    });

    it("dropping at the original position does nothing", async () => {
      const harness = await withTwoOpenDocuments();
      await dragTab(harness, "Document B", 2);
      await dragTab(harness, "Document B", 1);
      await dragTab(harness, "Document A", 0);
      await dragTab(harness, "Document A", 1);
      expect(tabNames()).toEqual(["Document A", "Document B"]);
      expect(openOrder(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    });

    it("the close button still closes a tab", async () => {
      const harness = await withTwoOpenDocuments();
      await harness.user.click(
        screen.getByRole("button", {
          name: /Document B.*閉じる|閉じる.*Document B/,
        }),
      );
      await waitFor(() => expect(tabNames()).toEqual(["Document A"]));
    });
  });
});
