// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  blockOption,
  canvasElement,
  pointer,
  type RenderedCanvas,
  renderOpenedCanvas,
  sourceBox,
} from "../markdown/test-support/markdown-harness";
import { treeItemNamed } from "../workspace/test-support/shell-harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const optionLabels = () =>
  screen
    .getAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));
const ONE = "markdown 00000001";
const TWO = "markdown 00000002";
const THREE = "markdown 00000003";

function click(index: number): void {
  fireEvent.pointerDown(blockOption(index), pointer(0, 0));
  fireEvent.pointerUp(canvasElement(), pointer(0, 0));
}

async function press(
  init: Record<string, unknown>,
  target: HTMLElement = canvasElement(),
): Promise<boolean> {
  let notPrevented = true;
  await act(async () => {
    notPrevented = fireEvent.keyDown(target, init);
    await settle();
  });
  return notPrevented;
}

const ctrl = (key: string) => ({ key, ctrlKey: true });
const bracket = (code: "BracketRight" | "BracketLeft", shiftKey = false) => ({
  key: code === "BracketRight" ? (shiftKey ? "}" : "]") : shiftKey ? "{" : "[",
  code,
  ctrlKey: true,
  shiftKey,
});

describe("z-order menu", () => {
  const menuButton = () => screen.getByRole("button", { name: "重なり順" });
  async function openMenu(rendered: RenderedCanvas) {
    await rendered.shell.user.click(menuButton());
    return screen.getByRole("menu", { name: "重なり順の変更" });
  }

  it("is a menu button whose items are disabled without a selection", async () => {
    const rendered = await renderOpenedCanvas();
    expect(menuButton().getAttribute("aria-haspopup")).toBe("menu");
    const menu = await openMenu(rendered);
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "前面へ",
      "背面へ",
      "最前面へ",
      "最背面へ",
    ]);
    for (const item of items) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
    }
    await rendered.shell.user.click(items[2] as HTMLElement);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });

  it("enables the items with a selection and each one reorders the blocks", async () => {
    const rendered = await renderOpenedCanvas();
    click(0);
    const choose = async (name: string) => {
      const menu = await openMenu(rendered);
      const item = within(menu).getByRole("menuitem", { name });
      expect(item.getAttribute("aria-disabled")).toBeNull();
      await rendered.shell.user.click(item);
      await act(settle);
    };
    await choose("前面へ");
    expect(optionLabels()).toEqual([TWO, ONE, THREE]);
    await choose("最前面へ");
    expect(optionLabels()).toEqual([TWO, THREE, ONE]);
    await choose("背面へ");
    expect(optionLabels()).toEqual([TWO, ONE, THREE]);
    await choose("最背面へ");
    expect(optionLabels()).toEqual([ONE, TWO, THREE]);
  });
});

describe("z-order shortcuts", () => {
  it("Ctrl+] / Ctrl+[ / Ctrl+Shift+] / Ctrl+Shift+[ reorder the selection", async () => {
    await renderOpenedCanvas();
    click(0);
    await press(bracket("BracketRight"));
    expect(optionLabels()).toEqual([TWO, ONE, THREE]);
    await press(bracket("BracketRight", true));
    expect(optionLabels()).toEqual([TWO, THREE, ONE]);
    await press(bracket("BracketLeft"));
    expect(optionLabels()).toEqual([TWO, ONE, THREE]);
    await press(bracket("BracketLeft", true));
    expect(optionLabels()).toEqual([ONE, TWO, THREE]);
  });

  it("does nothing without a selection", async () => {
    const rendered = await renderOpenedCanvas();
    await press(bracket("BracketRight", true));
    expect(optionLabels()).toEqual([ONE, TWO, THREE]);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });
});

describe("clipboard shortcuts on the canvas", () => {
  it("Ctrl+C then Ctrl+V pastes next to the original and selects the paste", async () => {
    const rendered = await renderOpenedCanvas();
    click(0);
    await press(ctrl("c"));
    expect(rendered.shell.clipboard.read()?.blocks).toHaveLength(1);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
    await press(ctrl("v"));
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(blockOption(3).getAttribute("aria-selected")).toBe("true");
    expect(blockOption(0).getAttribute("aria-selected")).toBe("false");
    expect(rendered.canvas.blocksOfSheetA1()[3]?.position).toEqual({
      x: 34,
      y: 44,
    });
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("Ctrl+X removes the selection as one undoable entry that Ctrl+V can paste", async () => {
    const rendered = await renderOpenedCanvas();
    click(1);
    await press(ctrl("x"));
    expect(optionLabels()).toEqual([ONE, THREE]);
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await press(ctrl("z"));
    expect(optionLabels()).toEqual([ONE, TWO, THREE]);
    await press({ key: "Z", ctrlKey: true, shiftKey: true });
    expect(optionLabels()).toEqual([ONE, THREE]);
    await press(ctrl("v"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("Ctrl+D duplicates the selection without touching the clipboard and prevents the browser default", async () => {
    const rendered = await renderOpenedCanvas();
    click(0);
    const notPrevented = await press(ctrl("d"));
    expect(notPrevented).toBe(false);
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(rendered.shell.clipboard.read()).toBeNull();
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("with nothing selected, copy / cut / duplicate do nothing", async () => {
    const rendered = await renderOpenedCanvas();
    for (const key of ["c", "x", "d"]) await press(ctrl(key));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(rendered.shell.clipboard.read()).toBeNull();
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  });
});

describe("input isolation", () => {
  const SHORTCUTS: readonly Record<string, unknown>[] = [
    ctrl("c"),
    ctrl("x"),
    ctrl("v"),
    ctrl("d"),
    ctrl("z"),
    bracket("BracketRight"),
    bracket("BracketLeft", true),
    { key: "Delete" },
    { key: " ", code: "Space" },
  ];

  async function expectUntouched(
    rendered: RenderedCanvas,
    target: HTMLElement,
  ) {
    rendered.shell.gateway.clearCalls();
    for (const init of SHORTCUTS) {
      // true = not default-prevented, so the field keeps its native behaviour.
      expect(await press(init, target)).toBe(true);
    }
    expect(rendered.shell.clipboard.read()).toBeNull();
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
    expect(rendered.shell.gateway.calls).toEqual([]);
  }

  it("the Markdown editor keeps its own copy / paste / cut / undo / Delete / Space", async () => {
    const rendered = await renderOpenedCanvas();
    fireEvent.doubleClick(blockOption(0));
    const box = sourceBox();
    await expectUntouched(rendered, box);
    expect(canvasElement().className).not.toContain("canvas--pan-ready");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("the tree rename input keeps its own keys", async () => {
    const rendered = await renderOpenedCanvas();
    treeItemNamed("Document A").focus();
    await rendered.shell.user.keyboard("{F2}");
    const box = screen.getByRole("textbox", { name: "Document Aの名前を変更" });
    // A selected block would be an easy victim of a leaking shortcut.
    click(0);
    box.focus();
    await expectUntouched(rendered, box);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("shortcuts pressed while the tree has focus do not reach the canvas", async () => {
    const rendered = await renderOpenedCanvas();
    click(0);
    await expectUntouchedOnTree(rendered);
  });

  async function expectUntouchedOnTree(rendered: RenderedCanvas) {
    const row = treeItemNamed("Document A");
    for (const init of [
      ctrl("c"),
      ctrl("x"),
      ctrl("d"),
      bracket("BracketRight"),
    ]) {
      await press(init, row);
    }
    expect(rendered.shell.clipboard.read()).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(rendered.canvas.session.getState().history.canUndo).toBe(false);
  }
});
