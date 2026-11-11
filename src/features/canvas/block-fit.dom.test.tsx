// @vitest-environment jsdom
// jsdom has no layout, so the sizes the canvas would draw are given to the elements below;
// what is checked is how they become the block's new size and that it is one undo step.
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
  blockOption,
  type RenderedCanvas,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import {
  createFakeRenderer,
  installObjectUrlFake,
  type ObjectUrlFake,
} from "../mermaid/test-support/fake-mermaid-renderer";
import {
  type ActionsHarness,
  seedSheetBlocks,
} from "../workspace/test-support/actions-harness";
import { BLOCK_ID_ATTRIBUTE } from "./block-dom";
import { CANVAS_MESSAGES } from "./canvas-messages";

const MESSAGES = CANVAS_MESSAGES.ja;

let objectUrls: ObjectUrlFake;

beforeEach(() => {
  objectUrls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  objectUrls.restore();
});

async function renderBlocks(): Promise<RenderedCanvas> {
  return renderOpenedCanvas(
    (harness: ActionsHarness): void => {
      const blocks = [
        makeBlockAt(1, 10, 20, "mermaid"),
        makeBlockAt(2, 300, 40),
      ];
      seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
      harness.gateway.files.set(
        blocks[0]?.contentPath ?? "",
        "flowchart LR\n  A --> B",
      );
      harness.gateway.files.set(blocks[1]?.contentPath ?? "", "# Long text");
    },
    { mermaidRenderer: createFakeRenderer() },
  );
}

function blockMenu(index: number): HTMLElement {
  fireEvent.contextMenu(blockOption(index), {
    clientX: 1,
    clientY: 1,
    button: 2,
  });
  return screen.getByRole("menu", { name: MESSAGES.contextMenu.blockLabel });
}

function measured(
  element: Element,
  sizes: Readonly<Record<string, () => number>>,
): void {
  for (const [name, read] of Object.entries(sizes)) {
    Object.defineProperty(element, name, { configurable: true, get: read });
  }
}

function frameOf(rendered: RenderedCanvas, index: number): HTMLElement {
  const blockId = rendered.canvas.blocksOfSheetA1()[index]?.blockId ?? "";
  const frame = document.querySelector<HTMLElement>(
    `[${BLOCK_ID_ATTRIBUTE}="${blockId}"]`,
  );
  if (frame === null) throw new Error("block frame not drawn");
  return frame;
}

describe("Fit Size to Content", () => {
  it("gives a Markdown block the height its text takes, in one undo step", async () => {
    const rendered = await renderBlocks();
    const before = rendered.canvas.blocksOfSheetA1()[1];
    const frame = frameOf(rendered, 1);
    const preview = frame.querySelector<HTMLElement>(".markdown-preview");
    if (before === undefined || preview === null) throw new Error("not drawn");
    // The text needs 300 units; the block shows 80 of them and 10 more go to its edges.
    measured(frame, {
      offsetWidth: () => before.size.width,
      offsetHeight: () => 90,
    });
    measured(preview, {
      offsetHeight: () => (preview.style.height === "auto" ? 300 : 80),
      scrollWidth: () => 100,
      clientWidth: () => 100,
    });

    await rendered.shell.user.click(
      within(blockMenu(1)).getByRole("menuitem", {
        name: MESSAGES.contextMenu.fitToContent,
      }),
    );
    await act(settle);

    expect(rendered.canvas.blocksOfSheetA1()[1]?.size).toEqual({
      width: before.size.width,
      height: 310,
    });
    expect(rendered.canvas.blocksOfSheetA1()[1]?.position).toEqual(
      before.position,
    );
    expect(preview.style.height).toBe("");
    expect(await rendered.canvas.undoDepth()).toBe(1);
  });

  it("keeps a diagram's exports in an Export submenu", async () => {
    const rendered = await renderBlocks();
    const menu = blockMenu(0);
    const exportItem = within(menu).getByRole("menuitem", {
      name: MESSAGES.contextMenu.exportMenu,
    });
    expect(
      within(menu).queryByRole("menuitem", {
        name: MESSAGES.contextMenu.exportSvg,
      }),
    ).toBeNull();
    await rendered.shell.user.click(exportItem);
    expect(
      screen.getByRole("menuitem", { name: MESSAGES.contextMenu.exportSvg }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: MESSAGES.contextMenu.exportPng }),
    ).toBeTruthy();
  });
});
