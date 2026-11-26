import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSIONS } from "../../domain/domain-constants";
import { renameSheetCommand } from "../commands/naming-commands";
import { operationErr, operationOk } from "../ports/operation-error";
import { createFakeDocumentWindows } from "../test-support/fake-document-windows";
import {
  createSequentialIdGenerator,
  displayName,
  documentIdOf,
  folderIdOf,
  makeSheetWith,
  sheetIdOf,
} from "../test-support/fakes";
import {
  CONFIRMED,
  createWorkspaceHarness,
  DOCUMENT_A,
  DOCUMENT_C,
  FAILED_SHEET_ID,
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
    // Deleted at once only while Auto Save is on.
    harness.autoSaveController.applyExternal(true);
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

describe("the last workspace edges", () => {
  it("lists no open Documents without a Project or for an unknown entry", async () => {
    const harness = await openedDocumentA();
    expect(harness.workspace.openDocumentsUnder(folderIdOf(97))).toEqual([]);
    await harness.workspace.closeProject();
    expect(harness.workspace.openDocumentsUnder(DOCUMENT_A)).toEqual([]);
  });

  it("stops closing the Project when its own file cannot be saved", async () => {
    const harness = await openedDocumentA();
    harness.gateway.failAlways("saveProject", "ioError");
    expect((await harness.workspace.renameProject("Renamed")).ok).toBe(false);
    const closed = await harness.workspace.closeProject();
    expect(!closed.ok && closed.error.kind).toBe("ioError");
    harness.gateway.clearFailures();
  });

  it("saves a Project left unsaved by a failed save before closing it", async () => {
    const harness = await openedDocumentA();
    harness.gateway.failOn("saveProject", "ioError");
    expect((await harness.workspace.renameProject("Renamed")).ok).toBe(false);
    expect((await harness.workspace.closeProject()).ok).toBe(true);
    expect(harness.gateway.methods("saveProject")).toHaveLength(2);
  });

  it("keeps a Document here when it cannot be handed over", async () => {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    const harness = createWorkspaceHarness({
      sharedGateway: first.gateway,
      windows: windows.gatewayFor("main"),
    });
    await harness.workspace.openProject(SELECTION_ID);
    await harness.workspace.openDocument(DOCUMENT_A);
    const session = harness.workspace.getDocumentSession(DOCUMENT_A);
    if (session === null) throw new Error("not open");
    Object.assign(session, {
      handOver: async () => operationErr("notWritable", "busy"),
    });
    expect(
      (
        await harness.workspace.moveDocumentToWindow(DOCUMENT_A, {
          kind: "newWindow",
          screenX: 0,
          screenY: 0,
        })
      ).ok,
    ).toBe(false);
    expect(harness.workspace.getDocumentSession(DOCUMENT_A)).toBe(session);
  });

  it("refuses a tree Rust sends that is not consistent, and takes a valid one with its folders", async () => {
    const folders = await openedFolderDiskWorkspace();
    const windows = createFakeDocumentWindows(folders.gateway);
    const base = windows.gatewayFor("doc");
    let broken = false;
    const harness = createWorkspaceHarness({
      sharedGateway: folders.gateway,
      windows: {
        ...base,
        // The tree as the folder window holds it.
        getProjectSnapshot: async () => {
          const project = folders.store.getState().project;
          if (project === null) return operationErr("projectNotOpen", "closed");
          const snapshot = {
            // Raw, as Rust sends it.
            project: {
              ...project.project,
              schemaVersion: CURRENT_SCHEMA_VERSIONS.project,
            } as never,
            sessionGeneration: project.sessionGeneration,
            folders: project.folders,
            documents: project.documents,
            issues: [],
          };
          return operationOk(
            broken
              ? {
                  ...snapshot,
                  folders: [...snapshot.folders, ...snapshot.folders],
                }
              : snapshot,
          );
        },
      },
    });
    await harness.workspace.openProject(SELECTION_ID);
    harness.store.setState((state) => ({ ...state, windowRole: "document" }));
    broken = true;
    expect((await harness.workspace.refreshProjectTree()).ok).toBe(false);
    broken = false;
    const refreshed = await harness.workspace.refreshProjectTree();
    expect(refreshed.ok).toBe(true);
    expect(harness.store.getState().project?.folders.length).toBeGreaterThan(0);
  });

  it("refuses a new Sheet whose id the Document already has", async () => {
    const taken = createSequentialIdGenerator().sheetId();
    const lone = documentIdOf(30);
    const harness = patchedHarness((gateway) => {
      gateway.seedDocument({
        documentId: lone,
        name: "Lone",
        sheets: [{ sheetId: taken, name: "S" }],
      });
      gateway.createSheet = async (_projectId, _documentId, sheetId, name) =>
        operationOk({
          sheetId,
          name,
          state: "loaded",
          sheet: makeSheetWith(sheetId, []),
        });
    });
    await harness.workspace.openProject(SELECTION_ID);
    expect((await harness.workspace.openDocument(lone)).ok).toBe(true);
    const created = await harness.workspace.createSheet(lone, "New");
    expect(!created.ok && created.error.kind).toBe("duplicateId");
  });

  it("deletes a Sheet its Document does not list, without writing the order", async () => {
    const harness = patchedHarness((gateway) => {
      const load = gateway.loadDocument.bind(gateway);
      gateway.loadDocument = async (projectId, documentId) => {
        const loaded = await load(projectId, documentId);
        return loaded.ok
          ? operationOk({
              ...loaded.value,
              document: {
                ...loaded.value.document,
                sheetOrder: loaded.value.document.sheetOrder.filter(
                  (id) => id !== FAILED_SHEET_ID,
                ),
              },
            })
          : loaded;
      };
    });
    await harness.workspace.openProject(SELECTION_ID);
    await harness.workspace.openDocument(DOCUMENT_A);
    harness.gateway.failOn("deleteSheet", "ioError");
    expect(
      (
        await harness.workspace.deleteSheet(
          DOCUMENT_A,
          FAILED_SHEET_ID,
          CONFIRMED,
        )
      ).ok,
    ).toBe(false);
    harness.gateway.clearCalls();
    expect(
      (
        await harness.workspace.deleteSheet(
          DOCUMENT_A,
          FAILED_SHEET_ID,
          CONFIRMED,
        )
      ).ok,
    ).toBe(true);
    expect(harness.gateway.methods("saveDocument")).toEqual([]);
  });

  it("passes on a launch request whose Project cannot replace the open one", async () => {
    const harness = await openedDocumentA();
    harness.gateway.failAlways("saveProject", "ioError");
    await harness.workspace.renameProject("Renamed");
    harness.gateway.queueOpenRequest(DOCUMENT_A);
    expect((await harness.workspace.openLaunchRequest()).ok).toBe(false);
    harness.gateway.clearFailures();
  });
});

describe("waiting for the lifecycle", () => {
  it("resolves after the steps queued before it", async () => {
    const harness = createWorkspaceHarness();
    const order: string[] = [];
    const opened = harness.workspace
      .openProject(SELECTION_ID)
      .then(() => order.push("open"));
    await harness.workspace.whenIdle().then(() => order.push("idle"));
    await opened;
    expect(order).toEqual(["open", "idle"]);
  });
});
