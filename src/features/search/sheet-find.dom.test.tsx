// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { parseCaption } from "../../domain/block/caption";
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

let objectUrls: ObjectUrlFake;

beforeEach(() => {
  objectUrls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  objectUrls.restore();
});

function caption(text: string) {
  const parsed = parseCaption(text);
  if (!parsed.ok) throw new Error("bad caption");
  return parsed.value;
}

// Read top to bottom: the Markdown block (two matches), then the diagram (one in its
// text, one in its caption).
async function renderSheet(): Promise<RenderedCanvas> {
  return renderOpenedCanvas(
    (harness: ActionsHarness): void => {
      const blocks = [
        makeBlockAt(1, 10, 20),
        {
          ...makeBlockAt(2, 10, 300, "mermaid"),
          caption: caption("Order flow"),
        },
      ];
      seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
      harness.gateway.files.set(
        blocks[0]?.contentPath ?? "",
        "# Order\nThe order api",
      );
      harness.gateway.files.set(
        blocks[1]?.contentPath ?? "",
        "flowchart LR\n  A[order] --> B",
      );
    },
    { mermaidRenderer: createFakeRenderer() },
  );
}

function findBox() {
  // jsdom gives the <search> element no role yet.
  return screen.getByLabelText("シート内の検索", { selector: "search" });
}

function textOfBlock(rendered: RenderedCanvas, index: number) {
  const block = rendered.canvas.blocksOfSheetA1()[index];
  return rendered.shell.store
    .getState()
    .documents.get(DOCUMENT_A)
    ?.contents.get(block?.blockId ?? ("" as never));
}

describe("the find box of the sheet (Ctrl+F)", () => {
  it("opens with Ctrl+F, counts the matches and moves through them", async () => {
    const rendered = await renderSheet();
    const { user } = rendered.shell;
    await user.keyboard("{Control>}f{/Control}");
    const box = findBox();
    const query = within(box).getByRole("searchbox", { name: "検索する文字" });
    expect(document.activeElement).toBe(query);
    await user.type(query, "order");
    await act(settle);
    expect(within(box).getByRole("status").textContent).toBe("1 / 4");
    const firstId = rendered.canvas.blocksOfSheetA1()[0]?.blockId;
    expect(
      rendered.shell.uiStateStore.getState().selectionBySheet.get(SHEET_A1),
    ).toEqual(new Set([firstId]));
    await user.keyboard("{Enter}{Enter}");
    await act(settle);
    expect(within(box).getByRole("status").textContent).toBe("3 / 4");
    const secondId = rendered.canvas.blocksOfSheetA1()[1]?.blockId;
    expect(
      rendered.shell.uiStateStore.getState().selectionBySheet.get(SHEET_A1),
    ).toEqual(new Set([secondId]));
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(within(box).getByRole("status").textContent).toBe("2 / 4");
    await user.keyboard("{Escape}");
    expect(document.querySelector("search")).toBeNull();
  });

  it("replaces the current match only, then all of them including the caption", async () => {
    const rendered = await renderSheet();
    const { user } = rendered.shell;
    await user.keyboard("{Control>}f{/Control}");
    const box = findBox();
    await user.type(
      within(box).getByRole("searchbox", { name: "検索する文字" }),
      "order",
    );
    await user.click(
      within(box).getByRole("button", { name: "置換の表示を切り替え" }),
    );
    await user.type(
      within(box).getByRole("textbox", { name: "置換後の文字" }),
      "受注",
    );
    await user.click(within(box).getByRole("button", { name: "置換" }));
    await act(settle);
    expect(textOfBlock(rendered, 0)).toBe("# 受注\nThe order api");
    expect(within(box).getByRole("status").textContent).toBe("1 / 3");

    await user.click(within(box).getByRole("button", { name: "すべて置換" }));
    await act(settle);
    expect(textOfBlock(rendered, 0)).toBe("# 受注\nThe 受注 api");
    expect(textOfBlock(rendered, 1)).toBe("flowchart LR\n  A[受注] --> B");
    expect(rendered.canvas.blocksOfSheetA1()[1]?.caption).toBe("受注 flow");
    expect(within(box).getByRole("status").textContent).toBe("結果なし");
  });
});

describe("Ctrl+Shift+F", () => {
  it("opens the Search tab with the focus in its box", async () => {
    const rendered = await renderSheet();
    await rendered.shell.user.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
    const panel = screen.getByRole("region", { name: "検索" });
    expect(document.activeElement).toBe(
      within(panel).getByRole("searchbox", { name: "検索する文字" }),
    );
  });
});
