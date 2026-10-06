import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FOLDER_1,
  FOLDER_TREE_SELECTION_ID,
  folderTreeSnapshot,
} from "../../application/test-support/workspace-harness";
import { createActionsHarness } from "./test-support/actions-harness";

async function openedFolderTreeActions() {
  const harness = createActionsHarness();
  harness.gateway.overrideProjectSnapshot(
    FOLDER_TREE_SELECTION_ID,
    folderTreeSnapshot(),
  );
  const opened = await harness.workspace.openProject(FOLDER_TREE_SELECTION_ID);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
  harness.gateway.clearCalls();
  return harness;
}

const childOrder = (
  harness: Awaited<ReturnType<typeof openedFolderTreeActions>>,
) => harness.store.getState().project?.project.childOrder;

describe("moving a document next to a folder", () => {
  it("steps up over the folder entry", async () => {
    const harness = await openedFolderTreeActions();
    const result = await harness.actions.moveDocumentBy(DOCUMENT_A, "up");
    expect(result.ok).toBe(true);
    expect(childOrder(harness)).toEqual([DOCUMENT_A, FOLDER_1, DOCUMENT_B]);
  });

  it("steps down past a sibling, keeping the folder where it is", async () => {
    const harness = await openedFolderTreeActions();
    await harness.actions.moveDocumentBy(DOCUMENT_A, "down");
    expect(childOrder(harness)).toEqual([FOLDER_1, DOCUMENT_B, DOCUMENT_A]);
  });
});
