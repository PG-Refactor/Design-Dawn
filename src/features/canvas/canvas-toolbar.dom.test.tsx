// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockIdOf, settle } from "../../application/test-support/fakes";
import { SHEET_A1 } from "../../application/test-support/workspace-harness";
import {
  blockOption,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import { MERMAID_TEMPLATES } from "../mermaid/mermaid-templates";
import { getSelection } from "../workspace/ui-state/ui-state";

const CANVAS_AREA = { width: 800, height: 600 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const addButton = () => screen.getByRole("button", { name: "+ Block" });

// jsdom has no layout; the toolbar measures the canvas area to centre a new block.
function stubCanvasArea(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...CANVAS_AREA,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: CANVAS_AREA.width,
    bottom: CANVAS_AREA.height,
    toJSON: () => ({}),
  });
}

describe("+ Block menu", () => {
  it("is a menu button above the canvas with the toolbar role", async () => {
    await renderOpenedCanvas();
    expect(
      screen.getByRole("toolbar", { name: "Canvasツールバー" }),
    ).toBeTruthy();
    expect(addButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(addButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a menu of the creatable types and the Mermaid templates, focusing the first item", async () => {
    const { shell } = await renderOpenedCanvas();
    await shell.user.click(addButton());
    expect(addButton().getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "追加するBlockの種類" });
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Markdown",
      "Mermaid",
      "Mermaid: シーケンス図",
      "Mermaid: ガントチャート",
      "Mermaid: 円グラフ",
      "Mermaid: クラス図",
      "Mermaid: 状態遷移図",
      "Mermaid: ER図",
    ]);
    expect(menu.contains(items[0] ?? null)).toBe(true);
    await act(settle);
    expect(document.activeElement).toBe(items[0]);
  });

  it("creates a Mermaid block from a template, with the template's text", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    await shell.user.click(addButton());
    await shell.user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Mermaid: シーケンス図",
      }),
    );
    await act(settle);
    const created = canvas.blocksOfSheetA1().at(-1);
    expect(created?.blockType).toBe("mermaid");
    expect(
      canvas.session.getState().contents.get(created?.blockId ?? blockIdOf(0)),
    ).toBe(MERMAID_TEMPLATES.sequence);
  });

  it("closes with Escape and returns focus to the button", async () => {
    const { shell } = await renderOpenedCanvas();
    await shell.user.click(addButton());
    await act(settle);
    await shell.user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(addButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(addButton());
  });

  it("opens with ArrowDown on the button and is operable by keyboard alone", async () => {
    stubCanvasArea();
    const { shell } = await renderOpenedCanvas();
    addButton().focus();
    await shell.user.keyboard("{ArrowDown}");
    await act(settle);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Markdown" }),
    );
    await shell.user.keyboard("{Enter}");
    await act(settle);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("closes when focus leaves it without taking focus back", async () => {
    const { shell } = await renderOpenedCanvas();
    await shell.user.click(addButton());
    await shell.user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is not offered when the document has no sheet", async () => {
    const { shell } = await renderOpenedCanvas();
    await act(async () => {
      await shell.actions.createDocument("Empty");
      await settle();
    });
    expect(screen.queryByRole("button", { name: "+ Block" })).toBeNull();
  });
});

describe("creating a Markdown block from the menu", () => {
  it("adds it centred in the canvas as one history entry, selected, showing its heading", async () => {
    stubCanvasArea();
    const { shell, canvas } = await renderOpenedCanvas();
    await shell.user.click(addButton());
    await shell.user.click(screen.getByRole("menuitem", { name: "Markdown" }));
    await act(settle);

    expect(screen.getAllByRole("option")).toHaveLength(4);
    const created = canvas.blocksOfSheetA1().at(-1);
    expect(created?.position).toEqual({ x: 160, y: 140 });
    expect(created?.size).toEqual({ width: 480, height: 320 });
    expect(canvas.session.getState().history.undoLabel).toBe("createBlocks");
    expect(await canvas.undoDepth()).toBe(1);
    expect([...getSelection(shell.uiStateStore.getState(), SHEET_A1)]).toEqual([
      created?.blockId,
    ]);
    const option = blockOption(3);
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(
      screen
        .getAllByRole("region")
        .some(
          (region) =>
            region.querySelector("h1")?.textContent === "New Markdown",
        ),
    ).toBe(true);
    expect(shell.gateway.files.get(created?.contentPath ?? "")).toBe(
      "# New Markdown",
    );
  });

  it("can be undone from the keyboard, removing block and file", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    await shell.user.click(addButton());
    await shell.user.click(screen.getByRole("menuitem", { name: "Markdown" }));
    await act(settle);
    const path = canvas.blocksOfSheetA1().at(-1)?.contentPath ?? "";

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("listbox"), {
        key: "z",
        ctrlKey: true,
      });
      await settle();
    });
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(shell.gateway.files.has(path)).toBe(false);
  });
});
