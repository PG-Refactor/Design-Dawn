import { describe, expect, it } from "vitest";
import {
  documentIdOf,
  folderIdOf,
} from "../../../application/test-support/fakes";
import {
  type TreeDropHit,
  type TreeDropRow,
  treeDropHitAt,
  treeMoveTargetOf,
} from "./tree-drag";
import { documentTreeKey, folderTreeKey, PROJECT_TREE_KEY } from "./tree-items";
import type {
  DocumentNode,
  FolderNode,
  ProjectTreeModel,
  TreeEntryNode,
} from "./tree-model";

const OUTER = folderIdOf(1);
const INNER = folderIdOf(2);
const BROKEN = folderIdOf(3);
const DOC_1 = documentIdOf(1);
const DOC_2 = documentIdOf(2);
const DOC_3 = documentIdOf(3);
const IN_OUTER = documentIdOf(4);
const FAILED_DOC = documentIdOf(5);

function documentNode(
  documentId: DocumentNode["documentId"],
  state: DocumentNode["state"] = "loaded",
): DocumentNode {
  return {
    kind: "document",
    documentId,
    name: "Document",
    state,
    isOpen: false,
    isActive: false,
  };
}

function folderNode(
  folderId: FolderNode["folderId"],
  children: readonly TreeEntryNode[],
  state: FolderNode["state"] = "loaded",
): FolderNode {
  return {
    kind: "folder",
    folderId,
    name: "Folder",
    state,
    isExpanded: true,
    children,
  };
}

// Project
// ├ DOC_1
// ├ OUTER
// │ ├ INNER
// │ └ IN_OUTER
// ├ DOC_2
// ├ BROKEN (failed to load)
// ├ DOC_3
// └ FAILED_DOC (failed to load)
const MODEL: ProjectTreeModel = {
  projectName: "Project",
  entries: [
    documentNode(DOC_1),
    folderNode(OUTER, [folderNode(INNER, []), documentNode(IN_OUTER)]),
    documentNode(DOC_2),
    folderNode(BROKEN, [], "loadFailed"),
    documentNode(DOC_3),
    documentNode(FAILED_DOC, "loadFailed"),
  ],
};

const rowInside = (key: string | null): TreeDropHit => ({
  key,
  position: "inside",
});
const rowBefore = (key: string): TreeDropHit => ({ key, position: "before" });
const rowAfter = (key: string): TreeDropHit => ({ key, position: "after" });

describe("treeDropHitAt", () => {
  const ROW_HEIGHT = 20;
  const rows: TreeDropRow[] = [
    PROJECT_TREE_KEY,
    folderTreeKey(OUTER),
    documentTreeKey(DOC_1),
    folderTreeKey(INNER),
  ].map((key, index) => ({
    key,
    top: index * ROW_HEIGHT,
    bottom: (index + 1) * ROW_HEIGHT,
  }));
  const kindOf = (key: string) =>
    key === PROJECT_TREE_KEY
      ? "project"
      : key === folderTreeKey(INNER)
        ? "folderCollapsed"
        : key.startsWith("folder:")
          ? "folder"
          : "document";
  const at = (y: number) => treeDropHitAt(rows, y, kindOf);

  it("puts the entry inside the Project on the Project row", () => {
    expect(at(1)).toEqual(rowInside(PROJECT_TREE_KEY));
    expect(at(19)).toEqual(rowInside(PROJECT_TREE_KEY));
  });

  it("splits a folder row into before (top quarter) and inside (the rest)", () => {
    expect(at(20)).toEqual(rowBefore(folderTreeKey(OUTER)));
    expect(at(26)).toEqual(rowInside(folderTreeKey(OUTER)));
    expect(at(39)).toEqual(rowInside(folderTreeKey(OUTER)));
  });

  it("gives a folded folder an 'after' band at the bottom", () => {
    expect(at(61)).toEqual(rowBefore(folderTreeKey(INNER)));
    expect(at(70)).toEqual(rowInside(folderTreeKey(INNER)));
    expect(at(76)).toEqual(rowAfter(folderTreeKey(INNER)));
  });

  it("splits a document row in halves", () => {
    expect(at(41)).toEqual(rowBefore(documentTreeKey(DOC_1)));
    expect(at(50)).toEqual(rowAfter(documentTreeKey(DOC_1)));
  });

  it("reads the space below the last row as the top level, and above as nothing", () => {
    expect(at(80)).toEqual(rowInside(null));
    expect(at(500)).toEqual(rowInside(null));
    expect(at(-5)).toBeNull();
  });

  it("is the top level for an empty tree", () => {
    expect(treeDropHitAt([], 10, kindOf)).toBeNull();
  });
});

describe("treeMoveTargetOf", () => {
  const target = (draggedKey: string, hit: TreeDropHit | null) =>
    treeMoveTargetOf(MODEL, draggedKey, hit);

  it("moves a document in front of another one in the same parent", () => {
    expect(
      target(documentTreeKey(DOC_3), rowBefore(documentTreeKey(DOC_1))),
    ).toEqual({ parentFolderId: null, beforeEntryId: DOC_1 });
  });

  it("moves a document after another one, skipping itself", () => {
    expect(
      target(documentTreeKey(DOC_1), rowAfter(documentTreeKey(DOC_2))),
    ).toEqual({ parentFolderId: null, beforeEntryId: BROKEN });
    expect(
      target(documentTreeKey(DOC_1), rowAfter(documentTreeKey(FAILED_DOC))),
    ).toEqual({ parentFolderId: null, beforeEntryId: null });
  });

  it("moves into a folder at its end, and into another folder's place", () => {
    expect(
      target(documentTreeKey(DOC_2), rowInside(folderTreeKey(INNER))),
    ).toEqual({
      parentFolderId: INNER,
      beforeEntryId: null,
    });
    expect(
      target(documentTreeKey(DOC_2), rowBefore(documentTreeKey(IN_OUTER))),
    ).toEqual({ parentFolderId: OUTER, beforeEntryId: IN_OUTER });
  });

  it("moves out to the top level from the Project row or the empty space", () => {
    expect(
      target(documentTreeKey(IN_OUTER), rowInside(PROJECT_TREE_KEY)),
    ).toEqual({
      parentFolderId: null,
      beforeEntryId: null,
    });
    expect(target(folderTreeKey(INNER), rowInside(null))).toEqual({
      parentFolderId: null,
      beforeEntryId: null,
    });
  });

  it("does nothing where the entry already is", () => {
    expect(
      target(documentTreeKey(DOC_2), rowBefore(documentTreeKey(DOC_2))),
    ).toBeNull();
    expect(
      target(documentTreeKey(DOC_2), rowAfter(documentTreeKey(DOC_2))),
    ).toBeNull();
    expect(
      target(documentTreeKey(DOC_2), rowAfter(folderTreeKey(OUTER))),
    ).toBeNull();
    expect(
      target(documentTreeKey(DOC_2), rowBefore(folderTreeKey(BROKEN))),
    ).toBeNull();
    expect(
      target(documentTreeKey(IN_OUTER), rowInside(folderTreeKey(OUTER))),
    ).toBeNull();
    expect(target(documentTreeKey(FAILED_DOC), rowInside(null))).toBeNull();
  });

  it("does not put a folder into itself or one of its own folders", () => {
    expect(
      target(folderTreeKey(OUTER), rowInside(folderTreeKey(OUTER))),
    ).toBeNull();
    expect(
      target(folderTreeKey(OUTER), rowInside(folderTreeKey(INNER))),
    ).toBeNull();
    expect(
      target(folderTreeKey(OUTER), rowBefore(documentTreeKey(IN_OUTER))),
    ).toBeNull();
  });

  it("does not move anything into a folder that failed to load, or a document", () => {
    expect(
      target(documentTreeKey(DOC_1), rowInside(folderTreeKey(BROKEN))),
    ).toBeNull();
    expect(
      target(documentTreeKey(DOC_1), rowInside(documentTreeKey(DOC_2))),
    ).toBeNull();
  });

  it("does not move an entry that failed to load, or nothing at all", () => {
    expect(
      target(documentTreeKey(FAILED_DOC), rowBefore(documentTreeKey(DOC_1))),
    ).toBeNull();
    expect(
      target(folderTreeKey(BROKEN), rowBefore(documentTreeKey(DOC_1))),
    ).toBeNull();
    expect(target(documentTreeKey(DOC_1), null)).toBeNull();
  });
});
