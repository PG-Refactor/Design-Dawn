// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { renderOpenedCanvas } from "../markdown/test-support/markdown-harness";
import { SPREADSHEET_MESSAGES } from "./spreadsheet-messages";

const MESSAGES = SPREADSHEET_MESSAGES.ja;

afterEach(() => {
  cleanup();
});

const cell = (text: string, number = false) => ({ text, number });

async function openImport() {
  const rendered = await renderOpenedCanvas();
  const { shell } = rendered;
  shell.gateway.scriptSpreadsheet({
    status: "selected",
    fileName: "spec.xlsx",
    sheets: [
      {
        name: "Prices",
        hidden: false,
        firstRow: 0,
        firstColumn: 0,
        rows: [
          [cell("Item"), cell("Price"), cell("Note")],
          [cell("A"), cell("1,200", true), cell("x")],
          [cell("B"), cell("300", true), cell("y")],
        ],
        hiddenRows: [],
        hiddenColumns: [2],
        merged: [],
        truncated: false,
      },
      {
        name: "Internal",
        hidden: true,
        firstRow: 0,
        firstColumn: 0,
        rows: [[cell("secret")]],
        hiddenRows: [],
        hiddenColumns: [],
        merged: [],
        truncated: false,
      },
    ],
  });
  await shell.user.click(screen.getByRole("button", { name: "+ Block" }));
  await shell.user.click(
    screen.getByRole("menuitem", { name: "表計算ファイルから表…" }),
  );
  await act(settle);
  return {
    ...rendered,
    dialog: screen.getByRole("dialog", { name: MESSAGES.title("spec.xlsx") }),
  };
}

const importedTexts = (rendered: Awaited<ReturnType<typeof openImport>>) =>
  [
    ...(rendered.shell.store
      .getState()
      .documents.get(DOCUMENT_A)
      ?.contents.values() ?? []),
  ].filter((text) => text.startsWith("## "));

describe("the spreadsheet import dialog", () => {
  it("previews the visible sheet with the default choices and imports it", async () => {
    const rendered = await openImport();
    const { dialog, shell } = rendered;
    const hiddenSheet = within(dialog).getByRole("checkbox", {
      name: /Internal/,
    }) as HTMLInputElement;
    expect(hiddenSheet.disabled).toBe(true);
    expect(hiddenSheet.checked).toBe(false);
    // The hidden column is left out; numbers are right-aligned.
    const preview = within(dialog).getByRole("region", {
      name: MESSAGES.previewHeading("Prices"),
    });
    expect(
      within(preview)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Item", "Price"]);
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.importButton }),
    );
    await act(settle);
    expect(importedTexts(rendered)).toEqual([
      "## Prices\n\n| Item | Price |\n| ---- | ----: |\n| A    | 1,200 |\n| B    | 300   |\n",
    ]);
  });

  it("takes a range, refuses one that is not, and can include hidden sheets", async () => {
    const rendered = await openImport();
    const { dialog, shell } = rendered;
    const range = within(dialog).getByRole("textbox", {
      name: MESSAGES.rangeLabel("Prices"),
    });
    await shell.user.type(range, "B9:");
    expect(within(dialog).getByRole("alert").textContent).toBe(
      MESSAGES.invalidRange,
    );
    expect(
      (
        within(dialog).getByRole("button", {
          name: MESSAGES.importButton,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await shell.user.clear(range);
    await shell.user.type(range, "A1:B2");
    await shell.user.click(
      within(dialog).getByRole("checkbox", { name: MESSAGES.skipHidden }),
    );
    await shell.user.click(
      within(dialog).getByRole("checkbox", { name: /Internal/ }),
    );
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.importButton }),
    );
    await act(settle);
    expect(importedTexts(rendered)).toEqual([
      "## Prices\n\n| Item | Price |\n| ---- | ----: |\n| A    | 1,200 |\n",
      "## Internal\n\n| secret |\n| ------ |\n",
    ]);
  });

  it("adds nothing when cancelled", async () => {
    const rendered = await openImport();
    await rendered.shell.user.click(
      within(rendered.dialog).getByRole("button", { name: MESSAGES.cancel }),
    );
    await act(settle);
    expect(importedTexts(rendered)).toEqual([]);
  });
});
