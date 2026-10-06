// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  SHEET_A1,
  SHEET_A2,
} from "../../application/test-support/workspace-harness";
import {
  makeDocumentADirty,
  reopenedWorkspace,
  undoDepth,
} from "./test-support/actions-harness";
import {
  applyOutsideUi,
  chooseRowMenuItem,
  openRowMenu,
  renderShell,
  type ShellHarness,
  treeItemNamed,
} from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
});

const UNDO_KEYS = "{Control>}z{/Control}";
const REDO_KEYS = "{Control>}{Shift>}z{/Shift}{/Control}";

const renameBox = (name: string) =>
  screen.getByRole("textbox", { name: `${name}の名前を変更` });
const documentTab = (name: string | RegExp) =>
  screen.getByRole("tab", { name });
const sheetTab = (name: string) =>
  within(screen.getByRole("tablist", { name: "Sheet Tabs" })).getByRole("tab", {
    name,
  });

async function openedShell(): Promise<ShellHarness> {
  const harness = await renderShell();
  await harness.openProjectInUi();
  return harness;
}

async function openDocumentByClick(harness: ShellHarness, name: string) {
  await harness.user.click(within(treeItemNamed(name)).getByText(name));
  await screen.findByRole("tab", { name: new RegExp(name) });
}

// Focuses the row and presses F2.
async function startRenameWithF2(harness: ShellHarness, rowName: string) {
  treeItemNamed(rowName).focus();
  await harness.user.keyboard("{F2}");
}

describe("document rename (inline)", () => {
  it("F2 shows a focused, selected textbox; Enter renames once and everything follows", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");

    await startRenameWithF2(harness, "Document A");
    const input = renameBox("Document A") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Document A");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Document A".length);

    await harness.user.keyboard("Renamed{Enter}");

    await screen.findByRole("treeitem", { name: "Renamed" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(documentTab(/Renamed/)).toBeTruthy();
    expect(await undoDepth(harness)).toBe(1);
    expect(document.activeElement).toBe(treeItemNamed("Renamed"));
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_A);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("Ctrl+Z / Ctrl+Shift+Z with focus in the tree undo and redo the active document", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await startRenameWithF2(harness, "Document A");
    await harness.user.keyboard("Renamed{Enter}");
    await screen.findByRole("treeitem", { name: "Renamed" });

    await harness.user.keyboard(UNDO_KEYS);
    await screen.findByRole("treeitem", { name: "Document A" });
    expect(documentTab(/Document A/)).toBeTruthy();

    await harness.user.keyboard(REDO_KEYS);
    await screen.findByRole("treeitem", { name: "Renamed" });
    expect(documentTab(/Renamed/)).toBeTruthy();
  });

  it("Ctrl+Z in the tree does nothing without an active document", async () => {
    const harness = await openedShell();
    harness.gateway.clearCalls();
    treeItemNamed("Project").focus();
    await harness.user.keyboard(UNDO_KEYS);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("starts from a second click on the already selected row, not from the first or a double-click", async () => {
    const harness = await openedShell();
    const label = () =>
      within(treeItemNamed("Document A")).getByText("Document A");

    await harness.user.click(label());
    await screen.findByRole("tab", { name: /Document A/ });
    expect(screen.queryByRole("textbox")).toBeNull();

    await harness.user.dblClick(label());
    expect(screen.queryByRole("textbox")).toBeNull();

    // A pointer move elsewhere ends the double-click sequence.
    await harness.user.pointer({ target: document.body });
    await harness.user.click(label());
    expect(renameBox("Document A")).toBeTruthy();
  });

  it("starts from the row menu, which also works while another row is selected", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await chooseRowMenuItem(harness.user, "Document A", "名前変更");
    expect(document.activeElement).toBe(renameBox("Document A"));
  });

  it("Escape cancels: no command, the old name, focus back on the row", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await startRenameWithF2(harness, "Document A");

    await harness.user.keyboard("Other{Escape}");

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(treeItemNamed("Document A")).toBeTruthy();
    expect(document.activeElement).toBe(treeItemNamed("Document A"));
    expect(await undoDepth(harness)).toBe(0);
  });

  it("treats losing focus as a cancel, never as a silent commit", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await startRenameWithF2(harness, "Document A");
    await harness.user.keyboard("Other");

    await harness.user.click(document.body);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(treeItemNamed("Document A")).toBeTruthy();
    expect(await undoDepth(harness)).toBe(0);
  });

  it("Enter with an unchanged name closes the editor without a history entry", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await startRenameWithF2(harness, "Document A");

    await harness.user.keyboard("{Enter}");

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(await undoDepth(harness)).toBe(0);
    expect(document.activeElement).toBe(treeItemNamed("Document A"));
  });

  it("keeps the editor open with an inline alert for an empty or whitespace-only name", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await startRenameWithF2(harness, "Document A");
    const input = renameBox("Document A");

    await harness.user.clear(input);
    await harness.user.keyboard("{Enter}");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("名前を入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(input);

    await harness.user.type(input, "   {Enter}");
    expect(screen.getByRole("alert").textContent).toBe(
      "名前を入力してください。",
    );
    expect(await undoDepth(harness)).toBe(0);
    expect(documentTab(/Document A/)).toBeTruthy();

    await harness.user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(treeItemNamed("Document A")).toBeTruthy();
    expect(await undoDepth(harness)).toBe(0);
  });

  it("renaming a document that is not open opens it first (a tab appears), then renames", async () => {
    const harness = await openedShell();
    expect(screen.queryByRole("tab")).toBeNull();

    await chooseRowMenuItem(harness.user, "Document B", "名前変更");

    expect(await screen.findByRole("tab", { name: /Document B/ })).toBeTruthy();
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(true);
    expect(document.activeElement).toBe(renameBox("Document B"));
    await harness.user.keyboard("Beta{Enter}");

    await screen.findByRole("treeitem", { name: "Beta" });
    expect(documentTab(/Beta/)).toBeTruthy();
    expect(await undoDepth(harness, DOCUMENT_B)).toBe(1);
  });

  it("is unavailable for a document that failed to load", async () => {
    const harness = await openedShell();
    const failed = treeItemNamed(/読み込み失敗/);
    failed.focus();
    await harness.user.keyboard("{F2}");
    expect(screen.queryByRole("textbox")).toBeNull();

    const menu = await openRowMenu(harness.user, failed);
    const item = within(menu).getByRole("menuitem", { name: "名前変更" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    await harness.user.click(item);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(harness.gateway.methods("loadDocument")).toEqual([]);
    expect(harness.store.getState().documents.has(FAILED_DOCUMENT_ID)).toBe(
      false,
    );
  });

  it("is saved: a new workspace over the same disk shows the new name", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await startRenameWithF2(harness, "Document A");
    await harness.user.keyboard("Renamed{Enter}");
    await screen.findByRole("treeitem", { name: "Renamed" });
    await harness.runAutoSave();

    const { store, workspace } = await reopenedWorkspace(harness);
    expect(
      store.getState().project?.documents.map((entry) => entry.name),
    ).toEqual(["Renamed", "Document B", null]);
    await workspace.openDocument(DOCUMENT_A);
    expect(store.getState().documents.get(DOCUMENT_A)?.document.name).toBe(
      "Renamed",
    );
  });
});

describe("sheet rename (inline, in the Sheet Tabs)", () => {
  async function withDocumentA() {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    return harness;
  }

  async function startSheetRenameWithF2(harness: ShellHarness, name: string) {
    sheetTab(name).focus();
    await harness.user.keyboard("{F2}");
  }

  const sheetTabNames = () =>
    within(screen.getByRole("tablist", { name: "Sheet Tabs" }))
      .getAllByRole("tab")
      .map((tab) => tab.textContent);

  it("F2 + Enter renames once in the tab; the active sheet is unchanged; undo and redo follow", async () => {
    const harness = await withDocumentA();
    expect(sheetTab("Sheet A1").getAttribute("aria-selected")).toBe("true");

    await startSheetRenameWithF2(harness, "Sheet A2");
    const input = renameBox("Sheet A2") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe("Sheet A2".length);
    await harness.user.keyboard("Second{Enter}");

    await waitFor(() =>
      expect(sheetTabNames()).toEqual(["Sheet A1", "Second"]),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(sheetTab("Sheet A1").getAttribute("aria-selected")).toBe("true");
    expect(await undoDepth(harness)).toBe(1);
    expect(document.activeElement).toBe(sheetTab("Second"));

    await applyOutsideUi(() => harness.canvasActions.undo(DOCUMENT_A));
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
    await applyOutsideUi(() => harness.canvasActions.redo(DOCUMENT_A));
    expect(sheetTabNames()).toEqual(["Sheet A1", "Second"]);
  });

  it("starts from a double-click on a tab and selects it on the way", async () => {
    const harness = await withDocumentA();
    await harness.user.dblClick(sheetTab("Sheet A2"));
    expect(document.activeElement).toBe(renameBox("Sheet A2"));
    expect(sheetTab("Sheet A2").getAttribute("aria-selected")).toBe("true");
    await harness.user.keyboard("{Escape}");
    expect(await undoDepth(harness)).toBe(0);
  });

  it("Escape and losing focus cancel; an unchanged name and invalid names create no history entry", async () => {
    const harness = await withDocumentA();
    await startSheetRenameWithF2(harness, "Sheet A2");
    await harness.user.keyboard("Other{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(await undoDepth(harness)).toBe(0);
    expect(document.activeElement).toBe(sheetTab("Sheet A2"));

    await startSheetRenameWithF2(harness, "Sheet A2");
    await harness.user.keyboard("Other");
    await harness.user.click(document.body);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
    expect(await undoDepth(harness)).toBe(0);

    await startSheetRenameWithF2(harness, "Sheet A2");
    await harness.user.keyboard("{Enter}");
    expect(await undoDepth(harness)).toBe(0);

    await startSheetRenameWithF2(harness, "Sheet A2");
    const input = renameBox("Sheet A2");
    await harness.user.clear(input);
    await harness.user.keyboard("{Enter}");
    expect(screen.getByRole("alert").textContent).toBe(
      "名前を入力してください。",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    await harness.user.keyboard("{Escape}");
    expect(await undoDepth(harness)).toBe(0);
    expect(sheetTab("Sheet A2")).toBeTruthy();
  });

  it("keeps the keys in the input: arrows, Ctrl+Arrow and F2 do not move, reorder or restart anything", async () => {
    const harness = await withDocumentA();
    await startSheetRenameWithF2(harness, "Sheet A2");
    const input = renameBox("Sheet A2");
    await harness.user.keyboard(
      "{ArrowLeft}{Control>}{ArrowLeft}{/Control}{F2}{Home}",
    );
    expect(document.activeElement).toBe(input);
    expect(sheetTabNames()).toEqual(["Sheet A1", "Sheet A2"]);
    expect(sheetTab("Sheet A1").getAttribute("aria-selected")).toBe("true");
    expect(await undoDepth(harness)).toBe(0);
  });

  it("is saved: the sheet file handed to the gateway has the new name", async () => {
    const harness = await withDocumentA();
    await startSheetRenameWithF2(harness, "Sheet A2");
    await harness.user.keyboard("Second{Enter}");
    await waitFor(() => expect(sheetTab("Second")).toBeTruthy());
    await harness.runAutoSave();

    // The fake gateway records saved sheets instead of writing them to its fake disk.
    expect(harness.gateway.savedSheets.get(SHEET_A2)?.name).toBe("Second");
    expect(harness.gateway.methods("saveSheet")).toEqual(["saveSheet"]);
  });

  it("the failed sheet is not a tab, so it cannot be renamed", async () => {
    await withDocumentA();
    expect(
      within(screen.getByRole("tablist", { name: "Sheet Tabs" })).getAllByRole(
        "tab",
      ),
    ).toHaveLength(2);
    expect(screen.queryByRole("treeitem", { name: /Sheet/ })).toBeNull();
  });
});

describe("keyboard isolation of the rename input", () => {
  it("keeps Delete, Backspace, arrows, Ctrl+Z and F2 inside the input", async () => {
    const harness = await openedShell();
    await openDocumentByClick(harness, "Document A");
    await applyOutsideUi(() => makeDocumentADirty(harness, "Edited"));
    expect(await undoDepth(harness)).toBe(1);
    harness.gateway.clearCalls();

    await startRenameWithF2(harness, "Document A");
    const input = renameBox("Document A") as HTMLInputElement;
    await harness.user.keyboard(
      "{ArrowDown}{ArrowUp}{Home}{End}{Delete}{Backspace}",
    );
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Document ");
    expect(screen.queryByRole("dialog")).toBeNull();

    await harness.user.keyboard(UNDO_KEYS);
    await harness.user.keyboard(REDO_KEYS);
    await harness.user.keyboard("{F2}");
    expect(await undoDepth(harness)).toBe(1);
    expect(
      harness.workspace
        .getDocumentSession(DOCUMENT_A)
        ?.getState()
        .sheets.get(SHEET_A1)?.name,
    ).toBe("Edited");
    expect(document.activeElement).toBe(input);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(
      harness.gateway.methods(
        "deleteSheet",
        "deleteDocument",
        "deleteBlockContent",
      ),
    ).toEqual([]);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("Enter and Escape in the input end only the rename: nothing is activated or opened", async () => {
    const harness = await openedShell();
    await startRenameWithF2(harness, "Document B");
    await screen.findByRole("tab", { name: /Document B/ });
    harness.gateway.clearCalls();
    await harness.user.keyboard("{Escape}");
    expect(harness.gateway.calls).toEqual([]);
    expect(harness.uiStateStore.getState().dialog.kind).toBe("none");
  });
});
