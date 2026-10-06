import { describe, expect, it } from "vitest";
import { folderIdOf } from "../../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  DOCUMENT_C,
  DOCUMENT_D,
  FOLDER_1,
  FOLDER_2,
  openedFolderDiskWorkspace,
} from "../../../application/test-support/workspace-harness";
import { createInitialUiState, setFolderCollapsed } from "../ui-state/ui-state";
import { treeNavigation } from "./keyboard-navigation";
import { selectMoveTargets } from "./move-targets";
import {
  documentTreeKey,
  flattenProjectTree,
  folderTreeKey,
  PROJECT_TREE_KEY,
} from "./tree-items";
import {
  type FolderNode,
  type ProjectTreeModel,
  selectProjectTree,
  type TreeEntryNode,
} from "./tree-model";

// Compact description of a level: "F:<id>" for folders, "D:<id>" for documents.
function describeLevel(entries: readonly TreeEntryNode[]): string[] {
  return entries.map((entry) =>
    entry.kind === "folder" ? `F:${entry.folderId}` : `D:${entry.documentId}`,
  );
}

function folderNode(
  model: ProjectTreeModel | null,
  folderId: string,
): FolderNode {
  const find = (entries: readonly TreeEntryNode[]): FolderNode | null => {
    for (const entry of entries) {
      if (entry.kind !== "folder") continue;
      if (entry.folderId === folderId) return entry;
      const inside = find(entry.children);
      if (inside !== null) return inside;
    }
    return null;
  };
  const found = find(model?.entries ?? []);
  if (found === null) throw new Error(`folder ${folderId} is not in the tree`);
  return found;
}

describe("selectProjectTree with folders", () => {
  it("nests folders and documents in the order of each parent's childOrder", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    expect(describeLevel(model?.entries ?? [])).toEqual([
      `F:${FOLDER_1}`,
      `D:${DOCUMENT_A}`,
      `D:${DOCUMENT_B}`,
    ]);
    expect(describeLevel(folderNode(model, FOLDER_1).children)).toEqual([
      `F:${FOLDER_2}`,
      `D:${DOCUMENT_C}`,
    ]);
    expect(describeLevel(folderNode(model, FOLDER_2).children)).toEqual([
      `D:${DOCUMENT_D}`,
    ]);
  });

  it("expands folders by default and folds the ones in the UI state", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const folded = setFolderCollapsed(createInitialUiState(), FOLDER_2, true);
    const model = selectProjectTree(store.getState(), folded);
    expect(folderNode(model, FOLDER_1).isExpanded).toBe(true);
    expect(folderNode(model, FOLDER_2).isExpanded).toBe(false);
  });

  it("computes move limits against each entry's own parent order", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const model = selectProjectTree(store.getState(), createInitialUiState());
    const [folder, documentA, documentB] = model?.entries ?? [];
    expect(
      [folder, documentA, documentB].map((n) => [n?.canMoveUp, n?.canMoveDown]),
    ).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
    const [folder2, documentC] = folderNode(model, FOLDER_1).children;
    expect(
      [folder2, documentC].map((n) => [n?.canMoveUp, n?.canMoveDown]),
    ).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it("marks folders that hold an open document, at any depth", async () => {
    const { store, workspace } = await openedFolderDiskWorkspace();
    await workspace.openDocument(DOCUMENT_D);
    const model = selectProjectTree(store.getState(), createInitialUiState());
    expect(folderNode(model, FOLDER_1).holdsOpenDocument).toBe(true);
    expect(folderNode(model, FOLDER_2).holdsOpenDocument).toBe(true);
    const sibling = folderNode(model, FOLDER_1).children[1];
    expect(sibling?.kind === "document" && sibling.isOpen).toBe(false);
  });

  it("shows a folder that failed to load, with no children and no moves", async () => {
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
    const model = selectProjectTree(
      harness.store.getState(),
      createInitialUiState(),
    );
    const node = folderNode(model, failed);
    expect(node).toMatchObject({
      state: "loadFailed",
      children: [],
      canMoveUp: false,
      canMoveDown: false,
    });
  });
});

describe("flattenProjectTree with folders", () => {
  it("lists nested items depth first and hides the children of a folded folder", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const open = selectProjectTree(store.getState(), createInitialUiState());
    if (open === null) throw new Error("project is open");
    expect(flattenProjectTree(open).map((item) => item.key)).toEqual([
      PROJECT_TREE_KEY,
      folderTreeKey(FOLDER_1),
      folderTreeKey(FOLDER_2),
      documentTreeKey(DOCUMENT_D),
      documentTreeKey(DOCUMENT_C),
      documentTreeKey(DOCUMENT_A),
      documentTreeKey(DOCUMENT_B),
    ]);
    const folded = selectProjectTree(
      store.getState(),
      setFolderCollapsed(createInitialUiState(), FOLDER_1, true),
    );
    if (folded === null) throw new Error("project is open");
    const items = flattenProjectTree(folded);
    expect(items.map((item) => item.key)).toEqual([
      PROJECT_TREE_KEY,
      folderTreeKey(FOLDER_1),
      documentTreeKey(DOCUMENT_A),
      documentTreeKey(DOCUMENT_B),
    ]);
    expect(items[1]).toMatchObject({
      parentIndex: 0,
      firstChildIndex: null,
      folderState: "collapsed",
    });
  });

  it("gives ArrowRight / ArrowLeft their folder meaning", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const model = selectProjectTree(
      store.getState(),
      setFolderCollapsed(createInitialUiState(), FOLDER_2, true),
    );
    if (model === null) throw new Error("project is open");
    const items = flattenProjectTree(model);
    const folder1 = items.findIndex(
      (item) => item.key === folderTreeKey(FOLDER_1),
    );
    const folder2 = items.findIndex(
      (item) => item.key === folderTreeKey(FOLDER_2),
    );
    // Expanded: Left collapses, Right goes to the first child.
    expect(treeNavigation("ArrowLeft", items, folder1)).toEqual({
      action: "collapse",
      index: folder1,
    });
    expect(treeNavigation("ArrowRight", items, folder1)).toEqual({
      action: "focus",
      index: folder1 + 1,
    });
    // Collapsed: Right expands, Left goes to the parent.
    expect(treeNavigation("ArrowRight", items, folder2)).toEqual({
      action: "expand",
      index: folder2,
    });
    expect(treeNavigation("ArrowLeft", items, folder2)).toEqual({
      action: "focus",
      index: folder1,
    });
  });
});

describe("selectMoveTargets", () => {
  it("lists the project root and every folder depth first, disabling the current parent", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const targets = selectMoveTargets(store.getState(), DOCUMENT_A);
    expect(
      targets.map((target) => [
        target.parentFolderId,
        target.depth,
        target.disabledReason,
      ]),
    ).toEqual([
      [null, 0, "currentParent"],
      [FOLDER_1, 1, null],
      [FOLDER_2, 2, null],
    ]);
  });

  it("disables a folder and everything inside it as targets of that folder", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const targets = selectMoveTargets(store.getState(), FOLDER_1);
    expect(
      targets.map((target) => [target.parentFolderId, target.disabledReason]),
    ).toEqual([
      [null, "currentParent"],
      [FOLDER_1, "selfOrDescendant"],
      [FOLDER_2, "selfOrDescendant"],
    ]);
  });

  it("disables the current parent of a nested document and offers the others", async () => {
    const { store } = await openedFolderDiskWorkspace();
    const targets = selectMoveTargets(store.getState(), DOCUMENT_D);
    expect(
      targets.map((target) => [target.parentFolderId, target.disabledReason]),
    ).toEqual([
      [null, null],
      [FOLDER_1, null],
      [FOLDER_2, "currentParent"],
    ]);
  });

  it("is empty for an unknown entry and without a project", async () => {
    const { store } = await openedFolderDiskWorkspace();
    expect(selectMoveTargets(store.getState(), folderIdOf(99))).toEqual([]);
    expect(selectMoveTargets({ project: null }, DOCUMENT_A)).toEqual([]);
  });
});
