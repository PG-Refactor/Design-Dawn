// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  blockIdOf,
  settle,
  textOf,
} from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import { BLOCK_ONE } from "../canvas/test-support/canvas-harness";
import { renderOpenedCanvas } from "../markdown/test-support/markdown-harness";

afterEach(() => {
  cleanup();
});

async function openSearchTab(
  shell: Awaited<ReturnType<typeof renderOpenedCanvas>>["shell"],
) {
  await shell.user.click(screen.getByRole("tab", { name: "検索" }));
  return screen.getByRole("region", { name: "検索" });
}

describe("the Search tab", () => {
  it("searches the open Document's text in the app, including unsaved text", async () => {
    const { shell } = await renderOpenedCanvas();
    const panel = await openSearchTab(shell);
    await shell.user.type(
      within(panel).getByRole("searchbox", { name: "検索する文字" }),
      "TEXT OF",
    );
    await shell.user.click(within(panel).getByRole("button", { name: "検索" }));
    await act(settle);
    expect(within(panel).getByRole("status").textContent).toContain("件");
    expect(
      within(panel)
        .getAllByRole("button", { name: /行目/ })
        .some((row) => row.textContent?.includes(textOf(BLOCK_ONE))),
    ).toBe(true);
  });

  it("shows what Rust found in a Document that is not open, and reveals it", async () => {
    const { shell } = await renderOpenedCanvas();
    const blockId = blockIdOf(40);
    shell.gateway.scriptSearch({
      matches: [
        {
          documentId: DOCUMENT_B,
          documentName: "Document B",
          sheetId: SHEET_B1,
          sheetName: "Sheet B1",
          blockId,
          blockType: "markdown",
          place: "text",
          line: 2,
          excerpt: "the order api",
          matchStart: 4,
          matchLength: 5,
        },
      ],
      truncated: false,
      unreadableBlocks: 0,
    });
    const panel = await openSearchTab(shell);
    await shell.user.type(
      within(panel).getByRole("searchbox", { name: "検索する文字" }),
      "order",
    );
    await shell.user.click(within(panel).getByRole("button", { name: "検索" }));
    await act(settle);
    const row = within(panel).getByRole("button", { name: /2 行目/ });
    expect(row.querySelector("mark")?.textContent).toBe("order");
    expect(within(panel).getByText("Document B / Sheet B1")).toBeTruthy();
    await shell.user.click(row);
    await act(settle);
    expect(shell.store.getState().documents.has(DOCUMENT_B)).toBe(true);
  });

  it("replaces text in a Block and searches again", async () => {
    const { shell } = await renderOpenedCanvas();
    const panel = await openSearchTab(shell);
    await shell.user.type(
      within(panel).getByRole("searchbox", { name: "検索する文字" }),
      textOf(BLOCK_ONE),
    );
    await shell.user.type(
      within(panel).getByRole("textbox", { name: "置換後の文字" }),
      "replaced",
    );
    await shell.user.click(within(panel).getByRole("button", { name: "検索" }));
    await act(settle);
    await shell.user.click(
      within(panel).getByRole("button", { name: /の中を置換/ }),
    );
    await act(settle);
    expect(
      shell.store.getState().documents.get(DOCUMENT_A)?.contents.get(BLOCK_ONE),
    ).toBe("replaced");
    expect(within(panel).getByRole("status").textContent).toContain(
      "1 か所を置換しました。",
    );
  });
});
