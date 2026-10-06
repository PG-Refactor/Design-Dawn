import { describe, expect, it } from "vitest";
import { parseProject } from "../../domain/project/project";
import { PROJECT_ID } from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import { moveBlocksCommand } from "../commands/block-commands";
import { renameDocumentCommand } from "../commands/naming-commands";
import {
  blockIdOf,
  displayName,
  documentIdOf,
  position,
  settle,
} from "../test-support/fakes";
import {
  CONFIRMED,
  createWorkspaceHarness,
  DOCUMENT_A,
  DOCUMENT_B,
  errorKind,
  FAILED_DOCUMENT_ID,
  openedDocumentA,
  openedWorkspace,
  SELECTION_ID,
  SHEET_A1,
} from "../test-support/workspace-harness";

describe("selectProjectFolder", () => {
  it("passes a selection through", async () => {
    const { workspace } = createWorkspaceHarness();
    const result = await workspace.selectProjectFolder();
    expect(result).toEqual({
      ok: true,
      value: {
        status: "selected",
        selectionId: SELECTION_ID,
        displayPath: "/projects/example",
      },
    });
  });

  it("returns cancel as an ok result, not an error", async () => {
    const { workspace, gateway } = createWorkspaceHarness();
    gateway.selectNext({ status: "cancelled" });
    expect(await workspace.selectProjectFolder()).toEqual({
      ok: true,
      value: { status: "cancelled" },
    });
  });
});

describe("openProject", () => {
  it("populates the store from the snapshot", async () => {
    const { workspace, store } = createWorkspaceHarness();
    expect((await workspace.openProject(SELECTION_ID)).ok).toBe(true);
    const project = store.getState().project;
    expect(project?.projectId).toBe(PROJECT_ID);
    expect(project?.documents).toEqual([
      {
        documentId: DOCUMENT_A,
        parentFolderId: null,
        name: "Document A",
        state: "loaded",
      },
      {
        documentId: DOCUMENT_B,
        parentFolderId: null,
        name: "Document B",
        state: "loaded",
      },
      {
        documentId: FAILED_DOCUMENT_ID,
        parentFolderId: null,
        name: null,
        state: "loadFailed",
      },
    ]);
    expect(project?.folders).toEqual([]);
    expect(project?.save).toEqual({ dirty: false, lastError: null });
  });

  it("leaves the previous state untouched when opening fails", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    const before = store.getState();
    const result = await workspace.openProject("unknown-selection");
    expect(errorKind(result)).toBe("invalidFolderSelection");
    expect(store.getState()).toBe(before);
    // The selection stays usable: the same call succeeds afterwards.
    expect((await workspace.openProject(SELECTION_ID)).ok).toBe(true);
    expect(gateway.methods("openProject")).toHaveLength(2);
  });

  it("rejects an invalid snapshot and keeps the state", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    const before = store.getState();
    const base = unwrap(
      parseProject({
        schemaVersion: 2,
        projectId: PROJECT_ID,
        name: "Broken",
        childOrder: [],
      }),
    );
    gateway.overrideProjectSnapshot("selection-bad", {
      project: { ...base, childOrder: [DOCUMENT_A, DOCUMENT_A] },
      folders: [],
      documents: [],
      issues: [],
    });
    const result = await workspace.openProject("selection-bad");
    expect(errorKind(result)).toBe("duplicateId");
    expect(store.getState()).toBe(before);
  });

  it("closes open documents first and emits projectClosed", async () => {
    const harness = await openedDocumentA();
    const { workspace, gateway, store, events } = harness;
    const session = workspace.getDocumentSession(DOCUMENT_A);
    await session?.execute(
      moveBlocksCommand(SHEET_A1, [
        { blockId: blockIdOf(1), position: position(1, 1) },
      ]),
    );
    expect((await workspace.openProject(SELECTION_ID)).ok).toBe(true);
    expect(gateway.methods()).toEqual(["closeDocument", "openProject"]);
    expect(store.getState().documents.size).toBe(0);
    expect(events.map((event) => event.type)).toEqual([
      "documentClosed",
      "projectClosed",
    ]);
  });

  it("aborts, keeping project and documents, when a document cannot be saved", async () => {
    const { workspace, gateway, store, events } = await openedDocumentA();
    const session = workspace.getDocumentSession(DOCUMENT_A);
    expect(session).not.toBeNull();
    // A rename makes the document dirty, so closing it needs a save.
    await session?.execute(renameDocumentCommand(displayName("Renamed")));
    gateway.failAlways("saveDocument", "ioError");
    const result = await workspace.openProject(SELECTION_ID);
    expect(errorKind(result)).toBe("ioError");
    expect(store.getState().project).not.toBeNull();
    expect(store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(workspace.getDocumentSession(DOCUMENT_A)).toBe(session);
    expect(events).toEqual([]);
    expect(gateway.methods("openProject")).toHaveLength(0);
    // Editing continues and a later attempt succeeds.
    gateway.clearFailures();
    expect((await workspace.openProject(SELECTION_ID)).ok).toBe(true);
  });

  it("keeps the project (documents closed and saved) when the new open fails", async () => {
    const { workspace, store } = await openedDocumentA();
    const result = await workspace.openProject("unknown-selection");
    expect(result.ok).toBe(false);
    expect(store.getState().project).not.toBeNull();
    expect(store.getState().documents.size).toBe(0);
  });
});

describe("createProject", () => {
  it("creates and installs the project", async () => {
    const { workspace, store, gateway } = createWorkspaceHarness();
    expect((await workspace.createProject(SELECTION_ID, "Fresh")).ok).toBe(
      true,
    );
    expect(store.getState().project?.project.name).toBe("Fresh");
    expect(store.getState().project?.documents).toEqual([]);
    expect(gateway.disk.projectName).toBe("Fresh");
  });

  it("rejects an invalid name before touching anything", async () => {
    const { workspace, gateway, store } = await openedDocumentA();
    const before = store.getState();
    const result = await workspace.createProject(SELECTION_ID, "   ");
    expect(errorKind(result)).toBe("invalidDisplayName");
    expect(store.getState()).toBe(before);
    expect(gateway.methods()).toEqual([]);
  });
});

describe("closeProject", () => {
  it("closes documents, clears the project and emits events", async () => {
    const { workspace, store, events } = await openedDocumentA();
    expect((await workspace.closeProject()).ok).toBe(true);
    expect(store.getState().project).toBeNull();
    expect(store.getState().documents.size).toBe(0);
    expect(events.map((event) => event.type)).toEqual([
      "documentClosed",
      "projectClosed",
    ]);
    expect((await workspace.closeProject()).ok).toBe(true);
    expect(events).toHaveLength(2);
  });

  it("fails and keeps everything when a document cannot be saved", async () => {
    const { workspace, store, gateway } = await openedDocumentA();
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameDocumentCommand(displayName("Renamed")));
    gateway.failAlways("saveDocument", "ioError");
    expect(errorKind(await workspace.closeProject())).toBe("ioError");
    expect(store.getState().project).not.toBeNull();
    expect(store.getState().documents.has(DOCUMENT_A)).toBe(true);
  });
});

describe("operations without a project", () => {
  it("report projectNotOpen", async () => {
    const { workspace } = createWorkspaceHarness();
    const results = [
      await workspace.openDocument(DOCUMENT_A),
      await workspace.createDocument("X"),
      await workspace.deleteDocument(DOCUMENT_A, CONFIRMED),
      await workspace.renameProject("X"),
      await workspace.moveDocument(DOCUMENT_A, null),
      await workspace.saveProject(),
      await workspace.createSheet(DOCUMENT_A, "X"),
      await workspace.deleteSheet(DOCUMENT_A, SHEET_A1, CONFIRMED),
    ];
    expect(results.map(errorKind)).toEqual(results.map(() => "projectNotOpen"));
  });

  it("does not require a project to close a document", async () => {
    const { workspace } = createWorkspaceHarness();
    expect((await workspace.closeDocument(DOCUMENT_A)).ok).toBe(true);
  });
});

describe("project-level operations", () => {
  it("renames and saves", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    expect((await workspace.renameProject("Renamed")).ok).toBe(true);
    expect(store.getState().project?.project.name).toBe("Renamed");
    expect(gateway.disk.projectName).toBe("Renamed");
    expect(gateway.methods()).toEqual(["saveProject"]);
  });

  it("keeps the new name dirty with the error when the save fails, and retries", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    gateway.failOn("saveProject", "ioError");
    expect(errorKind(await workspace.renameProject("Renamed"))).toBe("ioError");
    const failed = store.getState().project;
    expect(failed?.project.name).toBe("Renamed");
    expect(failed?.save.dirty).toBe(true);
    expect(failed?.save.lastError?.kind).toBe("ioError");
    expect(gateway.disk.projectName).toBe("Project");

    expect((await workspace.saveProject()).ok).toBe(true);
    expect(store.getState().project?.save).toEqual({
      dirty: false,
      lastError: null,
    });
    expect(gateway.disk.projectName).toBe("Renamed");
  });

  it("moves a document (order and entries) and saves", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    expect((await workspace.moveDocument(DOCUMENT_B, DOCUMENT_A)).ok).toBe(
      true,
    );
    expect(store.getState().project?.project.childOrder).toEqual([
      DOCUMENT_B,
      DOCUMENT_A,
      FAILED_DOCUMENT_ID,
    ]);
    expect(
      store.getState().project?.documents.map((entry) => entry.documentId),
    ).toEqual([DOCUMENT_B, DOCUMENT_A, FAILED_DOCUMENT_ID]);
    expect(gateway.disk.childOrder).toEqual([
      DOCUMENT_B,
      DOCUMENT_A,
      FAILED_DOCUMENT_ID,
    ]);
  });

  it("keeps a failed move in memory, dirty", async () => {
    const { workspace, store, gateway } = await openedWorkspace();
    gateway.failOn("saveProject", "ioError");
    expect(
      errorKind(await workspace.moveDocument(DOCUMENT_B, DOCUMENT_A)),
    ).toBe("ioError");
    expect(store.getState().project?.project.childOrder[0]).toBe(DOCUMENT_B);
    expect(store.getState().project?.save.dirty).toBe(true);
    expect(gateway.disk.childOrder[0]).toBe(DOCUMENT_A);
  });

  it("rejects moving an unknown document without saving", async () => {
    const { workspace, gateway } = await openedWorkspace();
    const result = await workspace.moveDocument(documentIdOf(99), null);
    expect(errorKind(result)).toBe("entityNotFound");
    expect(gateway.methods()).toEqual([]);
  });

  it("refuses to switch project while the project save is still failing", async () => {
    const { workspace, gateway, store } = await openedWorkspace();
    gateway.failOn("saveProject", "ioError");
    await workspace.renameProject("Renamed");
    gateway.failAlways("saveProject", "ioError");
    const result = await workspace.openProject(SELECTION_ID);
    expect(errorKind(result)).toBe("ioError");
    expect(store.getState().project?.project.name).toBe("Renamed");
    expect(gateway.methods("openProject")).toHaveLength(0);
  });
});

describe("lifecycle serialization", () => {
  it("never interleaves two lifecycle operations", async () => {
    const { workspace, gateway } = await openedWorkspace();
    const release = gateway.hold("loadDocument");
    const first = workspace.openDocument(DOCUMENT_A);
    const second = workspace.openDocument(DOCUMENT_B);
    await settle();
    expect(gateway.methods("loadDocument")).toHaveLength(1);
    release();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(gateway.methods("loadDocument")).toHaveLength(2);
  });
});
