// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import { makeDocumentADirty } from "./test-support/actions-harness";
import {
  applyOutsideUi,
  chooseRowMenuItem,
  renderShell,
  rowMenuButton,
  type ShellHarness,
} from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
});

const treeItem = (name: string | RegExp) =>
  screen.getByRole("treeitem", { name });

async function openDocumentByClick(harness: ShellHarness, name: string) {
  await harness.user.click(within(treeItem(name)).getByText(name));
  await screen.findByRole("tab", { name: new RegExp(name) });
}

describe("name dialog", () => {
  it("validates, announces the error inline, submits with Enter and opens the new document", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await chooseRowMenuItem(harness.user, "Project", "Documentを作成");

    const dialog = screen.getByRole("dialog", { name: "Documentを作成" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const input = within(dialog).getByRole("textbox", { name: "Document名" });
    expect(document.activeElement).toBe(input);

    await harness.user.keyboard("{Enter}");
    const alert = within(dialog).getByRole("alert");
    expect(alert.textContent).toBe("名前を入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(harness.gateway.methods("createDocument")).toEqual([]);

    await harness.user.type(input, "   {Enter}");
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "名前を入力してください。",
    );

    await harness.user.clear(input);
    await harness.user.type(input, "Design{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.methods("createDocument")).toHaveLength(1);
    expect(await screen.findByRole("tab", { name: /Design/ })).toBeTruthy();
    expect(treeItem("Design").getAttribute("aria-expanded")).toBe("true");
  });

  it("cancels with Escape and returns focus to the button that opened it", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    const opener = rowMenuButton("Project");
    await chooseRowMenuItem(harness.user, "Project", "Documentを作成");
    await screen.findByRole("dialog");

    await harness.user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(harness.gateway.methods("createDocument")).toEqual([]);
  });

  it("creates a sheet in a document that is not open yet, opening it first", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();

    await chooseRowMenuItem(harness.user, "Document B", "Sheetを作成");

    const dialog = await screen.findByRole("dialog", { name: "Sheetを作成" });
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(true);
    await harness.user.type(
      within(dialog).getByRole("textbox", { name: "Sheet名" }),
      "Second{Enter}",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const tabs = within(
      screen.getByRole("tablist", { name: "Sheet Tabs" }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet B1", "Second"]);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("creates a project from a name dialog", async () => {
    const harness = await renderShell();
    await harness.user.click(
      screen.getByRole("button", { name: "新規Project" }),
    );
    const dialog = screen.getByRole("dialog", { name: "新規Project" });
    await harness.user.type(
      within(dialog).getByRole("textbox", { name: "Project名" }),
      "Fresh{Enter}",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("treeitem", { name: "Fresh" })).toBeTruthy();
    expect(harness.gateway.methods("createProject")).toEqual(["createProject"]);
  });
});

describe("delete confirmation", () => {
  async function withSheetDeleteDialog() {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await openDocumentByClick(harness, "Document A");
    const opener = rowMenuButton("Sheet A2");
    await chooseRowMenuItem(harness.user, "Sheet A2", "Sheetを削除");
    const dialog = await screen.findByRole("dialog", {
      name: "「Sheet A2」を削除しますか？",
    });
    return { harness, dialog, opener };
  }

  it("shows the message and defaults the focus to cancel", async () => {
    const { dialog } = await withSheetDeleteDialog();
    expect(within(dialog).getByText("この操作はUndoできません。")).toBeTruthy();
    expect(
      within(dialog).queryByText(/Block本文ファイル、Assetもすべて削除/),
    ).toBeNull();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    expect(within(dialog).getByRole("button", { name: "削除" })).toBeTruthy();
  });

  it("does nothing on Escape or Cancel and returns focus to the opener", async () => {
    const { harness, opener } = await withSheetDeleteDialog();

    await harness.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    await chooseRowMenuItem(harness.user, "Sheet A2", "Sheetを削除");
    await harness.user.click(
      screen.getByRole("button", { name: "キャンセル" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(harness.gateway.methods("deleteSheet", "saveDocument")).toEqual([]);
  });

  it("deletes the sheet on confirm, updates tree and tabs and clears undo history", async () => {
    const { harness } = await withSheetDeleteDialog();
    await applyOutsideUi(() => makeDocumentADirty(harness, "Edited"));
    const session = harness.workspace.getDocumentSession(DOCUMENT_A);
    expect(session?.getState().history.canUndo).toBe(true);

    await harness.user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.methods("deleteSheet")).toEqual(["deleteSheet"]);
    expect(screen.queryByRole("treeitem", { name: "Sheet A2" })).toBeNull();
    expect(
      within(screen.getByRole("tablist", { name: "Sheet Tabs" })).queryByRole(
        "tab",
        { name: "Sheet A2" },
      ),
    ).toBeNull();
    expect(session?.getState().history.canUndo).toBe(false);
    expect(
      harness.store
        .getState()
        .documentDetails.get(DOCUMENT_A)
        ?.sheetEntries.some((entry) => entry.sheetId === SHEET_A2),
    ).toBe(false);
    // The removed button cannot take the focus back; the tree gets it.
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
  });

  it("states that a document's sheets, content files and assets go too, then deletes it", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await openDocumentByClick(harness, "Document A");
    await openDocumentByClick(harness, "Document B");

    await chooseRowMenuItem(harness.user, "Document B", "Documentを削除");

    const dialog = await screen.findByRole("dialog", {
      name: "「Document B」を削除しますか？",
    });
    expect(within(dialog).getByText("この操作はUndoできません。")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "このDocumentのSheet、Block本文ファイル、Assetもすべて削除されます。",
      ),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    expect(harness.gateway.methods("deleteDocument")).toEqual([]);

    await harness.user.click(
      within(dialog).getByRole("button", { name: "削除" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.methods("deleteDocument")).toEqual([
      "deleteDocument",
    ]);
    expect(screen.queryByRole("treeitem", { name: "Document B" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Document B/ })).toBeNull();
    expect(
      screen
        .getByRole("tab", { name: /Document A/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("traps focus and hides the background while the dialog is open", async () => {
    const { harness, dialog } = await withSheetDeleteDialog();
    const cancel = within(dialog).getByRole("button", { name: "キャンセル" });
    const confirm = within(dialog).getByRole("button", { name: "削除" });

    await harness.user.tab();
    expect(document.activeElement).toBe(confirm);
    await harness.user.tab();
    expect(document.activeElement).toBe(cancel);
    await harness.user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await harness.user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);

    // Behind the dialog: inert and hidden from the accessibility tree.
    expect(harness.container.hasAttribute("inert")).toBe(true);
    expect(harness.container.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryByRole("button", { name: "Projectを開く" })).toBeNull();

    await harness.user.keyboard("{Escape}");
    expect(harness.container.hasAttribute("inert")).toBe(false);
    expect(harness.container.hasAttribute("aria-hidden")).toBe(false);
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});
