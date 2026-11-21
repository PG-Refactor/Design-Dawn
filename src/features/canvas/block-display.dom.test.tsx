// @vitest-environment jsdom
// The display size buttons of Markdown and Mermaid blocks: each press is one change of the
// Document (undone in one step), kept in the block's file only when it differs from the
// default, carried by a copy; image blocks have none.
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
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

const MESSAGES = CANVAS_MESSAGES.ja.display;

let objectUrls: ObjectUrlFake;

beforeEach(() => {
  objectUrls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  objectUrls.restore();
});

// A Markdown block, a Mermaid block and an image block.
async function renderBlocks(): Promise<RenderedCanvas> {
  return renderOpenedCanvas(
    (harness: ActionsHarness): void => {
      const blocks = [
        makeBlockAt(1, 10, 20),
        makeBlockAt(2, 300, 40, "mermaid"),
        makeBlockAt(3, 600, 40, "image"),
      ];
      seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
      harness.gateway.files.set(blocks[0]?.contentPath ?? "", "# Title");
      harness.gateway.files.set(
        blocks[1]?.contentPath ?? "",
        "flowchart LR\n  A --> B",
      );
    },
    { mermaidRenderer: createFakeRenderer() },
  );
}

// Shown only while the pointer is on the block (CSS), which jsdom cannot do: the controls
// are looked up among the hidden ones, by their label (a hidden element's accessible name
// is not worked out).
const HIDDEN = { hidden: true } as const;

const groups = () =>
  screen
    .queryAllByRole("group", HIDDEN)
    .filter((group) =>
      group.getAttribute("aria-label")?.endsWith("の表示サイズ"),
    );

const button = (group: HTMLElement, label: string) => {
  const found = within(group)
    .getAllByRole("button", HIDDEN)
    .find((candidate) => candidate.getAttribute("aria-label") === label);
  if (found === undefined) throw new Error(`no button ${label}`);
  return found;
};

const blockAt = (rendered: RenderedCanvas, index: number) =>
  rendered.canvas.blocksOfSheetA1()[index];

describe("block display size", () => {
  it("is offered on Markdown and Mermaid blocks only", async () => {
    await renderBlocks();
    expect(groups()).toHaveLength(2);
  });

  it("steps the text size by 10% per press, undone in one step each", async () => {
    const rendered = await renderBlocks();
    const [markdown] = groups();
    if (markdown === undefined) throw new Error("no controls");
    const larger = button(markdown, MESSAGES.larger);
    await rendered.shell.user.click(larger);
    await rendered.shell.user.click(larger);
    await settle();
    expect(blockAt(rendered, 0)?.contentScalePercent).toBe(120);
    expect(button(markdown, MESSAGES.reset).textContent).toBe("120%");
    await act(async () => {
      await rendered.canvas.canvasActions.undo(DOCUMENT_A);
    });
    expect(blockAt(rendered, 0)?.contentScalePercent).toBe(110);

    // Back to 100%: nothing is kept on the block.
    await rendered.shell.user.click(button(markdown, MESSAGES.reset));
    await settle();
    expect(blockAt(rendered, 0)?.contentScalePercent).toBeUndefined();
  });

  it("fits a diagram by default and turns that off and on", async () => {
    const rendered = await renderBlocks();
    const diagram = groups()[1];
    if (diagram === undefined) throw new Error("no controls");
    const auto = button(diagram, MESSAGES.autoFit);
    expect(auto.getAttribute("aria-pressed")).toBe("true");
    await rendered.shell.user.click(auto);
    await settle();
    expect(blockAt(rendered, 1)?.autoFit).toBe(false);
    expect(auto.getAttribute("aria-pressed")).toBe("false");
    await rendered.shell.user.click(auto);
    await settle();
    // On again is the default for a diagram: nothing is kept.
    expect(blockAt(rendered, 1)?.autoFit).toBeUndefined();
  });

  it("does not select or drag the block when a button is pressed", async () => {
    const rendered = await renderBlocks();
    const [markdown] = groups();
    if (markdown === undefined) throw new Error("no controls");
    const before = blockAt(rendered, 0)?.position;
    await rendered.shell.user.click(button(markdown, MESSAGES.larger));
    await settle();
    expect(blockAt(rendered, 0)?.position).toEqual(before);
  });
});
