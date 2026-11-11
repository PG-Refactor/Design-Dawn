// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
} from "../../application/test-support/workspace-harness";
import { renderOpenedCanvas } from "../markdown/test-support/markdown-harness";
import { openMenu } from "../workspace/test-support/menu-helpers";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { EXPORT_MESSAGES } from "./export-messages";

const MESSAGES = EXPORT_MESSAGES.ja;
const TOP_BAR = WORKSPACE_MESSAGES.ja.topBar;

afterEach(() => {
  cleanup();
});

async function openExportDocuments(
  shell: Awaited<ReturnType<typeof renderOpenedCanvas>>["shell"],
) {
  const menu = await openMenu(shell.user, TOP_BAR.fileMenu);
  await shell.user.click(
    within(menu).getByRole("menuitem", { name: TOP_BAR.exportMenu }),
  );
  await shell.user.click(
    within(
      await screen.findByRole("menu", { name: TOP_BAR.exportMenu }),
    ).getByRole("menuitem", { name: MESSAGES.documentsMenu }),
  );
  return screen.getByRole("dialog", { name: MESSAGES.documentsTitle });
}

describe("Export Documents", () => {
  it("prints each chosen Document to PDF in the folder, opening the closed ones only meanwhile", async () => {
    const { shell } = await renderOpenedCanvas();
    const dialog = await openExportDocuments(shell);
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .every((box) => (box as HTMLInputElement).checked),
    ).toBe(true);
    await shell.user.click(
      within(dialog).getByRole("radio", { name: MESSAGES.formatPdf }),
    );
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
