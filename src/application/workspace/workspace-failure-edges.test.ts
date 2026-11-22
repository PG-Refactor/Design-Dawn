import { describe, expect, it } from "vitest";
import { renameSheetCommand } from "../commands/naming-commands";
import { operationErr, operationOk } from "../ports/operation-error";
import { createFakeDocumentWindows } from "../test-support/fake-document-windows";
import {
  displayName,
  documentIdOf,
  folderIdOf,
  sheetIdOf,
} from "../test-support/fakes";
import {
  CONFIRMED,
  createWorkspaceHarness,
  DOCUMENT_A,
  DOCUMENT_C,
  FOLDER_1,
  FOLDER_2,
  openedDocumentA,
  openedFolderDiskWorkspace,
  SELECTION_ID,
  SHEET_A1,
  SHEET_A2,
  type WorkspaceHarness,
} from "../test-support/workspace-harness";

// The workspace wraps the gateway when it is made, so a fake call is changed before that.
function patchedHarness(
  patch: (gateway: WorkspaceHarness["gateway"]) => void,
): WorkspaceHarness {
  const { gateway } = createWorkspaceHarness();
  patch(gateway);
  return createWorkspaceHarness({ sharedGateway: gateway });
}

async function withUnsavedDocument(): Promise<WorkspaceHarness> {
  const harness = await openedDocumentA();
  harness.autoSaveController.applyExternal(false);
  await harness.workspace
    .getDocumentSession(DOCUMENT_A)
    ?.execute(renameSheetCommand(SHEET_A1, displayName("Unsaved")));
  return harness;
}

describe("saving and closing everything", () => {
  it("keeps saving after the Project file fails, and reports that failure", async () => {
    const harness = await openedFolderDiskWorkspace();
    const { workspace, gateway } = harness;
    gateway.failOn("saveProject", "ioError");
    await workspace.renameProject("Renamed");
    gateway.failOn("saveProject", "ioError");
    gateway.failOn("saveFolder", "ioError");
    await workspace.renameFolder(FOLDER_2, "Renamed");
    gateway.failOn("saveProject", "ioError");
    gateway.failOn("saveFolder", "ioError");
    expect((await workspace.saveAll()).ok).toBe(false);
    expect(gateway.methods("saveFolder").length).toBeGreaterThan(1);
  });

  it("stops closing the Project at the first save that fails", async () => {
    const project = await openedFolderDiskWorkspace();
    project.gateway.failOn("saveProject", "ioError");
    await project.workspace.renameProject("Renamed");
    project.gateway.failOn("saveProject", "ioError");
    expect((await project.workspace.closeProject()).ok).toBe(false);

    const folder = await openedFolderDiskWorkspace();
    folder.gateway.failOn("saveFolder", "ioError");
    await folder.workspace.renameFolder(FOLDER_2, "Renamed");
    folder.gateway.failOn("saveFolder", "ioError");
    expect((await folder.workspace.closeProject()).ok).toBe(false);
  });

  it("reports a Document Rust cannot close, with and without saving", async () => {
    const saving = await openedDocumentA();
    saving.gateway.failOn("closeDocument", "ioError");
    expect((await saving.workspace.closeProject()).ok).toBe(false);
    const discarding = await withUnsavedDocument();
    discarding.gateway.failOn("closeDocument", "ioError");
    expect(
      (await discarding.workspace.closeProject({ discardChanges: true })).ok,
    ).toBe(false);
  });
});

describe("opening and creating", () => {
  it("refuses a Document snapshot that is not the requested one", async () => {
    const harness = patchedHarness((gateway) => {
      const load = gateway.loadDocument.bind(gateway);
      gateway.loadDocument = async (projectId) => load(projectId, DOCUMENT_A);
    });
    await harness.workspace.openProject(SELECTION_ID);
    expect((await harness.workspace.openDocument(documentIdOf(2))).ok).toBe(
      false,
    );
  });

  it("refuses a created Document Rust did not create as asked, and a parent that cannot take it", async () => {
    const harness = patchedHarness((gateway) => {
      const create = gateway.createDocument.bind(gateway);
      gateway.createDocument = async (projectId, _documentId, name, parent) =>
        create(projectId, documentIdOf(77), name, parent);
    });
    await harness.workspace.openProject(SELECTION_ID);
    expect(
      (await harness.workspace.createDocument("New", folderIdOf(99))).ok,
    ).toBe(false);
    expect((await harness.workspace.createDocument("New")).ok).toBe(false);
  });

  it("refuses a created Document that its parent already lists", async () => {
    let harness: WorkspaceHarness | null = null;
    harness = patchedHarness((gateway) => {
      const create = gateway.createDocument.bind(gateway);
      gateway.createDocument = async (projectId, documentId, name, parent) => {
        harness?.store.setState((state) =>
          state.project === null
            ? state
            : {
                ...state,
                project: {
                  ...state.project,
                  project: {
                    ...state.project.project,
                    childOrder: [
                      ...state.project.project.childOrder,
                      documentId,
                    ],
                  },
                },
              },
        );
        return create(projectId, documentId, name, parent);
      };
    });
    await harness.workspace.openProject(SELECTION_ID);
    expect((await harness.workspace.createDocument("New")).ok).toBe(false);
  });

  it("refuses an invalid Project name, and a nested folder path whose level cannot be made", async () => {
    const harness = await openedFolderDiskWorkspace();
    expect((await harness.workspace.renameProject("a\u0000")).ok).toBe(false);
    harness.gateway.failOn("createFolder", "ioError");
    expect((await harness.workspace.createFolder(null, "x/y")).ok).toBe(false);
  });
});

describe("deleting a Document", () => {
  it("keeps a Document its parent does not list when the directory cannot go", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.store.setState((state) =>
      state.project === null
        ? state
        : {
            ...state,
            project: {
              ...state.project,
              folders: state.project.folders.map((entry) =>
                entry.folderId === FOLDER_1
                  ? {
                      ...entry,
                      childOrder: entry.childOrder.filter(
                        (id) => id !== DOCUMENT_C,
                      ),
                    }
                  : entry,
              ),
            },
          },
    );
    harness.gateway.failOn("deleteDocument", "ioError");
    expect(
      (await harness.workspace.deleteDocument(DOCUMENT_C, CONFIRMED)).ok,
    ).toBe(false);
    expect(
      harness.store
        .getState()
        .project?.documents.some((entry) => entry.documentId === DOCUMENT_C),
    ).toBe(true);
    expect(
      (await harness.workspace.deleteDocument(DOCUMENT_C, CONFIRMED)).ok,
    ).toBe(true);
  });

  it("refuses a Document whose parent is unknown", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.store.setState((state) =>
      state.project === null
        ? state
        : {
            ...state,
            project: {
              ...state.project,
              documents: state.project.documents.map((entry) =>
                entry.documentId === DOCUMENT_C
                  ? { ...entry, parentFolderId: folderIdOf(98) }
                  : entry,
              ),
            },
          },
    );
    expect(
      (await harness.workspace.deleteDocument(DOCUMENT_C, CONFIRMED)).ok,
    ).toBe(false);
  });
});

describe("sheets", () => {
  it("refuses a created Sheet Rust did not create as asked", async () => {
    const harness = patchedHarness((gateway) => {
      const create = gateway.createSheet.bind(gateway);
      gateway.createSheet = async (projectId, documentId, _sheetId, name) =>
        create(projectId, documentId, sheetIdOf(88), name);
    });
    await harness.workspace.openProject(SELECTION_ID);
    await harness.workspace.openDocument(DOCUMENT_A);
    expect((await harness.workspace.createSheet(DOCUMENT_A, "New")).ok).toBe(
      false,
    );
  });

  it("leaves the order alone when a Sheet's directory cannot go, and marks it unsaved when the order cannot be written back", async () => {
    const harness = await openedDocumentA();
    harness.gateway.failOn("deleteSheet", "ioError");
    harness.gateway.failOn("saveDocument", "ioError", 2);
    expect(
      (await harness.workspace.deleteSheet(DOCUMENT_A, SHEET_A2, CONFIRMED)).ok,
    ).toBe(false);
    expect(
      harness.store.getState().documents.get(DOCUMENT_A)?.save.documentDirty,
    ).toBe(true);
  });

  it("stops deleting a Sheet when the other edits cannot be saved first", async () => {
    const harness = await withUnsavedDocument();
    harness.gateway.failOn("saveSheet", "ioError");
    expect(
      (await harness.workspace.deleteSheet(DOCUMENT_A, SHEET_A2, CONFIRMED)).ok,
    ).toBe(false);
  });
});

describe("unused assets and windows", () => {
  it("refuses for a Document that is not open or without a Project, and passes on a failed listing", async () => {
    const harness = await openedDocumentA();
    expect((await harness.workspace.listUnusedAssets(documentIdOf(2))).ok).toBe(
      false,
    );
    harness.gateway.failOn("listUnusedAssets", "ioError");
    expect((await harness.workspace.listUnusedAssets(DOCUMENT_A)).ok).toBe(
      false,
    );
    expect(
      (await harness.workspace.deleteUnusedAssets(DOCUMENT_A, [])).ok,
    ).toBe(true);
    await harness.workspace.closeProject();
    expect((await harness.workspace.listUnusedAssets(DOCUMENT_A)).ok).toBe(
      false,
    );
    expect((await harness.workspace.reloadProject()).ok).toBe(false);
    expect((await harness.workspace.dropTargetAt(0, 0)).ok).toBe(false);
    expect((await harness.workspace.listProjectWindows()).ok).toBe(false);
  });

  it("drops into a new window without a window gateway", async () => {
    const harness = await openedDocumentA();
    expect(await harness.workspace.dropTargetAt(3, 4)).toEqual(
      operationOk({ kind: "newWindow", screenX: 3, screenY: 4 }),
    );
  });

  it("passes on a window lookup that fails, a tree that cannot be read, and takes the tree as it is in a Document window", async () => {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    const base = windows.gatewayFor("main");
    let snapshotFails = false;
    const harness = createWorkspaceHarness({
      sharedGateway: first.gateway,
      windows: {
        ...base,
        projectWindowAt: async () => operationErr("ioError", "no windows"),
        getProjectSnapshot: async (projectId) =>
          snapshotFails
            ? operationErr("ioError", "unreadable")
            : base.getProjectSnapshot(projectId),
      },
    });
    await harness.workspace.openProject(SELECTION_ID);
    expect((await harness.workspace.dropTargetAt(0, 0)).ok).toBe(false);
    snapshotFails = true;
    expect((await harness.workspace.refreshProjectTree()).ok).toBe(false);
    snapshotFails = false;
    harness.store.setState((state) => ({ ...state, windowRole: "document" }));
    expect((await harness.workspace.refreshProjectTree()).ok).toBe(true);
  });
});
