import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  DOCUMENT_D,
  FOLDER_1,
  FOLDER_2,
  FOLDER_TREE_SELECTION_ID,
  folderTreeSnapshot,
} from "../../application/test-support/workspace-harness";
import type { FolderId } from "../../domain/shared/entity-id";
import {
  type ActionsHarness,
  createActionsHarness,
  openedFolderActionsHarness,
} from "./test-support/actions-harness";

async function openedFolderTreeActions() {
  const harness = createActionsHarness();
  harness.gateway.overrideProjectSnapshot(
    FOLDER_TREE_SELECTION_ID,
    folderTreeSnapshot(),
  );
  const opened = await harness.workspace.openProject(FOLDER_TREE_SELECTION_ID);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
  harness.gateway.clearCalls();
  return harness;
}

const childOrder = (
  harness: Awaited<ReturnType<typeof openedFolderTreeActions>>,
) => harness.store.getState().project?.project.childOrder;

describe("moving a document next to a folder", () => {
  it("steps up over the folder entry", async () => {
    const harness = await openedFolderTreeActions();
    const result = await harness.actions.moveDocumentBy(DOCUMENT_A, "up");
    expect(result.ok).toBe(true);
    expect(childOrder(harness)).toEqual([DOCUMENT_A, FOLDER_1, DOCUMENT_B]);
  });

  it("steps down past a sibling, keeping the folder where it is", async () => {
    const harness = await openedFolderTreeActions();
    await harness.actions.moveDocumentBy(DOCUMENT_A, "down");
    expect(childOrder(harness)).toEqual([FOLDER_1, DOCUMENT_B, DOCUMENT_A]);
  });
});

const state = (harness: ActionsHarness) => harness.uiStateStore.getState();
const folderEntry = (harness: ActionsHarness, folderId: FolderId) =>
  harness.store
    .getState()
    .project?.folders.find((entry) => entry.folderId === folderId);

describe("creating folders and nested documents", () => {
  it("asks for a name with the parent, creates the folder, and unfolds the parent", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.setFolderExpanded(FOLDER_2, false);
    harness.actions.requestCreateFolder(FOLDER_2);
    expect(state(harness).dialog).toEqual({
      kind: "createFolder",
      parentFolderId: FOLDER_2,
    });
    const result = await harness.actions.createFolder("Deep", FOLDER_2);
    expect(result.ok).toBe(true);
    expect(state(harness).dialog).toEqual({ kind: "none" });
    expect(folderEntry(harness, FOLDER_2)?.childOrder).toHaveLength(2);
    expect(state(harness).collapsedFolderIds.has(FOLDER_2)).toBe(false);
  });

  it("records a failed folder creation and closes the dialog", async () => {
    const harness = await openedFolderActionsHarness();
    harness.gateway.failOn("createFolder", "ioError");
    const result = await harness.actions.createFolder("X", null);
    expect(result.ok).toBe(false);
    expect(state(harness).dialog).toEqual({ kind: "none" });
    expect(state(harness).operationErrors).toMatchObject([
      { operation: "createFolder", error: { kind: "ioError" } },
    ]);
  });

  it("creates a document in a folder, opens and activates it, and unfolds the folder", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.setFolderExpanded(FOLDER_1, false);
    harness.actions.requestCreateDocument(FOLDER_1);
    expect(state(harness).dialog).toEqual({
      kind: "createDocument",
      parentFolderId: FOLDER_1,
    });
    const result = await harness.actions.createDocument("Nested", FOLDER_1);
    expect(result.ok).toBe(true);
    const created = folderEntry(harness, FOLDER_1)?.childOrder.at(-1);
    expect(created).toBeDefined();
    expect(state(harness).activeDocumentId).toBe(created);
    expect(state(harness).collapsedFolderIds.has(FOLDER_1)).toBe(false);
  });
});

describe("folding folders", () => {
  it("toggles and sets the folded state without touching persistence", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.toggleFolder(FOLDER_1);
    expect(state(harness).collapsedFolderIds.has(FOLDER_1)).toBe(true);
    harness.actions.toggleFolder(FOLDER_1);
    expect(state(harness).collapsedFolderIds.has(FOLDER_1)).toBe(false);
    harness.actions.setFolderExpanded(FOLDER_2, false);
    expect(state(harness).collapsedFolderIds.has(FOLDER_2)).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
  });
});

describe("renaming a folder", () => {
  it("opens the editor and commits a changed name as one saved rename, not undoable", async () => {
    const harness = await openedFolderActionsHarness();
    await harness.actions.beginRenameFolder(FOLDER_1);
    expect(state(harness).renaming).toEqual({
      kind: "folder",
      folderId: FOLDER_1,
    });
    const result = await harness.actions.commitRename("Renamed");
    expect(result.ok).toBe(true);
    expect(state(harness).renaming).toBeNull();
    expect(folderEntry(harness, FOLDER_1)?.name).toBe("Renamed");
    expect(harness.gateway.methods()).toEqual(["saveFolder"]);
  });

  it("does nothing for an unchanged name and keeps the editor open for an invalid one", async () => {
    const harness = await openedFolderActionsHarness();
    await harness.actions.beginRenameFolder(FOLDER_1);
    const invalid = await harness.actions.commitRename("   ");
    expect(invalid.ok).toBe(false);
    expect(state(harness).renaming).not.toBeNull();
    expect(state(harness).operationErrors).toEqual([]);
    expect((await harness.actions.commitRename("Folder 1")).ok).toBe(true);
    expect(state(harness).renaming).toBeNull();
    expect(harness.gateway.calls).toEqual([]);
  });

  it("records a failed save of the rename", async () => {
    const harness = await openedFolderActionsHarness();
    harness.gateway.failOn("saveFolder", "ioError");
    await harness.actions.beginRenameFolder(FOLDER_1);
    await harness.actions.commitRename("Renamed");
    expect(state(harness).operationErrors).toMatchObject([
      { operation: "renameFolder", error: { kind: "ioError" } },
    ]);
    expect((await harness.actions.retryFolderSave(FOLDER_1)).ok).toBe(true);
    expect(folderEntry(harness, FOLDER_1)?.save.dirty).toBe(false);
  });

  it("does not open the editor for a folder that failed to load", async () => {
    const harness = createActionsHarness();
    harness.gateway.seedFolder({ folderId: FOLDER_2, state: "loadFailed" });
    await harness.actions.openProjectViaDialog();
    await harness.actions.beginRenameFolder(FOLDER_2);
    expect(state(harness).renaming).toBeNull();
  });
});

describe("reordering nested entries", () => {
  it("moves a nested document and a nested folder one place, saving the folder", async () => {
    const harness = await openedFolderActionsHarness();
    expect((await harness.actions.moveDocumentBy(DOCUMENT_C, "up")).ok).toBe(
      true,
    );
    expect(folderEntry(harness, FOLDER_1)?.childOrder).toEqual([
      DOCUMENT_C,
      FOLDER_2,
    ]);
    expect((await harness.actions.moveFolderBy(FOLDER_2, "up")).ok).toBe(true);
    expect(folderEntry(harness, FOLDER_1)?.childOrder).toEqual([
      FOLDER_2,
      DOCUMENT_C,
    ]);
    expect(harness.gateway.methods()).toEqual(["saveFolder", "saveFolder"]);
  });

  it("does nothing at the boundary", async () => {
    const harness = await openedFolderActionsHarness();
    await harness.actions.moveFolderBy(FOLDER_2, "up");
    await harness.actions.moveDocumentBy(DOCUMENT_C, "down");
    expect(harness.gateway.calls).toEqual([]);
  });
});

describe("moving entries", () => {
  it("opens the target picker for a document and a folder", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.requestMoveEntry(DOCUMENT_A);
    expect(state(harness).dialog).toMatchObject({
      kind: "moveEntry",
      entryId: DOCUMENT_A,
      name: "Document A",
    });
    harness.actions.cancelDialog();
    harness.actions.requestMoveEntry(FOLDER_1);
    expect(state(harness).dialog.kind).toBe("moveEntry");
  });

  it("also offers the picker for an open document and a folder holding one", async () => {
    const harness = await openedFolderActionsHarness();
    await harness.actions.openDocument(DOCUMENT_D);
    for (const entryId of [DOCUMENT_D, FOLDER_2, FOLDER_1]) {
      harness.actions.requestMoveEntry(entryId);
      expect(state(harness).dialog).toMatchObject({
        kind: "moveEntry",
        entryId,
      });
      harness.actions.cancelDialog();
    }
  });

  it("moves to the target, closes the picker and unfolds the target folder", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.setFolderExpanded(FOLDER_2, false);
    harness.actions.requestMoveEntry(DOCUMENT_A);
    const result = await harness.actions.moveEntryTo(DOCUMENT_A, FOLDER_2);
    expect(result.ok).toBe(true);
    expect(state(harness).dialog.kind).toBe("none");
    expect(folderEntry(harness, FOLDER_2)?.childOrder).toContain(DOCUMENT_A);
    expect(state(harness).collapsedFolderIds.has(FOLDER_2)).toBe(false);
  });

  it("records a rejected move", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.requestMoveEntry(FOLDER_1);
    const result = await harness.actions.moveEntryTo(FOLDER_1, FOLDER_2);
    expect(result.ok).toBe(false);
    expect(state(harness).dialog.kind).toBe("none");
    expect(state(harness).operationErrors).toMatchObject([
      {
        operation: "moveEntry",
        subject: "Folder 1",
        error: { kind: "invalidMove" },
      },
    ]);
  });
});

describe("deleting folders", () => {
  it("offers a confirmation only for an empty folder", async () => {
    const harness = await openedFolderActionsHarness();
    harness.actions.requestDeleteFolder(FOLDER_1);
    expect(state(harness).dialog.kind).toBe("none");
  });

  it("deletes after the confirmation", async () => {
    const harness = await openedFolderActionsHarness();
    await harness.workspace.deleteDocument(DOCUMENT_D, {
      confirmedByUser: true,
    });
    harness.actions.requestDeleteFolder(FOLDER_2);
    expect(state(harness).dialog).toEqual({
      kind: "confirmDeleteFolder",
      folderId: FOLDER_2,
      name: "Folder 2",
    });
    const result = await harness.actions.confirmDelete();
    expect(result.ok).toBe(true);
    expect(state(harness).dialog.kind).toBe("none");
    expect(folderEntry(harness, FOLDER_2)).toBeUndefined();
  });

  it("records a failed deletion", async () => {
    const harness = await openedFolderActionsHarness();
    await harness.workspace.deleteDocument(DOCUMENT_D, {
      confirmedByUser: true,
    });
    harness.gateway.failOn("deleteFolder", "ioError");
    harness.actions.requestDeleteFolder(FOLDER_2);
    await harness.actions.confirmDelete();
    expect(state(harness).operationErrors).toMatchObject([
      { operation: "deleteFolder", error: { kind: "ioError" } },
    ]);
  });
});
