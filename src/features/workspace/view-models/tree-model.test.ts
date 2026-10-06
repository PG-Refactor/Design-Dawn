import { describe, expect, it } from "vitest";
import { createApplicationStore } from "../../../application/state/application-state";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  openedWorkspace,
} from "../../../application/test-support/workspace-harness";
import { createInitialUiState, setActiveDocument } from "../ui-state/ui-state";
import { MESSAGES } from "../workspace-messages";
import { flattenProjectTree } from "./tree-items";
import {
  type DocumentNode,
  type ProjectTreeModel,
  selectProjectTree,
} from "./tree-model";

// The documents directly under the project (no folders in these projects).
function rootDocuments(model: ProjectTreeModel | null): DocumentNode[] {
  return (model?.entries ?? []).filter(
    (entry): entry is DocumentNode => entry.kind === "document",
  );
}

describe("selectProjectTree", () => {
  it("is null without a project", () => {
    expect(
      selectProjectTree(
        createApplicationStore().getState(),
        createInitialUiState(),
      ),
    ).toBeNull();
  });

  it("lists documents in order", async () => {
    const { store } = await openedWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    expect(model?.projectName).toBe("Project");
    expect(rootDocuments(model).map((node) => node.documentId)).toEqual([
      DOCUMENT_A,
      DOCUMENT_B,
      FAILED_DOCUMENT_ID,
    ]);
    expect(rootDocuments(model).every((node) => !node.isOpen)).toBe(true);
    const failed = rootDocuments(model)[2];
    expect(failed?.state).toBe("loadFailed");
    expect(failed?.name).toBe(MESSAGES.tree.unnamedEntity);
  });

  it("follows the project's childOrder", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.moveDocument(DOCUMENT_B, DOCUMENT_A);
    const model = selectProjectTree(store.getState(), createInitialUiState());
    expect(rootDocuments(model).map((node) => node.documentId)).toEqual([
      DOCUMENT_B,
      DOCUMENT_A,
      FAILED_DOCUMENT_ID,
    ]);
  });

  it("marks only the active document, and has no sheet nodes", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    await workspace.openDocument(DOCUMENT_B);
    const model = selectProjectTree(
      store.getState(),
      setActiveDocument(createInitialUiState(), DOCUMENT_B),
    );
    const [documentA, documentB] = rootDocuments(model);
    expect(documentA?.isOpen).toBe(true);
    expect(documentA?.isActive).toBe(false);
    expect(documentB?.isActive).toBe(true);
    expect(documentA).not.toHaveProperty("sheets");
  });
});

describe("flattenProjectTree", () => {
  it("lists visible items with parents, first children and openable documents", async () => {
    const { store, workspace } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    const model = selectProjectTree(store.getState(), createInitialUiState());
    if (model === null) throw new Error("project is open");
    const items = flattenProjectTree(model);
    expect(items.map((item) => item.key.split(":")[0])).toEqual([
      "project",
      "document",
      "document",
      "document",
    ]);
    expect(items[0]).toMatchObject({ parentIndex: null, firstChildIndex: 1 });
    // An open document has no child rows: its sheets are tabs, not tree items.
    expect(items[1]).toMatchObject({
      parentIndex: 0,
      firstChildIndex: null,
      opensOnExpand: false,
    });
    // Unopened and loadable: ArrowRight opens it. Failed to load: it does not.
    expect(items[2]?.opensOnExpand).toBe(true);
    expect(items[3]?.opensOnExpand).toBe(false);
  });
});

describe("selectProjectTree move availability", () => {
  it("disables up for the first and down for the last, counting entries that failed to load", async () => {
    const { store } = await openedWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    const moves = rootDocuments(model).map((node) => [
      node.canMoveUp,
      node.canMoveDown,
    ]);
    // A, B, failed: the failed one is the last position but cannot move itself, while B
    // can still move down past it.
    expect(moves).toEqual([
      [false, true],
      [true, true],
      [false, false],
    ]);
  });
});
