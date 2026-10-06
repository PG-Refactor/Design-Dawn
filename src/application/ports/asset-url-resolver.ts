// Port for the URL an `<img>` uses to show an image asset. Only identifiers and the
// Document-relative `contentPath` go in; the result never contains an absolute path.

import type { ContentPath } from "../../domain/block/content-path";
import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";

export interface AssetUrlResolver {
  urlFor(
    projectId: ProjectId,
    documentId: DocumentId,
    contentPath: ContentPath,
  ): string;
}
