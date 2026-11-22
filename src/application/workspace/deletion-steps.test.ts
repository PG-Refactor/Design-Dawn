import { describe, expect, it } from "vitest";
import { documentIdOf, folderIdOf } from "../test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  DOCUMENT_D,
  FOLDER_1,
  FOLDER_2,
  openedFolderDiskWorkspace,
} from "../test-support/workspace-harness";
import {
  deletionCounts,
  deletionSteps,
  folderValueOf,
  orderWithout,
  withAppendedChild,
} from "./project-entries";

// (root)  FOLDER_1, DOCUMENT_A, DOCUMENT_B
// FOLDER_1  FOLDER_2, DOCUMENT_C
// FOLDER_2  DOCUMENT_D
async function project() {
  const { store } = await openedFolderDiskWorkspace();
  const opened = store.getState().project;
  if (opened === null) throw new Error("no project");
  return opened;
}

const idsOf = (steps: ReturnType<typeof deletionSteps>) =>
  steps.map((step) =>
    step.kind === "document" ? step.documentId : step.folderId,
  );

describe("deletionSteps", () => {
  it("deletes a folder after everything inside it, Documents before Folders", async () => {
    const steps = deletionSteps(await project(), [FOLDER_1]);
    expect(idsOf(steps)).toEqual([DOCUMENT_C, DOCUMENT_D, FOLDER_2, FOLDER_1]);
    expect(deletionCounts(steps)).toEqual({ documents: 2, folders: 2 });
  });

  it("lists an entry inside a given folder once, as part of that folder", async () => {
    const steps = deletionSteps(await project(), [
      DOCUMENT_D,
      FOLDER_1,
      DOCUMENT_A,
    ]);
    expect(idsOf(steps)).toEqual([
      DOCUMENT_C,
      DOCUMENT_D,
      FOLDER_2,
      FOLDER_1,
      DOCUMENT_A,
    ]);
  });

  it("keeps plain Documents in the given order and skips unknown ids", async () => {
    const steps = deletionSteps(await project(), [
      DOCUMENT_B,
      folderIdOf(99),
      DOCUMENT_A,
    ]);
    expect(idsOf(steps)).toEqual([DOCUMENT_B, DOCUMENT_A]);
    expect(deletionCounts(steps)).toEqual({ documents: 2, folders: 0 });
  });

  it("names each step", async () => {
    const [first] = deletionSteps(await project(), [FOLDER_2]);
    expect(first).toEqual({
      kind: "document",
      documentId: DOCUMENT_D,
      name: "Document D",
    });
  });
});

describe("project entry helpers", () => {
  it("orders a Folder's Documents and Folders by its order, unlisted ones last", async () => {
    const opened = await project();
    const extraDocument = {
      ...(opened.documents.find(
        (entry) => entry.documentId === DOCUMENT_D,
      ) as (typeof opened.documents)[number]),
      documentId: documentIdOf(40),
    };
    const extraFolder = {
      ...(opened.folders.find(
        (entry) => entry.folderId === FOLDER_2,
      ) as (typeof opened.folders)[number]),
      folderId: folderIdOf(41),
      parentFolderId: FOLDER_2,
    };
    const crowded = {
      ...opened,
      documents: [...opened.documents, extraDocument],
      folders: [
        ...opened.folders.map((entry) =>
          entry.folderId === FOLDER_2 ? { ...entry, childOrder: [] } : entry,
        ),
        extraFolder,
        { ...extraFolder, folderId: folderIdOf(42) },
      ],
    };
    expect(idsOf(deletionSteps(crowded, [FOLDER_2]))).toEqual([
      DOCUMENT_D,
      documentIdOf(40),
      folderIdOf(41),
      folderIdOf(42),
      FOLDER_2,
    ]);
  });

  it("refuses an unknown parent and an entry already listed", async () => {
    const opened = await project();
    expect(withAppendedChild(opened, folderIdOf(99), DOCUMENT_A).ok).toBe(
      false,
    );
    expect(withAppendedChild(opened, null, DOCUMENT_A).ok).toBe(false);
    expect(orderWithout(opened, folderIdOf(99), DOCUMENT_A).ok).toBe(false);
    const unlisted = orderWithout(opened, null, documentIdOf(50));
    expect(unlisted.ok && unlisted.value).toBeNull();
  });

  it("does not write a Folder that did not load", async () => {
    const opened = await project();
    const folder = opened.folders[0] as (typeof opened.folders)[number];
    expect(folderValueOf({ ...folder, state: "loadFailed" }, []).ok).toBe(
      false,
    );
    expect(folderValueOf({ ...folder, name: null }, []).ok).toBe(false);
  });
});
