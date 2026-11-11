import { describe, expect, it } from "vitest";
import type { OpenProjectState } from "../../application/state/application-state";
import { exportTree } from "./export-tree";

const folder = (
  folderId: string,
  name: string,
  parent: string | null,
  childOrder: string[],
) =>
  ({
    folderId,
    name,
    parentFolderId: parent,
    childOrder,
    state: "loaded",
  }) as never;
const document = (
  documentId: string,
  name: string | null,
  parent: string | null,
) => ({ documentId, name, parentFolderId: parent, state: "loaded" }) as never;

describe("exportTree", () => {
  it("lists folders and Documents in the tree's order, with each Document's folders", () => {
    const project = {
      project: { childOrder: ["f1", "d1"] },
      folders: [
        folder("f1", "Design", null, ["f2", "d2"]),
        folder("f2", "Back", "f1", ["d3"]),
      ],
      documents: [
        document("d1", "Top", null),
        document("d2", "Screens", "f1"),
        document("d3", "API", "f2"),
        document("d4", null, null),
      ],
    } as unknown as OpenProjectState;
    expect(
      exportTree(project).map((node) =>
        node.kind === "folder"
          ? ["folder", node.name, node.depth, node.documentIds]
          : ["document", node.name, node.depth, node.folders],
      ),
    ).toEqual([
      ["folder", "Design", 0, ["d3", "d2"]],
      ["folder", "Back", 1, ["d3"]],
      ["document", "API", 2, ["Design", "Back"]],
      ["document", "Screens", 1, ["Design"]],
      ["document", "Top", 0, []],
    ]);
  });
});
