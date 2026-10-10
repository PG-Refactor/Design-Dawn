// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renameSheetCommand } from "../../application/commands/naming-commands";
import { displayName } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_D,
  FOLDER_2,
  SHEET_A1,
  SHEET_D1,
  seedFolderTree,
} from "../../application/test-support/workspace-harness";
import {
  blockOption,
  renderOpenedCanvas,
  sourceBox,
} from "../markdown/test-support/markdown-harness";
import {
  applyOutsideUi,
  chooseRowMenuItem,
  renderShell,
  type ShellHarness,
} from "./test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "./workspace-messages";

const MESSAGES = WORKSPACE_MESSAGES.ja;

afterEach(() => {
  cleanup();
});

const TREE = MESSAGES.tree;
const MOVE = MESSAGES.dialogs.moveEntry;
const CONFIRM = MESSAGES.dialogs.confirmMoveSave;

async function openedShell(): Promise<ShellHarness> {
  const harness = await renderShell({
    seed: (seeded) => seedFolderTree(seeded.gateway),
  });
  await harness.openProjectInUi();
  await applyOutsideUi(async () => {
    await harness.actions.openDocument(DOCUMENT_A);
    await harness.actions.openDocument(DOCUMENT_D);
  });
  harness.gateway.clearCalls();
  return harness;
}

async function makeDirty(
  harness: ShellHarness,
  documentId: typeof DOCUMENT_A,
  sheetId: typeof SHEET_A1,
): Promise<void> {
  await applyOutsideUi(async () => {
    await harness.workspace
      .getDocumentSession(documentId)
      ?.execute(renameSheetCommand(sheetId, displayName("Dirty")));
  });
}

// Opens "move to..." for a row and picks a target row (null = the Project root).
async function pickTarget(
  harness: ShellHarness,
  rowName: string,
  targetName: string,
): Promise<void> {
  await chooseRowMenuItem(harness.user, rowName, TREE.moveTo);
  const dialog = screen.getByRole("dialog", { name: new RegExp(rowName) });
  await harness.user.click(within(dialog).getByText(targetName));
  await harness.user.click(
    within(dialog).getByRole("button", { name: MOVE.choose }),
  );
}

const dirtyCount = (harness: ShellHarness, documentId: typeof DOCUMENT_A) =>
  harness.store.getState().documents.get(documentId)?.save.dirtySheetIds.size;

describe("moving open documents", () => {
  it("moves an open document at once and keeps its tab and editor", async () => {
    const harness = await openedShell();
    await pickTarget(harness, "Document D", MOVE.projectRoot);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.disk.documentParents.has(DOCUMENT_D)).toBe(false);
    expect(screen.getByRole("tab", { name: /Document D/ })).toBeTruthy();
    expect(harness.store.getState().documents.has(DOCUMENT_D)).toBe(true);
  });

  it("does not ask when only another document has unsaved changes", async () => {
    const harness = await openedShell();
    await makeDirty(harness, DOCUMENT_A, SHEET_A1);
    await pickTarget(harness, "Document D", MOVE.projectRoot);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.methods("moveEntry")).toHaveLength(1);
    expect(dirtyCount(harness, DOCUMENT_A)).toBe(1);
  });
});

describe("save before move", () => {
  it("asks, saves only what moves, then moves; another dirty document stays dirty", async () => {
    const harness = await openedShell();
    await makeDirty(harness, DOCUMENT_A, SHEET_A1);
    await makeDirty(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.clearCalls();
    await pickTarget(harness, "Folder 2", MOVE.projectRoot);
    const confirm = await screen.findByRole("dialog", { name: /Folder 2/ });
    expect(confirm.textContent).toContain(CONFIRM.body);
    expect(harness.gateway.calls).toEqual([]);

    await harness.user.click(
      within(confirm).getByRole("button", { name: CONFIRM.confirm }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const methods = harness.gateway.methods();
    expect(methods.filter((method) => method === "saveSheet")).toHaveLength(1);
    expect(methods.indexOf("saveSheet")).toBeLessThan(
      methods.indexOf("moveEntry"),
    );
    expect(harness.gateway.disk.folders.get(FOLDER_2)?.parentFolderId).toBe(
      null,
    );
    expect(dirtyCount(harness, DOCUMENT_D)).toBe(0);
    expect(dirtyCount(harness, DOCUMENT_A)).toBe(1);
    expect(screen.getByRole("tab", { name: /Document D/ })).toBeTruthy();
  });

  it("leaves everything as it was on キャンセル", async () => {
    const harness = await openedShell();
    await makeDirty(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.clearCalls();
    await pickTarget(harness, "Document D", MOVE.projectRoot);
    const confirm = await screen.findByRole("dialog", { name: /Document D/ });
    expect(
      within(confirm).queryByRole("button", { name: /保存せず/ }),
    ).toBeNull();
    await harness.user.click(
      within(confirm).getByRole("button", { name: MESSAGES.dialogs.cancel }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(harness.gateway.calls).toEqual([]);
    expect(dirtyCount(harness, DOCUMENT_D)).toBe(1);
  });

  it("does not move when saving fails, and the failure stays visible", async () => {
    const harness = await openedShell();
    await makeDirty(harness, DOCUMENT_D, SHEET_D1);
    harness.gateway.clearCalls();
    harness.gateway.failAlways("saveSheet", "ioError");
    await pickTarget(harness, "Document D", MOVE.projectRoot);
    const confirm = await screen.findByRole("dialog", { name: /Document D/ });
    await harness.user.click(
      within(confirm).getByRole("button", { name: CONFIRM.confirm }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.methods("moveEntry")).toEqual([]);
    expect(harness.gateway.disk.documentParents.get(DOCUMENT_D)).toBe(FOLDER_2);
    expect(
      harness.store.getState().documents.get(DOCUMENT_D)?.save.lastError?.kind,
    ).toBe("ioError");
  });
});

describe("moving a document being edited in Markdown", () => {
  it("saves the edited text, moves, and the document stays open with its text", async () => {
    const EDITED = "# Edited before move";
    const { shell, canvas } = await renderOpenedCanvas();
    await applyOutsideUi(async () => {
      await shell.workspace.createFolder(null, "Target");
    });
    fireEvent.doubleClick(blockOption(0));
    const box = sourceBox() as HTMLTextAreaElement;
    await shell.user.clear(box);
    await shell.user.click(box);
    await shell.user.paste(EDITED);
    shell.gateway.clearCalls();

    await pickTarget(shell, "Document A", "Target");
    const confirm = await screen.findByRole("dialog", { name: /Document A/ });
    await shell.user.click(
      within(confirm).getByRole("button", { name: CONFIRM.confirm }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const path = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    expect(shell.gateway.files.get(path)).toBe(EDITED);
    const methods = shell.gateway.methods();
    expect(methods).toContain("moveEntry");
    expect(methods.indexOf("writeBlockContent")).toBeLessThan(
      methods.indexOf("moveEntry"),
    );
    expect(shell.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(screen.getByRole("tab", { name: /Document A/ })).toBeTruthy();
    // Focus-out already ended the edit; the rendered block shows the saved text.
    expect(blockOption(0).textContent).toContain("Edited before move");
  });
});
