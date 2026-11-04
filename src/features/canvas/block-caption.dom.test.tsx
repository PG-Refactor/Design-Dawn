// @vitest-environment jsdom
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
import { CAPTION_MAX_CODE_POINTS } from "../../domain/domain-constants";
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

// A Mermaid block (a figure) and a Markdown block.
async function renderFigures(): Promise<RenderedCanvas> {
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

const captionOf = (rendered: RenderedCanvas) =>
  rendered.canvas.blocksOfSheetA1()[0]?.caption;

async function editCaption(rendered: RenderedCanvas, text: string) {
  await rendered.shell.user.click(
    within(blockMenu(0)).getByRole("menuitem", {
      name: MESSAGES.contextMenu.editCaption,
    }),
  );
  const field = screen.getByRole("textbox", {
    name: MESSAGES.caption.fieldLabel,
  });
  await rendered.shell.user.clear(field);
  if (text !== "") await rendered.shell.user.type(field, text);
  await rendered.shell.user.click(
    screen.getByRole("button", { name: MESSAGES.caption.save }),
  );
  await act(settle);
}

describe("the caption of a figure", () => {
  it("is set from the block menu, shown under the figure, and undone in one step", async () => {
    const rendered = await renderFigures();
    await editCaption(rendered, "Figure 1: the flow");

    expect(captionOf(rendered)).toBe("Figure 1: the flow");
    expect(
      blockOption(0).parentElement?.querySelector(".block-frame__caption")
        ?.textContent,
    ).toBe("Figure 1: the flow");
    expect(await rendered.canvas.undoDepth()).toBe(1);
    await act(async () => {
      await rendered.canvas.canvasActions.undo(DOCUMENT_A);
    });
    expect(captionOf(rendered)).toBeUndefined();
  });

  it("is removed by saving it empty", async () => {
    const rendered = await renderFigures();
    await editCaption(rendered, "Figure 1");
    await editCaption(rendered, "");
    expect(captionOf(rendered)).toBeUndefined();
    expect(document.querySelector(".block-frame__caption")).toBeNull();
  });

  it("refuses a caption that is too long, keeping the dialog open", async () => {
    const rendered = await renderFigures();
    await rendered.shell.user.click(
      within(blockMenu(0)).getByRole("menuitem", {
        name: MESSAGES.contextMenu.editCaption,
      }),
    );
    const field = screen.getByRole("textbox", {
      name: MESSAGES.caption.fieldLabel,
    });
    fireEvent.change(field, {
      target: { value: "x".repeat(CAPTION_MAX_CODE_POINTS + 1) },
    });
    await rendered.shell.user.click(
      screen.getByRole("button", { name: MESSAGES.caption.save }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      MESSAGES.caption.invalid,
    );
    expect(captionOf(rendered)).toBeUndefined();
  });

  it("goes with a duplicate of the figure", async () => {
    const rendered = await renderFigures();
    await editCaption(rendered, "Figure 1");
    await rendered.shell.user.click(
      within(blockMenu(0)).getByRole("menuitem", {
        name: MESSAGES.contextMenu.duplicate,
      }),
    );
    await act(settle);
    expect(rendered.canvas.blocksOfSheetA1().at(-1)?.caption).toBe("Figure 1");
  });

  // The dialog is drawn in a portal but belongs to the canvas in the React tree; a press
  // on its buttons must not reach the canvas, which takes the focus (and, in a webview,
  // the pointer) so that the click on Save never arrives.
  it("keeps a press on its buttons away from the canvas", async () => {
    const rendered = await renderFigures();
    await rendered.shell.user.click(
      within(blockMenu(0)).getByRole("menuitem", {
        name: MESSAGES.contextMenu.editCaption,
      }),
    );
    const save = screen.getByRole("button", { name: MESSAGES.caption.save });
    save.focus();
    fireEvent.pointerDown(save, { button: 0, pointerId: 1 });
    expect(document.activeElement).toBe(save);
  });

  it("is not offered for a Markdown block", async () => {
    await renderFigures();
    const names = within(blockMenu(1))
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(names).not.toContain(MESSAGES.contextMenu.editCaption);
  });
});
