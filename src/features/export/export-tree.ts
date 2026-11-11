// The Project's folders and Documents as the Export dialog lists them: in the tree's order,
// each Document with the folders it is in (for keeping the folder structure in the export).

import type { OpenProjectState } from "../../application/state/application-state";
import type {
  DocumentId,
  EntryId,
  FolderId,
} from "../../domain/shared/entity-id";

export type ExportTreeNode =
  | {
      readonly kind: "folder";
      readonly folderId: FolderId;
      readonly name: string;
      readonly depth: number;
      // Every Document inside, at any depth.
      readonly documentIds: readonly DocumentId[];
    }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
      readonly name: string;
      readonly depth: number;
      readonly folders: readonly string[];
    };

// Depth-first, in each parent's order; entries without a name (failed to load) are left out.
export function exportTree(project: OpenProjectState): ExportTreeNode[] {
  const nodes: ExportTreeNode[] = [];
  const childrenOf = (
    parent: FolderId | null,
    order: readonly EntryId[],
  ): EntryId[] => {
    const listed = [
      ...project.folders.filter((folder) => folder.parentFolderId === parent),
      ...project.documents.filter((entry) => entry.parentFolderId === parent),
    ].map((entry) => ("folderId" in entry ? entry.folderId : entry.documentId));
    return [
      ...order.filter((id) => listed.includes(id)),
      ...listed.filter((id) => !order.includes(id)),
    ];
  };
  const visit = (
    parent: FolderId | null,
    order: readonly EntryId[],
    path: readonly string[],
  ): DocumentId[] => {
    const inside: DocumentId[] = [];
    for (const id of childrenOf(parent, order)) {
      const folder = project.folders.find((entry) => entry.folderId === id);
      if (folder !== undefined) {
        if (folder.name === null) continue;
        const index = nodes.length;
        const documentIds = visit(folder.folderId, folder.childOrder, [
          ...path,
          folder.name,
        ]);
        nodes.splice(index, 0, {
          kind: "folder",
          folderId: folder.folderId,
          name: folder.name,
          depth: path.length,
          documentIds,
        });
        inside.push(...documentIds);
        continue;
      }
      const document = project.documents.find(
        (entry) => entry.documentId === id,
      );
      if (document === undefined || document.name === null) continue;
      nodes.push({
        kind: "document",
        documentId: document.documentId,
        name: document.name,
        depth: path.length,
        folders: path,
      });
      inside.push(document.documentId);
    }
    return inside;
  };
  visit(null, project.project.childOrder, []);
  return nodes;
}
