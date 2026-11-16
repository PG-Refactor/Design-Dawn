// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { renderOpenedCanvas } from "../markdown/test-support/markdown-harness";
import { openMenu } from "../workspace/test-support/menu-helpers";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { EXPORT_MESSAGES } from "./export-messages";

// jsdom does not load an iframe's srcdoc: the page measurement is given.
vi.mock("./print-frame", () => ({
  measurePrintPage: async () => ({ blocks: 1, overflowing: 0 }),
}));

const MESSAGES = EXPORT_MESSAGES.ja;
const TOP_BAR = WORKSPACE_MESSAGES.ja.topBar;

afterEach(() => {
  cleanup();
});

const ITEM_OF = {
  md: MESSAGES.exportMarkdownItem,
  html: MESSAGES.exportHtmlItem,
  pdf: MESSAGES.exportPdfItem,
} as const;
const TITLE_OF = {
  md: MESSAGES.exportMarkdownTitle,
  html: MESSAGES.exportHtmlTitle,
  pdf: MESSAGES.exportPdfTitle,
} as const;

async function openExport(
  shell: Awaited<ReturnType<typeof renderOpenedCanvas>>["shell"],
  format: keyof typeof ITEM_OF = "md",
) {
  const menu = await openMenu(shell.user, TOP_BAR.fileMenu);
  await shell.user.click(
    within(menu).getByRole("menuitem", { name: MESSAGES.exportMenuItem }),
  );
  await shell.user.click(
    within(
      await screen.findByRole("menu", { name: MESSAGES.exportMenuItem }),
    ).getByRole("menuitem", { name: ITEM_OF[format] }),
  );
  return screen.getByRole("dialog", { name: TITLE_OF[format] });
}

async function openExportDocuments(
  shell: Awaited<ReturnType<typeof renderOpenedCanvas>>["shell"],
  format: keyof typeof ITEM_OF = "md",
) {
  const dialog = await openExport(shell, format);
  await shell.user.click(
    within(dialog).getByRole("radio", { name: MESSAGES.scopeChoose }),
  );
  return dialog;
}

describe("Export of the shown sheet or Document", () => {
  it("writes the shown sheet as Markdown through the save dialog", async () => {
    const { shell } = await renderOpenedCanvas();
    const dialog = await openExport(shell);
    await shell.user.click(
      within(dialog).getByRole("radio", {
        name: MESSAGES.scopeSheet("Document A", "Sheet A1"),
      }),
    );
    shell.gateway.clearCalls();
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.exportFile }),
    );
    await act(settle);
    expect(
      shell.gateway.calls.find(
        (call) => call.method === "exportDocumentMarkdown",
      )?.detail,
    ).toBe(`${DOCUMENT_A}:${SHEET_A1}:Document A - Sheet A1`);
    expect(within(dialog).getByRole("status").textContent).toBe(
      MESSAGES.savedAs("Document A - Sheet A1.md"),
    );
  });

  it("writes the shown Document as one PDF without the print dialog", async () => {
    const { shell } = await renderOpenedCanvas();
    const dialog = await openExport(shell, "pdf");
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.exportFile }),
    );
    await act(settle);
    expect(shell.gateway.methods("exportPdfFile")).toHaveLength(1);
  });
});

describe("Export Documents", () => {
  it("prints each chosen Document to PDF in the folder, opening the closed ones only meanwhile", async () => {
    const { shell } = await renderOpenedCanvas();
    const dialog = await openExportDocuments(shell, "pdf");
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .filter((box) => box.closest("ul") !== null)
        .every((box) => (box as HTMLInputElement).checked),
    ).toBe(true);
    shell.gateway.clearCalls();
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.chooseFolder }),
    );
    await act(settle);
    expect(
      shell.gateway.calls
        .filter((call) => call.method === "exportPdfIntoFolder")
        .map((call) => call.detail.split(":")[0]),
    ).toContain("Document A");
    // Document B has no blocks: nothing to print, listed as such.
    expect(within(dialog).getByRole("status").textContent).toContain(
      MESSAGES.nothingToExport,
    );
    expect(shell.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(shell.store.getState().documents.has(DOCUMENT_B)).toBe(false);
  });

  it("asks before replacing files already in the folder", async () => {
    const { shell } = await renderOpenedCanvas();
    shell.gateway.exportFolderFiles.add("Document A.md");
    const dialog = await openExportDocuments(shell);
    await shell.user.click(
      within(dialog).getByRole("checkbox", { name: "Document B" }),
    );
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.chooseFolder }),
    );
    await act(settle);
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Document A.md",
    );
    expect(shell.gateway.methods("exportMarkdownIntoFolder")).toHaveLength(0);
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.replaceAndExport }),
    );
    await act(settle);
    expect(shell.gateway.methods("exportMarkdownIntoFolder")).toHaveLength(1);
    expect(within(dialog).getByRole("status").textContent).toBe(
      MESSAGES.exported(1, "exports"),
    );
  });
});

describe("printing", () => {
  it("opens the print dialog with Ctrl+P", async () => {
    const { shell } = await renderOpenedCanvas();
    await shell.user.keyboard("{Control>}p{/Control}");
    expect(
      screen.getByRole("dialog", { name: MESSAGES.printTitle }),
    ).toBeTruthy();
  });

  it("prints in a print window of its own", async () => {
    const { shell } = await renderOpenedCanvas();
    await shell.user.keyboard("{Control>}p{/Control}");
    const dialog = screen.getByRole("dialog", { name: MESSAGES.printTitle });
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.printButton }),
    );
    await act(settle);
    expect(shell.gateway.methods("openPrintWindow")).toHaveLength(1);
    expect(
      screen.queryByRole("dialog", { name: MESSAGES.printTitle }),
    ).toBeNull();
  });

  it("offers to save unsaved changes before printing", async () => {
    const { shell, canvas } = await renderOpenedCanvas();
    const block = canvas.blocksOfSheetA1()[0];
    await act(async () => {
      await shell.canvasActions.commitContentEdit({
        documentId: DOCUMENT_A,
        sheetId: SHEET_A1,
        blockId: block?.blockId ?? ("" as never),
        text: "changed",
      });
    });
    await shell.user.keyboard("{Control>}p{/Control}");
    const dialog = screen.getByRole("dialog", { name: MESSAGES.printTitle });
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.printButton }),
    );
    expect(within(dialog).getByRole("alert").textContent).toBe(
      MESSAGES.unsavedBeforePrint,
    );
    expect(shell.gateway.methods("openPrintWindow")).toHaveLength(0);
    shell.gateway.clearCalls();
    await shell.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.saveAndPrint }),
    );
    await act(settle);
    expect(shell.gateway.methods("writeBlockContent").length).toBeGreaterThan(
      0,
    );
    expect(shell.gateway.methods("openPrintWindow")).toHaveLength(1);
  });

  it("asks before closing the window while a print window is open", async () => {
    const { shell } = await renderOpenedCanvas();
    shell.gateway.printWindows.count = 1;
    shell.closeRequestSource.emit({ subscriptionToken: "token" });
    const question = await screen.findByRole("dialog", {
      name: MESSAGES.closeWhilePrintingTitle,
    });
    await shell.user.click(
      within(question).getByRole("button", { name: MESSAGES.cancel }),
    );
    await act(settle);
    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);
    expect(shell.gateway.printWindows.count).toBe(1);

    shell.closeRequestSource.emit({ subscriptionToken: "token" });
    await shell.user.click(
      within(
        await screen.findByRole("dialog", {
          name: MESSAGES.closeWhilePrintingTitle,
        }),
      ).getByRole("button", { name: MESSAGES.closeAnyway }),
    );
    await act(settle);
    expect(shell.gateway.printWindows.count).toBe(0);
    expect(shell.closeRequestSource.confirmedTokens).toEqual(["token"]);
  });

  it("shows the paper pages on the canvas from the View menu", async () => {
    const { shell } = await renderOpenedCanvas();
    expect(document.querySelector(".canvas__page")).toBeNull();
    const menu = await openMenu(shell.user, TOP_BAR.viewMenu);
    await shell.user.click(
      within(menu).getByRole("menuitemcheckbox", {
        name: MESSAGES.showPageBreaks,
      }),
    );
    const pages = document.querySelectorAll(".canvas__page");
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]?.textContent).toContain("A4");
  });
});
