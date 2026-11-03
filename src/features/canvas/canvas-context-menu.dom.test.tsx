// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  blockOption,
  canvasElement,
  pointer,
  type RenderedCanvas,
  renderOpenedCanvas,
  sourceBox,
} from "../markdown/test-support/markdown-harness";
import { MERMAID_MESSAGES } from "../mermaid/mermaid-messages";
import { MERMAID_TEMPLATE_IDS } from "../mermaid/mermaid-templates";
import { CANVAS_MESSAGES } from "./canvas-messages";

const MESSAGES = CANVAS_MESSAGES.ja;
const LABELS = MESSAGES.contextMenu;

afterEach(() => {
  cleanup();
});

const options = () => screen.getAllByRole("option");
const selected = () =>
  options().map((option) => option.getAttribute("aria-selected"));

function click(index: number, additive = false): void {
  fireEvent.pointerDown(blockOption(index), {
    ...pointer(0, 0),
    ctrlKey: additive,
  });
  fireEvent.pointerUp(canvasElement(), pointer(0, 0));
}

// jsdom lays nothing out, so a client point is the screen point on the canvas and, at the
// default viewport, the world point too.
function rightClick(target: HTMLElement, x = 1, y = 1): boolean {
  return fireEvent.contextMenu(target, { clientX: x, clientY: y, button: 2 });
}

async function choose(rendered: RenderedCanvas, name: string): Promise<void> {
  await rendered.shell.user.click(
    within(screen.getByRole("menu")).getByRole("menuitem", { name }),
  );
  await act(settle);
}

const itemNamed = (name: string) =>
  within(screen.getByRole("menu")).getByRole("menuitem", { name });

describe("the right-click menu of a block", () => {
  it("selects the block alone and deletes it as one undoable entry", async () => {
    const rendered = await renderOpenedCanvas();
    click(0);
    expect(rightClick(blockOption(1))).toBe(false);
    expect(screen.getByRole("menu", { name: LABELS.blockLabel })).toBeTruthy();
    expect(selected()).toEqual(["false", "true", "false"]);
    expect(itemNamed(LABELS.edit).getAttribute("aria-disabled")).toBeNull();
    await choose(rendered, LABELS.delete);
    expect(options()).toHaveLength(2);
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("keeps a selection it is part of, and acts on all of it", async () => {
    const rendered = await renderOpenedCanvas();
    click(0);
    click(1, true);
    rightClick(blockOption(1));
    expect(selected()).toEqual(["true", "true", "false"]);
    // Editing is for one block at a time.
    expect(itemNamed(LABELS.edit).getAttribute("aria-disabled")).toBe("true");
    await choose(rendered, LABELS.duplicate);
    expect(options()).toHaveLength(5);
  });

  it("starts editing from the menu", async () => {
    const rendered = await renderOpenedCanvas();
    rightClick(blockOption(0));
    await choose(rendered, LABELS.edit);
    expect(sourceBox()).toBeTruthy();
  });

  it("changes the stacking order of the block", async () => {
    const rendered = await renderOpenedCanvas();
    const first = rendered.canvas.blocksOfSheetA1()[0]?.blockId;
    rightClick(blockOption(0));
    await choose(rendered, MESSAGES.reorder.toFront);
    expect(rendered.canvas.blocksOfSheetA1().at(-1)?.blockId).toBe(first);
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("keeps its keys to itself and gives focus back to the canvas on Escape", async () => {
    const rendered = await renderOpenedCanvas();
    rightClick(blockOption(0));
    const before = rendered.canvas.blocksOfSheetA1()[0]?.position;
    await rendered.shell.user.keyboard("{ArrowDown}{ArrowRight}{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(canvasElement());
    expect(rendered.canvas.blocksOfSheetA1()[0]?.position).toEqual(before);
    expect(await rendered.canvas.undoDepth()).toBe(0);
  });

  it("leaves the text menu of a block editor alone", async () => {
    const rendered = await renderOpenedCanvas();
    rightClick(blockOption(0));
    await choose(rendered, LABELS.edit);
    expect(rightClick(sourceBox())).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the right-click menu of the empty canvas", () => {
  it("adds a block whose top-left corner is where the menu was opened", async () => {
    const rendered = await renderOpenedCanvas();
    rightClick(canvasElement(), 900, 700);
    expect(screen.getByRole("menu", { name: LABELS.canvasLabel })).toBeTruthy();
    await choose(rendered, LABELS.addBlock("Mermaid"));
    const added = rendered.canvas.blocksOfSheetA1().at(-1);
    expect(added?.blockType).toBe("mermaid");
    expect(added?.position).toEqual({ x: 900, y: 700 });
    expect(selected().at(-1)).toBe("true");
  });

  it("offers every creatable block type and paste", async () => {
    await renderOpenedCanvas();
    rightClick(canvasElement());
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      LABELS.addBlock("Markdown"),
      LABELS.addBlock("Mermaid"),
      ...MERMAID_TEMPLATE_IDS.map((template) =>
        LABELS.addBlock(`Mermaid: ${MERMAID_MESSAGES.ja.templates[template]}`),
      ),
      LABELS.paste,
    ]);
  });
});
