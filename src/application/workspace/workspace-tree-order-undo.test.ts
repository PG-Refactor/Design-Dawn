import { describe, expect, it } from "vitest";
import {
  CONFIRMED,
  DOCUMENT_A,
  DOCUMENT_B,
  errorKind,
  FAILED_DOCUMENT_ID,
  FOLDER_1,
  openedFolderDiskWorkspace,
  openedWorkspace,
} from "../test-support/workspace-harness";
import { createTreeOrderHistory } from "./tree-order-history";

const ORIGINAL = [DOCUMENT_A, DOCUMENT_B, FAILED_DOCUMENT_ID];
const MOVED = [DOCUMENT_B, DOCUMENT_A, FAILED_DOCUMENT_ID];

describe("undo and redo of a reorder in the tree", () => {
  it("takes a reorder back and makes it again, on disk too", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    await workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);

    expect(await workspace.undoTreeOrder()).toEqual({ ok: true, value: true });
    expect(store.getState().project?.project.childOrder).toEqual(ORIGINAL);
    expect(gateway.disk.childOrder).toEqual(ORIGINAL);

    expect(await workspace.redoTreeOrder()).toEqual({ ok: true, value: true });
    expect(store.getState().project?.project.childOrder).toEqual(MOVED);
    expect(gateway.disk.childOrder).toEqual(MOVED);
  });

  it("has nothing to take without a reorder, or for a move that changed nothing", async () => {
    const { workspace, gateway } = await openedWorkspace();
    expect(await workspace.undoTreeOrder()).toEqual({ ok: true, value: false });
    expect(await workspace.redoTreeOrder()).toEqual({ ok: true, value: false });

    await workspace.moveDocument(DOCUMENT_A, DOCUMENT_B);
    expect(gateway.methods("saveProject")).toEqual([]);
    expect(await workspace.undoTreeOrder()).toEqual({ ok: true, value: false });
  });

  it("drops the steps when the place to go back to is gone", async () => {
    const { workspace, store } = await openedWorkspace();
    await workspace.moveDocument(DOCUMENT_A, null);
    // DOCUMENT_A stood in front of DOCUMENT_B, which is deleted now.
    await workspace.deleteDocument(DOCUMENT_B, CONFIRMED);
    const order = store.getState().project?.project.childOrder;

    expect(await workspace.undoTreeOrder()).toEqual({ ok: true, value: false });
    expect(store.getState().project?.project.childOrder).toEqual(order);
    expect(await workspace.redoTreeOrder()).toEqual({ ok: true, value: false });
  });

  it("reports a save that fails while taking a step back, and drops the steps", async () => {
    const { workspace, gateway } = await openedWorkspace();
    await workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    gateway.failOn("saveProject", "ioError");

    expect(errorKind(await workspace.undoTreeOrder())).toBe("ioError");
    expect(await workspace.redoTreeOrder()).toEqual({ ok: true, value: false });
  });

  it("refuses to take a step back once the Project is closed", async () => {
    const { workspace } = await openedWorkspace();
    await workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    await workspace.closeProject();

    expect(errorKind(await workspace.undoTreeOrder())).toBe("projectNotOpen");
  });

  it("takes a folder's reorder back inside its parent", async () => {
    const { workspace, store } = await openedFolderDiskWorkspace();
    const before = store.getState().project?.project.childOrder;
    await workspace.moveFolder(FOLDER_1, null);
    expect(store.getState().project?.project.childOrder).not.toEqual(before);

    expect(await workspace.undoTreeOrder()).toEqual({ ok: true, value: true });
    expect(store.getState().project?.project.childOrder).toEqual(before);
  });

  it("does not take back a move of an entry that left its parent since", async () => {
    const { workspace, store } = await openedFolderDiskWorkspace();
    await workspace.moveDocument(DOCUMENT_A, null);
    expect((await workspace.moveEntry(DOCUMENT_A, FOLDER_1)).ok).toBe(true);
    const order = store.getState().project?.project.childOrder;

    expect(await workspace.undoTreeOrder()).toEqual({ ok: true, value: false });
    expect(store.getState().project?.project.childOrder).toEqual(order);
  });
});

describe("the tree order history", () => {
  const step = (entryId: string) => ({
    kind: "document" as const,
    entryId: entryId as never,
    parentId: null,
    from: null,
    to: null,
  });

  it("keeps the latest steps up to its limit, and a new step drops the redo side", () => {
    const history = createTreeOrderHistory(2);
    history.record(step("a"));
    history.record(step("b"));
    history.record(step("c"));
    expect(history.takeUndo()?.entryId).toBe("c");
    expect(history.takeUndo()?.entryId).toBe("b");
    expect(history.takeUndo()).toBeNull();
    expect(history.takeRedo()?.entryId).toBe("b");
    history.record(step("d"));
    expect(history.takeRedo()).toBeNull();
    history.clear();
    expect(history.takeUndo()).toBeNull();
  });
});
