import { describe, expect, it } from "vitest";
import { folderIdOf } from "../test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  DOCUMENT_D,
  FOLDER_1,
  FOLDER_2,
  openedFolderDiskWorkspace,
} from "../test-support/workspace-harness";
import { deletionCounts, deletionSteps } from "./project-entries";

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
