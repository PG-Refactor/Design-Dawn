import { useMemo } from "react";
import type { ApplicationState } from "../../application/state/application-state";
import type { ContentPath } from "../../domain/block/content-path";
import type { DocumentId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { assetRevisionStore, withAssetRevision } from "../image/asset-revision";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import type { MarkdownImageContext } from "./render-markdown";

const selectProjectId = (application: ApplicationState) =>
  application.project?.projectId ?? null;
const selectRevision = (state: { readonly revision: number }) => state.revision;

// What a Markdown block of `documentId` stored at `contentPath` needs to show the images
// of its Document; undefined while no Project is open (images then show their alt text).
export function useMarkdownImageContext(
  documentId: DocumentId,
  contentPath: ContentPath,
): MarkdownImageContext | undefined {
  const { applicationStore, assetUrlResolver } = useWorkspaceServices();
  const projectId = useStoreSelector(applicationStore, selectProjectId);
  const revision = useStoreSelector(assetRevisionStore, selectRevision);
  return useMemo(() => {
    if (projectId === null) return undefined;
    return {
      markdownContentPath: contentPath,
      urlFor: (assetContentPath) =>
        withAssetRevision(
          assetUrlResolver.urlFor(projectId, documentId, assetContentPath),
          revision,
        ),
      urlPrefix: assetUrlResolver.documentUrlPrefix(projectId, documentId),
    };
  }, [assetUrlResolver, projectId, documentId, contentPath, revision]);
}
