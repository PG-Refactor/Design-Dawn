import { describe, expect, it } from "vitest";
import { parseDocumentId, parseFolderId } from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import { folderIdOf } from "../test-support/fakes";
import {
  CONFIRMED,
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  DOCUMENT_D,
  errorKind,
  FOLDER_1,
  FOLDER_2,
  openedFolderDiskWorkspace,
} from "../test-support/workspace-harness";

const rootOrder = (
  harness: Awaited<ReturnType<typeof openedFolderDiskWorkspace>>,
) => harness.store.getState().project?.project.childOrder;

const folderOrder = (
  harness: Awaited<ReturnType<typeof openedFolderDiskWorkspace>>,
  folderId: typeof FOLDER_1,
) =>
  harness.store
    .getState()
    .project?.folders.find((entry) => entry.folderId === folderId)?.childOrder;

const diskOrder = (
  harness: Awaited<ReturnType<typeof openedFolderDiskWorkspace>>,
  folderId: typeof FOLDER_1,
) => harness.gateway.disk.folders.get(folderId)?.folder.childOrder;

describe("createFolder", () => {
  it("creates a folder at the root: createFolder, then saveProject", async () => {
    const harness = await openedFolderDiskWorkspace();
    const created = await harness.workspace.createFolder(null, "New folder");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(harness.gateway.methods()).toEqual(["createFolder", "saveProject"]);
    expect(rootOrder(harness)).toEqual([
      FOLDER_1,
      DOCUMENT_A,
      DOCUMENT_B,
      created.value,
    ]);
    expect(harness.gateway.disk.childOrder).toEqual(rootOrder(harness));
    const entry = harness.store
      .getState()
      .project?.folders.find((folder) => folder.folderId === created.value);
    expect(entry).toMatchObject({
      name: "New folder",
      parentFolderId: null,
      childOrder: [],
      state: "loaded",
      save: { dirty: false, lastError: null },
    });
    expect(harness.store.getState().project?.save.dirty).toBe(false);
  });

  it("creates a nested folder: createFolder, then saveFolder of the parent", async () => {
    const harness = await openedFolderDiskWorkspace();
    const created = await harness.workspace.createFolder(FOLDER_2, "Deep");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(harness.gateway.methods()).toEqual(["createFolder", "saveFolder"]);
    expect(folderOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D, created.value]);
    expect(diskOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D, created.value]);
    // The project file is untouched.
    expect(harness.gateway.methods("saveProject")).toEqual([]);
  });

  it("rejects an invalid name before touching the gateway", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(errorKind(await harness.workspace.createFolder(null, "  "))).toBe(
      "invalidDisplayName",
    );
    expect(harness.gateway.calls).toEqual([]);
  });

  it("rejects an unknown parent", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(
      errorKind(await harness.workspace.createFolder(folderIdOf(99), "X")),
    ).toBe("entityNotFound");
    expect(harness.gateway.calls).toEqual([]);
  });

  it("keeps the folder in memory, dirty with the error, when the parent save fails, and retries", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    const created = await harness.workspace.createFolder(FOLDER_1, "Kept");
    expect(errorKind(created)).toBe("ioError");
    const parent = harness.store
      .getState()
      .project?.folders.find((entry) => entry.folderId === FOLDER_1);
    expect(parent?.childOrder).toHaveLength(3);
    expect(parent?.save.dirty).toBe(true);
    expect(parent?.save.lastError?.kind).toBe("ioError");
    expect(diskOrder(harness, FOLDER_1)).toEqual([FOLDER_2, DOCUMENT_C]);
    expect((await harness.workspace.saveFolder(FOLDER_1)).ok).toBe(true);
    expect(diskOrder(harness, FOLDER_1)).toEqual(parent?.childOrder);
    expect(
      harness.store
        .getState()
        .project?.folders.find((entry) => entry.folderId === FOLDER_1)?.save,
    ).toEqual({ dirty: false, lastError: null });
  });

  it("leaves the project clean when the parent is a folder whose save failed", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    await harness.workspace.createFolder(FOLDER_1, "Kept");
    expect(harness.store.getState().project?.save.dirty).toBe(false);
  });

  it("reports a failed createFolder without changing memory", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("createFolder", "ioError");
    expect(errorKind(await harness.workspace.createFolder(null, "X"))).toBe(
      "ioError",
    );
    expect(harness.store.getState().project?.folders).toHaveLength(2);
    expect(harness.gateway.methods()).toEqual(["createFolder"]);
  });

  it("saves dirty folders with saveAll", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    await harness.workspace.createFolder(FOLDER_1, "Kept");
    expect((await harness.workspace.saveAll()).ok).toBe(true);
    expect(diskOrder(harness, FOLDER_1)).toHaveLength(3);
  });
});

describe("createDocument in a folder", () => {
  it("creates the document inside the folder and saves the folder", async () => {
    const harness = await openedFolderDiskWorkspace();
    const created = await harness.workspace.createDocument("Nested", FOLDER_2);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(harness.gateway.methods()).toEqual(["createDocument", "saveFolder"]);
    expect(folderOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D, created.value]);
    expect(diskOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D, created.value]);
    expect(
      harness.store
        .getState()
        .project?.documents.find((entry) => entry.documentId === created.value)
        ?.parentFolderId,
    ).toBe(FOLDER_2);
    expect(rootOrder(harness)).toEqual([FOLDER_1, DOCUMENT_A, DOCUMENT_B]);
  });

  it("defaults to the project root", async () => {
    const harness = await openedFolderDiskWorkspace();
    const created = await harness.workspace.createDocument("Root");
    expect(created.ok).toBe(true);
    expect(harness.gateway.methods()).toEqual([
      "createDocument",
      "saveProject",
    ]);
  });
});

describe("renameFolder", () => {
  it("renames the folder and saves its file", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.renameFolder(FOLDER_1, "Renamed")).ok).toBe(
      true,
    );
    expect(harness.gateway.methods()).toEqual(["saveFolder"]);
    expect(harness.gateway.disk.folders.get(FOLDER_1)?.folder.name).toBe(
      "Renamed",
    );
    expect(
      harness.store
        .getState()
        .project?.folders.find((entry) => entry.folderId === FOLDER_1)?.name,
    ).toBe("Renamed");
  });

  it("rejects an invalid name and an unknown folder", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(errorKind(await harness.workspace.renameFolder(FOLDER_1, ""))).toBe(
      "invalidDisplayName",
    );
    expect(
      errorKind(await harness.workspace.renameFolder(folderIdOf(99), "X")),
    ).toBe("entityNotFound");
    expect(harness.gateway.calls).toEqual([]);
  });

  it("keeps the new name dirty when saving fails", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    expect(
      errorKind(await harness.workspace.renameFolder(FOLDER_1, "Renamed")),
    ).toBe("ioError");
    const entry = harness.store
      .getState()
      .project?.folders.find((folder) => folder.folderId === FOLDER_1);
    expect(entry?.name).toBe("Renamed");
    expect(entry?.save.dirty).toBe(true);
    expect(harness.gateway.disk.folders.get(FOLDER_1)?.folder.name).toBe(
      "Folder 1",
    );
  });

  it("refuses a folder that failed to load", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.seedFolder({
      folderId: folderIdOf(7),
      state: "loadFailed",
    });
    await harness.workspace.openProject("selection-1");
    harness.gateway.clearCalls();
    expect(
      errorKind(await harness.workspace.renameFolder(folderIdOf(7), "X")),
    ).toBe("notWritable");
    expect(harness.gateway.calls).toEqual([]);
  });
});

describe("reordering among siblings", () => {
  it("reorders a root folder among mixed siblings and saves the project", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.moveFolder(FOLDER_1, null)).ok).toBe(true);
    expect(rootOrder(harness)).toEqual([DOCUMENT_A, DOCUMENT_B, FOLDER_1]);
    expect(harness.gateway.methods()).toEqual(["saveProject"]);
  });

  it("reorders a document nested in a folder and saves that folder", async () => {
    const harness = await openedFolderDiskWorkspace();
    // FOLDER_1 holds [FOLDER_2, DOCUMENT_C]: C goes in front of the folder.
    expect(
      (await harness.workspace.moveDocument(DOCUMENT_C, FOLDER_2)).ok,
    ).toBe(true);
    expect(folderOrder(harness, FOLDER_1)).toEqual([DOCUMENT_C, FOLDER_2]);
    expect(diskOrder(harness, FOLDER_1)).toEqual([DOCUMENT_C, FOLDER_2]);
    expect(harness.gateway.methods()).toEqual(["saveFolder"]);
    // The root order is untouched.
    expect(rootOrder(harness)).toEqual([FOLDER_1, DOCUMENT_A, DOCUMENT_B]);
  });

  it("reorders a nested folder", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.moveFolder(FOLDER_2, null)).ok).toBe(true);
    expect(folderOrder(harness, FOLDER_1)).toEqual([DOCUMENT_C, FOLDER_2]);
  });

  it("rejects a document id for moveFolder and the reverse", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(
      errorKind(
        await harness.workspace.moveFolder(
          unwrap(parseFolderId(DOCUMENT_A)),
          null,
        ),
      ),
    ).toBe("entityNotFound");
    expect(
      errorKind(
        await harness.workspace.moveDocument(
          unwrap(parseDocumentId(FOLDER_1)),
          null,
        ),
      ),
    ).toBe("entityNotFound");
  });

  it("keeps the order dirty when the folder save fails", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    expect(errorKind(await harness.workspace.moveFolder(FOLDER_2, null))).toBe(
      "ioError",
    );
    const entry = harness.store
      .getState()
      .project?.folders.find((folder) => folder.folderId === FOLDER_1);
    expect(entry?.save.dirty).toBe(true);
    expect(entry?.childOrder).toEqual([DOCUMENT_C, FOLDER_2]);
  });
});

describe("deleteDocument of a nested document", () => {
  it("removes it from the folder's order: saveFolder, then deleteDocument", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(
      (await harness.workspace.deleteDocument(DOCUMENT_C, CONFIRMED)).ok,
    ).toBe(true);
    expect(harness.gateway.methods()).toEqual(["saveFolder", "deleteDocument"]);
    expect(folderOrder(harness, FOLDER_1)).toEqual([FOLDER_2]);
    expect(diskOrder(harness, FOLDER_1)).toEqual([FOLDER_2]);
    expect(
      harness.store
        .getState()
        .project?.documents.some((entry) => entry.documentId === DOCUMENT_C),
    ).toBe(false);
    expect(rootOrder(harness)).toEqual([FOLDER_1, DOCUMENT_A, DOCUMENT_B]);
  });

  it("puts it back at the end, dirty, when the directory cannot be deleted", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("deleteDocument", "ioError");
    expect(
      errorKind(await harness.workspace.deleteDocument(DOCUMENT_C, CONFIRMED)),
    ).toBe("ioError");
    const entry = harness.store
      .getState()
      .project?.folders.find((folder) => folder.folderId === FOLDER_1);
    expect(entry?.childOrder).toEqual([FOLDER_2, DOCUMENT_C]);
    expect(entry?.save.dirty).toBe(true);
    expect(entry?.save.lastError?.kind).toBe("ioError");
    expect((await harness.workspace.saveFolder(FOLDER_1)).ok).toBe(true);
    expect(diskOrder(harness, FOLDER_1)).toEqual([FOLDER_2, DOCUMENT_C]);
  });
});

describe("moveEntry", () => {
  it("moves a document root -> folder: moveEntry, saveFolder (target), saveProject (source)", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2)).ok).toBe(
      true,
    );
    expect(harness.gateway.methods()).toEqual([
      "moveEntry",
      "saveFolder",
      "saveProject",
    ]);
    expect(folderOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D, DOCUMENT_A]);
    expect(diskOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D, DOCUMENT_A]);
    expect(rootOrder(harness)).toEqual([FOLDER_1, DOCUMENT_B]);
    expect(harness.gateway.disk.childOrder).toEqual([FOLDER_1, DOCUMENT_B]);
    expect(
      harness.store
        .getState()
        .project?.documents.find((entry) => entry.documentId === DOCUMENT_A)
        ?.parentFolderId,
    ).toBe(FOLDER_2);
  });

  it("moves a document folder -> root: saveProject (target), then saveFolder (source)", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.moveEntry(DOCUMENT_D, null)).ok).toBe(true);
    expect(harness.gateway.methods()).toEqual([
      "moveEntry",
      "saveProject",
      "saveFolder",
    ]);
    expect(rootOrder(harness)).toEqual([
      FOLDER_1,
      DOCUMENT_A,
      DOCUMENT_B,
      DOCUMENT_D,
    ]);
    expect(folderOrder(harness, FOLDER_2)).toEqual([]);
  });

  it("moves a folder (with its content) folder -> folder", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.moveEntry(FOLDER_2, null)).ok).toBe(true);
    expect(rootOrder(harness)).toEqual([
      FOLDER_1,
      DOCUMENT_A,
      DOCUMENT_B,
      FOLDER_2,
    ]);
    expect(folderOrder(harness, FOLDER_1)).toEqual([DOCUMENT_C]);
    expect(
      harness.store
        .getState()
        .project?.folders.find((entry) => entry.folderId === FOLDER_2)
        ?.parentFolderId,
    ).toBeNull();
    // The folder keeps its own children.
    expect(folderOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D]);
    expect((await harness.workspace.moveEntry(FOLDER_2, FOLDER_1)).ok).toBe(
      true,
    );
    expect(folderOrder(harness, FOLDER_1)).toEqual([DOCUMENT_C, FOLDER_2]);
  });

  it("does nothing when the target is the current parent", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.moveEntry(DOCUMENT_A, null)).ok).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("rejects a folder moved into itself or a descendant, without a gateway call", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(
      errorKind(await harness.workspace.moveEntry(FOLDER_1, FOLDER_1)),
    ).toBe("invalidMove");
    expect(
      errorKind(await harness.workspace.moveEntry(FOLDER_1, FOLDER_2)),
    ).toBe("invalidMove");
    expect(harness.gateway.calls).toEqual([]);
  });

  it("rejects an open document and a folder that contains one", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.openDocument(DOCUMENT_D);
    harness.gateway.clearCalls();
    expect(errorKind(await harness.workspace.moveEntry(DOCUMENT_D, null))).toBe(
      "invalidMove",
    );
    expect(errorKind(await harness.workspace.moveEntry(FOLDER_2, null))).toBe(
      "invalidMove",
    );
    expect(harness.gateway.calls).toEqual([]);
    // A closed sibling is still movable.
    expect((await harness.workspace.moveEntry(DOCUMENT_C, null)).ok).toBe(true);
  });

  it("rejects an unknown entry and an unknown target", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(
      errorKind(await harness.workspace.moveEntry(folderIdOf(99), null)),
    ).toBe("entityNotFound");
    expect(
      errorKind(await harness.workspace.moveEntry(DOCUMENT_A, folderIdOf(99))),
    ).toBe("entityNotFound");
  });

  it("keeps both parents dirty when the saves fail, and a retry saves them", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    harness.gateway.failOn("saveProject", "ioError");
    expect(
      errorKind(await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2)),
    ).toBe("ioError");
    const state = harness.store.getState().project;
    expect(state?.save.dirty).toBe(true);
    expect(
      state?.folders.find((entry) => entry.folderId === FOLDER_2)?.save.dirty,
    ).toBe(true);
    expect((await harness.workspace.saveAll()).ok).toBe(true);
    expect(diskOrder(harness, FOLDER_2)).toEqual([DOCUMENT_D, DOCUMENT_A]);
    expect(harness.gateway.disk.childOrder).toEqual([FOLDER_1, DOCUMENT_B]);
  });

  it("changes nothing when moveEntry itself fails", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("moveEntry", "ioError");
    expect(
      errorKind(await harness.workspace.moveEntry(DOCUMENT_A, FOLDER_2)),
    ).toBe("ioError");
    expect(harness.gateway.methods()).toEqual(["moveEntry"]);
    expect(rootOrder(harness)).toEqual([FOLDER_1, DOCUMENT_A, DOCUMENT_B]);
  });
});

describe("deleteFolder", () => {
  it("deletes an empty folder: saveFolder of the parent, then deleteFolder", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.deleteDocument(DOCUMENT_D, CONFIRMED);
    harness.gateway.clearCalls();
    expect((await harness.workspace.deleteFolder(FOLDER_2, CONFIRMED)).ok).toBe(
      true,
    );
    expect(harness.gateway.methods()).toEqual(["saveFolder", "deleteFolder"]);
    expect(folderOrder(harness, FOLDER_1)).toEqual([DOCUMENT_C]);
    expect(diskOrder(harness, FOLDER_1)).toEqual([DOCUMENT_C]);
    expect(
      harness.store
        .getState()
        .project?.folders.some((entry) => entry.folderId === FOLDER_2),
    ).toBe(false);
    expect(harness.gateway.disk.folders.has(FOLDER_2)).toBe(false);
  });

  it("deletes an empty root folder through the project order", async () => {
    const harness = await openedFolderDiskWorkspace();
    const created = await harness.workspace.createFolder(null, "Empty");
    if (!created.ok) throw new Error("create failed");
    harness.gateway.clearCalls();
    expect(
      (await harness.workspace.deleteFolder(created.value, CONFIRMED)).ok,
    ).toBe(true);
    expect(harness.gateway.methods()).toEqual(["saveProject", "deleteFolder"]);
    expect(rootOrder(harness)).toEqual([FOLDER_1, DOCUMENT_A, DOCUMENT_B]);
  });

  it("rejects a folder that is not empty without a gateway call", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect(
      errorKind(await harness.workspace.deleteFolder(FOLDER_1, CONFIRMED)),
    ).toBe("folderNotEmpty");
    expect(
      errorKind(await harness.workspace.deleteFolder(FOLDER_2, CONFIRMED)),
    ).toBe("folderNotEmpty");
    expect(harness.gateway.calls).toEqual([]);
  });

  it("keeps the folder listed and the parent dirty when the directory cannot be deleted", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.deleteDocument(DOCUMENT_D, CONFIRMED);
    harness.gateway.failOn("deleteFolder", "ioError");
    expect(
      errorKind(await harness.workspace.deleteFolder(FOLDER_2, CONFIRMED)),
    ).toBe("ioError");
    const parent = harness.store
      .getState()
      .project?.folders.find((entry) => entry.folderId === FOLDER_1);
    expect(parent?.childOrder).toEqual([FOLDER_2, DOCUMENT_C]);
    expect(parent?.save.dirty).toBe(true);
    expect(
      harness.store
        .getState()
        .project?.folders.some((entry) => entry.folderId === FOLDER_2),
    ).toBe(true);
    expect((await harness.workspace.saveFolder(FOLDER_1)).ok).toBe(true);
    expect(diskOrder(harness, FOLDER_1)).toEqual([FOLDER_2, DOCUMENT_C]);
  });

  it("does not delete anything when the parent order cannot be saved", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.deleteDocument(DOCUMENT_D, CONFIRMED);
    harness.gateway.clearCalls();
    harness.gateway.failOn("saveFolder", "ioError");
    expect(
      errorKind(await harness.workspace.deleteFolder(FOLDER_2, CONFIRMED)),
    ).toBe("ioError");
    expect(harness.gateway.methods()).toEqual(["saveFolder"]);
    expect(harness.gateway.disk.folders.has(FOLDER_2)).toBe(true);
  });

  it("deletes an empty folder that failed to load", async () => {
    const harness = await openedFolderDiskWorkspace();
    const failed = folderIdOf(7);
    harness.gateway.seedFolder({ folderId: failed, state: "loadFailed" });
    harness.gateway.disk.childOrder = [
      FOLDER_1,
      DOCUMENT_A,
      DOCUMENT_B,
      failed,
    ];
    await harness.workspace.openProject("selection-1");
    harness.gateway.clearCalls();
    expect(errorKind(await harness.workspace.moveFolder(failed, null))).toBe(
      "notWritable",
    );
    expect(errorKind(await harness.workspace.moveEntry(failed, FOLDER_1))).toBe(
      "notWritable",
    );
    expect(errorKind(await harness.workspace.createFolder(failed, "X"))).toBe(
      "notWritable",
    );
    expect(harness.gateway.calls).toEqual([]);
    expect((await harness.workspace.deleteFolder(failed, CONFIRMED)).ok).toBe(
      true,
    );
    expect(harness.gateway.methods()).toEqual(["saveProject", "deleteFolder"]);
  });
});
