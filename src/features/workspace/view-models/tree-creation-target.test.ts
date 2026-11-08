import { describe, expect, it } from "vitest";
import {
  documentIdOf,
  folderIdOf,
} from "../../../application/test-support/fakes";
import {
  creationTargetOf,
  documentTreeKey,
  folderTreeKey,
  PROJECT_TREE_KEY,
} from "./tree-items";
import type {
  DocumentNode,
  FolderNode,
  ProjectTreeModel,
  TreeEntryNode,
} from "./tree-model";

const OUTER = folderIdOf(1);
const INNER = folderIdOf(2);
const BROKEN = folderIdOf(3);
const TOP_DOCUMENT = documentIdOf(1);
const OUTER_DOCUMENT = documentIdOf(2);
const INNER_DOCUMENT = documentIdOf(3);

function documentNode(documentId: DocumentNode["documentId"]): DocumentNode {
  return {
    kind: "document",
    documentId,
    name: "Document",
    state: "loaded",
    isOpen: false,
    isActive: false,
  };
}

function folderNode(
  folderId: FolderNode["folderId"],
  name: string | null,
  children: readonly TreeEntryNode[],
  state: FolderNode["state"] = "loaded",
): FolderNode {
  return {
    kind: "folder",
    folderId,
    name,
    state,
    // Collapsed on purpose: the cursor row decides, not what is visible below it.
    isExpanded: false,
    children,
  };
}

const MODEL: ProjectTreeModel = {
  projectName: "Project",
  entries: [
    folderNode(OUTER, "Outer", [
      folderNode(INNER, "Inner", [documentNode(INNER_DOCUMENT)]),
      documentNode(OUTER_DOCUMENT),
    ]),
    folderNode(BROKEN, null, [], "loadFailed"),
    documentNode(TOP_DOCUMENT),
  ],
};

describe("creationTargetOf", () => {
  it("creates at the top level from the Project row and from a top-level document", () => {
    const expected = {
      parentFolderId: null,
      folderName: null,
      available: true,
    };
    expect(creationTargetOf(MODEL, PROJECT_TREE_KEY)).toEqual(expected);
    expect(creationTargetOf(MODEL, documentTreeKey(TOP_DOCUMENT))).toEqual(
      expected,
    );
  });

  it("creates inside the folder the cursor is on, at any depth", () => {
    expect(creationTargetOf(MODEL, folderTreeKey(OUTER))).toEqual({
      parentFolderId: OUTER,
      folderName: "Outer",
      available: true,
    });
    expect(creationTargetOf(MODEL, folderTreeKey(INNER))).toEqual({
      parentFolderId: INNER,
      folderName: "Inner",
      available: true,
    });
  });

  it("creates next to a document, in the folder that holds it", () => {
    expect(
      creationTargetOf(MODEL, documentTreeKey(OUTER_DOCUMENT)).parentFolderId,
    ).toBe(OUTER);
    expect(
      creationTargetOf(MODEL, documentTreeKey(INNER_DOCUMENT)).parentFolderId,
    ).toBe(INNER);
  });

  it("is unavailable on a folder that failed to load", () => {
    expect(creationTargetOf(MODEL, folderTreeKey(BROKEN))).toEqual({
      parentFolderId: BROKEN,
      folderName: null,
      available: false,
    });
  });

  it("falls back to the top level for a key that is no longer in the tree", () => {
    expect(creationTargetOf(MODEL, folderTreeKey(folderIdOf(99)))).toEqual({
      parentFolderId: null,
      folderName: null,
      available: true,
    });
  });
});
