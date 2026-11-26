import { describe, expect, it } from "vitest";
import type { EntryId } from "../../domain/shared/entity-id";
import { renameDocumentCommand } from "../commands/naming-commands";
import { displayName } from "../test-support/fakes";
import {
  CONFIRMED,
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  DOCUMENT_D,
  errorKind,
  FAILED_DOCUMENT_ID,
  FOLDER_1,
  FOLDER_2,
  openedFolderDiskWorkspace,
  openedWorkspace,
  type WorkspaceHarness,
} from "../test-support/workspace-harness";
import { createTreeHistory, type TreeChange } from "./tree-history";
import type { TreeStepSummary } from "./workspace-events";

const ORIGINAL = [DOCUMENT_A, DOCUMENT_B, FAILED_DOCUMENT_ID];
const MOVED = [DOCUMENT_B, DOCUMENT_A, FAILED_DOCUMENT_ID];
const APPLIED = { ok: true, value: "applied" };
const NONE = { ok: true, value: "none" };
const NOT_APPLIED = { ok: true, value: "notApplied" };

const rootOrder = (harness: WorkspaceHarness) =>
  harness.store.getState().project?.project.childOrder;
const folderOf = (harness: WorkspaceHarness, folderId: EntryId) =>
  harness.store
    .getState()
    .project?.folders.find((folder) => folder.folderId === folderId);
const listed = (harness: WorkspaceHarness, entryId: EntryId) => {
  const project = harness.store.getState().project;
  return (
    project?.documents.some((entry) => entry.documentId === entryId) === true ||
    project?.folders.some((entry) => entry.folderId === entryId) === true
  );
};

function summaries(harness: WorkspaceHarness): TreeStepSummary[] {
  const seen: TreeStepSummary[] = [];
  harness.workspace.subscribe((event) => {
    if (event.type === "treeStepRecorded") seen.push(event.summary);
  });
  return seen;
}

describe("reorders", () => {
  it("takes a reorder back and makes it again, on disk too", async () => {
    const harness = await openedWorkspace();
    await harness.workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);

    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(rootOrder(harness)).toEqual(ORIGINAL);
    expect(harness.gateway.disk.childOrder).toEqual(ORIGINAL);
    expect(await harness.workspace.redoTreeChange()).toEqual(APPLIED);
    expect(rootOrder(harness)).toEqual(MOVED);
    expect(harness.gateway.disk.childOrder).toEqual(MOVED);
  });

  it("has nothing to take without a step, or for a move that changed nothing", async () => {
    const harness = await openedWorkspace();
    expect(await harness.workspace.undoTreeChange()).toEqual(NONE);
    expect(await harness.workspace.redoTreeChange()).toEqual(NONE);
    expect(harness.workspace.treeUndoPreview()).toBeNull();

    await harness.workspace.moveDocument(DOCUMENT_A, DOCUMENT_B);
    expect(harness.gateway.methods("saveProject")).toEqual([]);
    expect(await harness.workspace.undoTreeChange()).toEqual(NONE);
  });

  it("drops the steps when the place to go back to is gone", async () => {
    const harness = await openedWorkspace();
    await harness.workspace.moveDocument(DOCUMENT_A, null);
    // DOCUMENT_A stood in front of DOCUMENT_B, which is deleted now.
    await harness.workspace.deleteDocument(DOCUMENT_B, CONFIRMED);
    const order = rootOrder(harness);

    expect(await harness.workspace.undoTreeChange()).toEqual(NOT_APPLIED);
    expect(rootOrder(harness)).toEqual(order);
    expect(await harness.workspace.redoTreeChange()).toEqual(NONE);
  });

  it("reports a save that fails while taking a step back, and drops the steps", async () => {
    const harness = await openedWorkspace();
    await harness.workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    harness.gateway.failOn("saveProject", "ioError");

    expect(errorKind(await harness.workspace.undoTreeChange())).toBe("ioError");
    expect(await harness.workspace.redoTreeChange()).toEqual(NONE);
  });

  it("refuses to take a step back once the Project is closed", async () => {
    const harness = await openedWorkspace();
    await harness.workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    await harness.workspace.closeProject();

    expect(errorKind(await harness.workspace.undoTreeChange())).toBe(
      "projectNotOpen",
    );
  });

  it("makes one step of what is grouped, and takes it back at once", async () => {
    const harness = await openedWorkspace();
    const seen = summaries(harness);
    const end = harness.workspace.groupTreeChanges();
    const inner = harness.workspace.groupTreeChanges();
    await harness.workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    inner();
    await harness.workspace.moveDocument(FAILED_DOCUMENT_ID, DOCUMENT_B);
    end();
    end();

    expect(seen).toEqual([{ change: "reordered", name: null, count: 2 }]);
    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(rootOrder(harness)).toEqual(ORIGINAL);
    expect(await harness.workspace.undoTreeChange()).toEqual(NONE);
  });

  it("names the one entry a step moved among its siblings", async () => {
    const harness = await openedWorkspace();
    const seen = summaries(harness);
    await harness.workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    expect(seen).toEqual([
      { change: "reordered", name: "Document B", count: 1 },
    ]);
  });
});

describe("moves into another folder", () => {
  it("moves back to where it stood, and into the folder again", async () => {
    const harness = await openedFolderDiskWorkspace();
    const seen = summaries(harness);
    const before = rootOrder(harness);
    await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2);
    expect(seen).toEqual([{ change: "moved", name: "Document A", count: 1 }]);

    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(rootOrder(harness)).toEqual(before);
    expect(await harness.workspace.redoTreeChange()).toEqual(APPLIED);
    expect(folderOf(harness, FOLDER_2)?.childOrder.at(-1)).toBe(DOCUMENT_A);
  });

  it("goes back last when the sibling it stood in front of is gone", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2);
    // DOCUMENT_A stood in front of DOCUMENT_B, which is deleted now.
    await harness.workspace.deleteDocument(DOCUMENT_B, CONFIRMED);

    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(rootOrder(harness)).toEqual([FOLDER_1, DOCUMENT_A]);
  });

  it("does not move an entry that left the folder since", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.moveEntry(DOCUMENT_C, null);
    await harness.workspace.deleteDocument(DOCUMENT_C, CONFIRMED);
    expect(await harness.workspace.undoTreeChange()).toEqual(NOT_APPLIED);
  });

  it("does not move again when the entry is no longer where it came from", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2);
    await harness.workspace.undoTreeChange();
    await harness.workspace.deleteDocument(DOCUMENT_A, CONFIRMED);
    expect(await harness.workspace.redoTreeChange()).toEqual(NOT_APPLIED);
  });

  it("reports a failed save of its place, once moved back", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2);
    // The second save of project.json is the one putting it in front of Document B.
    harness.gateway.failOn("saveProject", "ioError", 2);
    expect(errorKind(await harness.workspace.undoTreeChange())).toBe("ioError");
  });

  it("reports a move into the folder again that Rust refuses", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2);
    await harness.workspace.undoTreeChange();
    harness.gateway.failOn("moveEntry", "ioError");
    expect(errorKind(await harness.workspace.redoTreeChange())).toBe("ioError");
  });

  it("reports a move out of a folder whose file cannot be saved", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    expect(errorKind(await harness.workspace.moveEntry(DOCUMENT_C, null))).toBe(
      "ioError",
    );
    expect(await harness.workspace.undoTreeChange()).toEqual(NONE);
  });

  it("reports a move back that Rust refuses", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2);
    harness.gateway.failOn("moveEntry", "ioError");
    expect(errorKind(await harness.workspace.undoTreeChange())).toBe("ioError");
  });
});

describe("creations", () => {
  it("deletes a Document that is as it was created, and makes it again with its id", async () => {
    const harness = await openedWorkspace();
    const seen = summaries(harness);
    const created = await harness.workspace.createDocument("Draft");
    const documentId = created.ok ? created.value : DOCUMENT_A;
    await harness.workspace.openDocument(documentId);
    expect(seen).toEqual([{ change: "created", name: "Draft", count: 1 }]);
    expect(harness.workspace.treeUndoPreview()).toEqual({
      changedCreations: [],
    });

    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(listed(harness, documentId)).toBe(false);
    expect(await harness.workspace.redoTreeChange()).toEqual(APPLIED);
    expect(listed(harness, documentId)).toBe(true);
  });

  it("names a Document that changed since, deletes it, and does not make it again", async () => {
    const harness = await openedWorkspace();
    const created = await harness.workspace.createDocument("Draft");
    const documentId = created.ok ? created.value : DOCUMENT_A;
    await harness.workspace.openDocument(documentId);
    await harness.workspace.createSheet(documentId, "Added");

    expect(harness.workspace.treeUndoPreview()).toEqual({
      changedCreations: ["Draft"],
    });
    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(listed(harness, documentId)).toBe(false);
    expect(await harness.workspace.redoTreeChange()).toEqual(NONE);
  });

  it("counts a Document that is not open, or was edited, as changed", async () => {
    const harness = await openedWorkspace();
    await harness.workspace.createDocument("Closed");
    expect(harness.workspace.treeUndoPreview()?.changedCreations).toEqual([
      "Closed",
    ]);

    const created = await harness.workspace.createDocument("Edited");
    const documentId = created.ok ? created.value : DOCUMENT_A;
    await harness.workspace.openDocument(documentId);
    await harness.workspace
      .getDocumentSession(documentId)
      ?.execute(renameDocumentCommand(displayName("Edited again")));
    expect(harness.workspace.treeUndoPreview()?.changedCreations).toEqual([
      "Edited",
    ]);
  });

  it("makes nested folders one step, deletes them together and makes them again", async () => {
    const harness = await openedFolderDiskWorkspace();
    const seen = summaries(harness);
    const created = await harness.workspace.createFolder(null, "Top/Inner");
    const inner = created.ok ? created.value : FOLDER_1;
    expect(seen).toEqual([{ change: "created", name: "Inner", count: 2 }]);
    expect(harness.workspace.treeUndoPreview()).toEqual({
      changedCreations: ["Top"],
    });

    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(listed(harness, inner)).toBe(false);
    expect(await harness.workspace.redoTreeChange()).toEqual(NONE);
  });

  it("deletes an empty folder and makes it again with its id", async () => {
    const harness = await openedFolderDiskWorkspace();
    const created = await harness.workspace.createFolder(null, "Empty");
    const folderId = created.ok ? created.value : FOLDER_1;

    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(listed(harness, folderId)).toBe(false);
    expect(await harness.workspace.redoTreeChange()).toEqual(APPLIED);
    expect(folderOf(harness, folderId)?.name).toBe("Empty");
  });

  it("does not make a creation again when its parent is gone, or delete one that is gone", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.createFolder(FOLDER_2, "Child");
    await harness.workspace.undoTreeChange();
    await harness.workspace.deleteDocument(DOCUMENT_D, CONFIRMED);
    await harness.workspace.deleteFolder(FOLDER_2, CONFIRMED);
    expect(await harness.workspace.redoTreeChange()).toEqual(NOT_APPLIED);

    const created = await harness.workspace.createDocument("Draft");
    const documentId = created.ok ? created.value : DOCUMENT_A;
    await harness.workspace.deleteDocument(documentId, CONFIRMED);
    expect(await harness.workspace.undoTreeChange()).toEqual(NOT_APPLIED);
  });

  it("reports a deletion that fails while taking a creation back", async () => {
    const harness = await openedWorkspace();
    await harness.workspace.createDocument("Draft");
    harness.gateway.failOn("deleteDocument", "ioError");
    expect(errorKind(await harness.workspace.undoTreeChange())).toBe("ioError");
  });

  it("reports a creation that fails while making it again", async () => {
    const harness = await openedWorkspace();
    const created = await harness.workspace.createDocument("Draft");
    const documentId = created.ok ? created.value : DOCUMENT_A;
    await harness.workspace.openDocument(documentId);
    await harness.workspace.undoTreeChange();
    harness.gateway.failOn("createDocument", "ioError");
    expect(errorKind(await harness.workspace.redoTreeChange())).toBe("ioError");
  });

  it("does not make a Document again whose id is taken", async () => {
    const harness = await openedWorkspace();
    const created = await harness.workspace.createDocument("Draft");
    const documentId = created.ok ? created.value : DOCUMENT_A;
    await harness.workspace.openDocument(documentId);
    await harness.workspace.undoTreeChange();
    await harness.workspace.closeProject();
    expect(errorKind(await harness.workspace.redoTreeChange())).toBe(
      "projectNotOpen",
    );
  });
});

describe("folder renames", () => {
  it("renames back and again, and not after the folder was renamed elsewhere", async () => {
    const harness = await openedFolderDiskWorkspace();
    const seen = summaries(harness);
    await harness.workspace.renameFolder(FOLDER_1, "Renamed");
    await harness.workspace.renameFolder(FOLDER_1, "Renamed");
    expect(seen).toEqual([{ change: "renamed", name: "Renamed", count: 1 }]);

    expect(await harness.workspace.undoTreeChange()).toEqual(APPLIED);
    expect(folderOf(harness, FOLDER_1)?.name).toBe("Folder 1");
    expect(await harness.workspace.redoTreeChange()).toEqual(APPLIED);
    expect(folderOf(harness, FOLDER_1)?.name).toBe("Renamed");

    const end = harness.workspace.groupTreeChanges();
    await harness.workspace.renameFolder(FOLDER_2, "Other");
    end();
    await harness.workspace.undoTreeChange();
    await harness.workspace.renameFolder(FOLDER_2, "Elsewhere");
    expect(await harness.workspace.redoTreeChange()).toEqual(NONE);
  });

  it("does not rename a folder that is gone", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.renameFolder(FOLDER_2, "Renamed");
    await harness.workspace.deleteDocument(DOCUMENT_D, CONFIRMED);
    await harness.workspace.deleteFolder(FOLDER_2, CONFIRMED);
    expect(await harness.workspace.undoTreeChange()).toEqual(NOT_APPLIED);
  });

  it("reports a rename back that cannot be saved", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.renameFolder(FOLDER_1, "Renamed");
    harness.gateway.failOn("saveFolder", "ioError");
    expect(errorKind(await harness.workspace.undoTreeChange())).toBe("ioError");
  });
});

describe("the tree history", () => {
  const change = (entryId: string): TreeChange => ({
    kind: "reorder",
    entryKind: "document",
    entryId: entryId as EntryId,
    parentId: null,
    from: null,
    to: null,
  });

  it("keeps the latest steps up to its limit, and a new step drops the redo side", () => {
    const steps: unknown[] = [];
    const history = createTreeHistory(2, (step) => steps.push(step));
    history.record(change("a"));
    history.record(change("b"));
    history.record(change("c"));
    expect(history.takeUndo()).toEqual([change("c")]);
    expect(history.takeUndo()).toEqual([change("b")]);
    expect(history.takeUndo()).toBeNull();
    expect(history.takeRedo()).toEqual([change("b")]);
    history.record(change("d"));
    expect(history.takeRedo()).toBeNull();
    // An empty group records nothing.
    history.group()();
    expect(steps).toHaveLength(4);
    history.clear();
    expect(history.peekUndo()).toBeNull();
  });
});
