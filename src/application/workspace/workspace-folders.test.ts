import { describe, expect, it } from "vitest";
import { parseDocumentId } from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import type { ProjectSnapshot } from "../ports/persistence-types";
import { folderIdOf } from "../test-support/fakes";
import {
  CONFIRMED,
  createWorkspaceHarness,
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  DOCUMENT_D,
  errorKind,
  FOLDER_1,
  FOLDER_2,
  folderTreeSnapshot,
  openedFolderTreeWorkspace,
} from "../test-support/workspace-harness";

describe("opening a project with folders", () => {
  it("keeps the folder tree: parents, child orders and states", async () => {
    const { store } = await openedFolderTreeWorkspace();
    const project = store.getState().project;
    expect(project?.folders).toMatchObject(folderTreeSnapshot().folders);
    expect(
      project?.documents.map((entry) => [
        entry.documentId,
        entry.parentFolderId,
      ]),
    ).toEqual([
      [DOCUMENT_A, null],
      [DOCUMENT_B, null],
      [DOCUMENT_C, FOLDER_1],
      [DOCUMENT_D, FOLDER_2],
    ]);
    expect(project?.project.childOrder).toEqual([
      FOLDER_1,
      DOCUMENT_A,
      DOCUMENT_B,
    ]);
  });

  it("opens a project without folders with an empty folder list", async () => {
    const { workspace, store } = createWorkspaceHarness();
    await workspace.openProject("selection-1");
    expect(store.getState().project?.folders).toEqual([]);
  });

  it("replaces the folders when another project is opened", async () => {
    const { workspace, store } = await openedFolderTreeWorkspace();
    await workspace.openProject("selection-1");
    expect(store.getState().project?.folders).toEqual([]);
  });
});

describe("root operations in a project with folders", () => {
  it("creates a document at the root, appended after the folder entries", async () => {
    const { workspace, store, gateway } = await openedFolderTreeWorkspace();
    const created = await workspace.createDocument("New");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const project = store.getState().project;
    expect(project?.project.childOrder).toEqual([
      FOLDER_1,
      DOCUMENT_A,
      DOCUMENT_B,
      created.value,
    ]);
    expect(project?.documents.at(-1)).toMatchObject({
      documentId: created.value,
      parentFolderId: null,
    });
    // The folder id stays in the saved order.
    expect(gateway.disk.childOrder).toEqual(project?.project.childOrder);
    expect(project?.folders).toHaveLength(2);
  });

  it("moves a root document in front of a folder sibling and past one", async () => {
    const { workspace, store } = await openedFolderTreeWorkspace();
    expect((await workspace.moveDocument(DOCUMENT_B, FOLDER_1)).ok).toBe(true);
    expect(store.getState().project?.project.childOrder).toEqual([
      DOCUMENT_B,
      FOLDER_1,
      DOCUMENT_A,
    ]);
    expect((await workspace.moveDocument(DOCUMENT_B, null)).ok).toBe(true);
    expect(store.getState().project?.project.childOrder).toEqual([
      FOLDER_1,
      DOCUMENT_A,
      DOCUMENT_B,
    ]);
  });

  it("deletes a root document from the root order only, leaving folders and nested documents", async () => {
    const { workspace, store, gateway } = await openedFolderTreeWorkspace();
    expect((await workspace.deleteDocument(DOCUMENT_A, CONFIRMED)).ok).toBe(
      true,
    );
    const project = store.getState().project;
    expect(project?.project.childOrder).toEqual([FOLDER_1, DOCUMENT_B]);
    expect(project?.folders).toHaveLength(2);
    expect(project?.documents.map((entry) => entry.documentId)).toEqual([
      DOCUMENT_B,
      DOCUMENT_C,
      DOCUMENT_D,
    ]);
    expect(gateway.disk.childOrder).toEqual([FOLDER_1, DOCUMENT_B]);
  });

  it("renames the project without touching the folders", async () => {
    const { workspace, store } = await openedFolderTreeWorkspace();
    await workspace.renameProject("Renamed");
    expect(store.getState().project?.folders).toMatchObject(
      folderTreeSnapshot().folders,
    );
  });
});

describe("snapshot validation of the folder tree", () => {
  async function open(snapshot: ProjectSnapshot) {
    const harness = createWorkspaceHarness();
    harness.gateway.overrideProjectSnapshot("selection-bad", snapshot);
    const result = await harness.workspace.openProject("selection-bad");
    return { harness, result };
  }

  it("rejects an entry whose parent folder is not listed", async () => {
    const base = folderTreeSnapshot();
    const { harness, result } = await open({
      ...base,
      documents: base.documents.map((entry) => ({
        ...entry,
        parentFolderId: folderIdOf(99),
      })),
    });
    expect(errorKind(result)).toBe("invalidCommandResponse");
    expect(harness.store.getState().project).toBeNull();
  });

  it("rejects folders that are their own ancestors", async () => {
    const base = folderTreeSnapshot();
    const { result } = await open({
      ...base,
      folders: base.folders.map((folder) =>
        folder.folderId === FOLDER_1
          ? { ...folder, parentFolderId: FOLDER_2 }
          : folder,
      ),
    });
    expect(errorKind(result)).toBe("invalidCommandResponse");
  });

  it("rejects an ID used by both a folder and a document", async () => {
    const base = folderTreeSnapshot();
    const { result } = await open({
      ...base,
      documents: [
        {
          documentId: unwrap(parseDocumentId(FOLDER_1)),
          parentFolderId: null,
          name: "Impostor",
          state: "loaded",
        },
      ],
    });
    expect(errorKind(result)).toBe("duplicateId");
  });

  it("rejects a folder listed twice", async () => {
    const base = folderTreeSnapshot();
    const { result } = await open({
      ...base,
      folders: [...base.folders, ...base.folders],
    });
    expect(errorKind(result)).toBe("duplicateId");
  });
});
