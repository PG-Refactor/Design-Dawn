import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  openedFolderTreeWorkspace,
} from "../../../application/test-support/workspace-harness";
import { createInitialUiState } from "../ui-state/ui-state";
import { selectProjectTree } from "./tree-model";

// Temporary (Folder UI is not built yet): the Tree lists only the Project's own
// Documents. These tests pin that, and that reordering still works around Folder entries.
describe("selectProjectTree in a project with folders", () => {
  it("lists only the documents directly under the project", async () => {
    const { store } = await openedFolderTreeWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    expect(model?.documents.map((node) => node.documentId)).toEqual([
      DOCUMENT_A,
      DOCUMENT_B,
    ]);
    expect(
      model?.documents.some((node) => node.documentId === DOCUMENT_C),
    ).toBe(false);
  });

  it("computes move limits against the full order, which includes the folder", async () => {
    const { store } = await openedFolderTreeWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    const [first, second] = model?.documents ?? [];
    // childOrder is [FOLDER_1, A, B]: A can still step up past the folder.
    expect(first?.canMoveUp).toBe(true);
    expect(first?.canMoveDown).toBe(true);
    expect(second?.canMoveUp).toBe(true);
    expect(second?.canMoveDown).toBe(false);
  });
});
