// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  FOLDER_1,
  FOLDER_2,
  seedFolderTree,
} from "../../application/test-support/workspace-harness";
import {
  chooseRowMenuItem,
  renderShell,
  type ShellHarness,
} from "./test-support/shell-harness";
import { MESSAGES } from "./workspace-messages";

afterEach(() => {
  cleanup();
});

const MOVE = MESSAGES.dialogs.moveEntry;
const TREE = MESSAGES.tree;

async function openedMoveDialog(
  rowName: string,
): Promise<{ harness: ShellHarness; dialog: HTMLElement }> {
  const harness = await renderShell({
    seed: (seeded) => seedFolderTree(seeded.gateway),
  });
  await harness.openProjectInUi();
  harness.gateway.clearCalls();
  await chooseRowMenuItem(harness.user, rowName, TREE.moveTo);
  const dialog = screen.getByRole("dialog", {
    name: new RegExp(rowName),
  });
  return { harness, dialog };
}

const row = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole("treeitem", { name });
const rowNames = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole("treeitem")
    .map((item) => item.querySelector(".tree-item__label")?.textContent);

describe("move dialog tree keyboard", () => {
  it("navigates, folds and unfolds like the Project Tree", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    const { user } = harness;
    expect(document.activeElement).toBe(row(dialog, "Folder 1"));

    // Expanded: ArrowRight goes to the first child; a leaf's ArrowLeft goes to the parent.
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(row(dialog, "Folder 2"));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(row(dialog, "Folder 1"));

    // Expanded: ArrowLeft folds it; ArrowRight unfolds it again.
    await user.keyboard("{ArrowLeft}");
    expect(row(dialog, "Folder 1").getAttribute("aria-expanded")).toBe("false");
    expect(rowNames(dialog)).toEqual([MOVE.projectRoot, "Folder 1"]);
    await user.keyboard("{ArrowRight}");
    expect(rowNames(dialog)).toEqual([
      MOVE.projectRoot,
      "Folder 1",
      "Folder 2",
    ]);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(row(dialog, "Folder 2"));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(row(dialog, MOVE.projectRoot));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row(dialog, "Folder 1"));
    // Highlight follows focus.
    expect(row(dialog, "Folder 1").getAttribute("aria-selected")).toBe("true");
    expect(row(dialog, MOVE.projectRoot).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("folds with the marker click and keeps that row highlighted", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    const marker = row(dialog, "Folder 1").querySelector(
      ".move-target__marker",
    );
    await harness.user.click(marker as Element);
    expect(rowNames(dialog)).toEqual([MOVE.projectRoot, "Folder 1"]);
    expect(row(dialog, "Folder 1").getAttribute("aria-selected")).toBe("true");
  });

  it("chooses the focused row with Enter, but not a disabled one", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    const { user } = harness;
    await user.keyboard("{Home}{Enter}");
    expect(harness.gateway.methods("moveEntry")).toEqual([]);
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.disk.documentParents.get(DOCUMENT_A)).toBe(FOLDER_2);
    expect(dialog.isConnected).toBe(false);
  });

  it("chooses a row with a double-click", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    await harness.user.dblClick(within(dialog).getByText("Folder 1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(harness.gateway.disk.documentParents.get(DOCUMENT_A)).toBe(FOLDER_1);
  });
});

describe("new folder from the move dialog", () => {
  const newFolderButton = (dialog: HTMLElement) =>
    within(dialog).getByRole("button", {
      name: MOVE.newFolder,
    }) as HTMLButtonElement;

  it("creates a folder inside the highlighted row, highlights it, and can move into it", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    const { user } = harness;
    await user.click(within(dialog).getByText("Folder 2"));
    await user.click(newFolderButton(dialog));
    const input = within(dialog).getByRole("textbox", {
      name: MOVE.newFolderInputLabel,
    });
    expect(document.activeElement).toBe(input);
    await user.keyboard("Inner{Enter}");

    const created = await within(dialog).findByRole("treeitem", {
      name: "Inner",
    });
    expect(created.getAttribute("aria-level")).toBe("4");
    expect(created.getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(created));
    // The dialog is still open and the folder already exists (real, not undoable).
    expect(screen.getByRole("dialog", { name: /Document A/ })).toBeTruthy();
    expect(harness.gateway.methods()).toEqual(["createFolder", "saveFolder"]);
    expect(within(dialog).queryByRole("textbox")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: MOVE.choose }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const parentId = harness.gateway.disk.documentParents.get(DOCUMENT_A);
    expect(
      harness.gateway.disk.folders.get(parentId as typeof FOLDER_1)?.folder
        .name,
    ).toBe("Inner");
  });

  it("creates inside the Project root when it is highlighted", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    await harness.user.keyboard("{Home}");
    await harness.user.click(newFolderButton(dialog));
    await harness.user.keyboard("Top{Enter}");
    const created = await within(dialog).findByRole("treeitem", {
      name: "Top",
    });
    expect(created.getAttribute("aria-level")).toBe("2");
  });

  it("shows the name validation inline, and Escape cancels only the input", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    const { user } = harness;
    await user.click(newFolderButton(dialog));
    await user.keyboard("{Enter}");
    expect(within(dialog).getByRole("alert").textContent).toBe(
      MESSAGES.dialogs.nameRequired,
    );
    expect(harness.gateway.methods("createFolder")).toEqual([]);
    await user.keyboard("{Escape}");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: /Document A/ })).toBeTruthy();
    expect(document.activeElement).toBe(row(dialog, "Folder 1"));
  });

  it("keeps the new folder when the move is cancelled afterwards", async () => {
    const { harness, dialog } = await openedMoveDialog("Document A");
    await harness.user.click(newFolderButton(dialog));
    await harness.user.keyboard("Kept{Enter}");
    await within(dialog).findByRole("treeitem", { name: "Kept" });
    await harness.user.click(
      within(dialog).getByRole("button", { name: MESSAGES.dialogs.cancel }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("treeitem", { name: "Kept" })).toBeTruthy();
    expect(harness.gateway.methods("moveEntry")).toEqual([]);
  });

  it("is disabled inside the moved folder and its descendants, enabled where it can go", async () => {
    const { harness, dialog } = await openedMoveDialog("Folder 1");
    const { user } = harness;
    // The Project root is the current parent: disabled as a target, fine for a new folder.
    await user.keyboard("{Home}");
    expect(newFolderButton(dialog).disabled).toBe(false);
    await user.keyboard("{ArrowDown}");
    expect(row(dialog, "Folder 1").getAttribute("aria-selected")).toBe("true");
    expect(newFolderButton(dialog).disabled).toBe(true);
    await user.keyboard("{ArrowDown}");
    expect(row(dialog, "Folder 2").getAttribute("aria-selected")).toBe("true");
    expect(newFolderButton(dialog).disabled).toBe(true);
  });
});
