import { useCallback, useMemo, useState } from "react";
import type { ApplicationState } from "../../application/state/application-state";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type { BlockRendererProps } from "../canvas/block-renderer";
import { shortBlockId } from "../canvas/canvas-messages";
import {
  clearImageLoadFailure,
  markImageLoadFailed,
} from "../workspace/ui-state/ui-state";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./image-block.css";

const selectProjectId = (application: ApplicationState) =>
  application.project?.projectId ?? null;

// The renderer of an Image block: an `<img>` over the asset URL, or an error state when
// the picture cannot be loaded. The URL comes from the resolver port, so the component
// never sees a file path. Only `<img src>` is used (never inline markup), which keeps SVG
// assets inert: no script runs and nothing is fetched on their behalf.
export function ImageBlock({ documentId, sheetId, block }: BlockRendererProps) {
  const { applicationStore, assetUrlResolver } = useWorkspaceServices();
  const projectId = useStoreSelector(applicationStore, selectProjectId);
  const source = useMemo(
    () =>
      projectId === null
        ? null
        : assetUrlResolver.urlFor(projectId, documentId, block.contentPath),
    [assetUrlResolver, projectId, documentId, block.contentPath],
  );
  if (source === null) return null;
  // Keyed by the URL: a block that now points elsewhere starts a fresh load attempt.
  return (
    <LoadedImage key={source} source={source} sheetId={sheetId} block={block} />
  );
}

interface LoadedImageProps
  extends Pick<BlockRendererProps, "sheetId" | "block"> {
  readonly source: string;
}

function LoadedImage({ source, sheetId, block }: LoadedImageProps) {
  const messages = useMessages().image;
  const { uiStateStore } = useWorkspaceServices();
  const { blockId } = block;
  // Local, so every mount (for example coming back to the sheet) tries the load again.
  const [failed, setFailed] = useState(false);
  const onLoad = useCallback(() => {
    setFailed(false);
    uiStateStore.setState((state) =>
      clearImageLoadFailure(state, sheetId, blockId),
    );
  }, [uiStateStore, sheetId, blockId]);
  const onError = useCallback(() => {
    setFailed(true);
    uiStateStore.setState((state) =>
      markImageLoadFailed(state, sheetId, blockId),
    );
  }, [uiStateStore, sheetId, blockId]);

  if (failed) {
    // Never a blank block: the user has to see that the picture is missing, and which
    // file the block expects.
    return (
      <div className="image-block__state">
        <p className="image-block__headline">{messages.loadFailed}</p>
        <p className="image-block__path">
          {messages.pathLabel}: {block.contentPath}
        </p>
      </div>
    );
  }
  return (
    <div className="image-block">
      <img
        className="image-block__picture"
        src={source}
        alt={messages.altText(shortBlockId(blockId))}
        draggable={false}
        onLoad={onLoad}
        onError={onError}
      />
    </div>
  );
}
