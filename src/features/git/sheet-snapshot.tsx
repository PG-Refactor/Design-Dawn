// One version of a Sheet drawn read-only for a visual diff: every Block where the version
// has it, as it looks in the app (text, diagram or picture, display size, caption), with the
// marks of what changed. Placed in a world layer the parent pans and zooms; nothing here
// can be selected, dragged or edited.

import { type ReactNode, useMemo } from "react";
import type { BlockChange } from "../../application/git/sheet-comparison";
import type { Viewport } from "../../application/local-state/viewport";
import type { GitSheetVersion } from "../../application/ports/git-gateway";
import type { Block } from "../../domain/block/block";
import { BLOCK_TYPE_DEFINITIONS } from "../../domain/block/block-type";
import { figureCaptionOf } from "../../domain/block/caption";
import {
  blockDisplayOf,
  isScalableBlockType,
} from "../../domain/block/content-scale";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { shortBlockId } from "../canvas/canvas-messages";
import { worldLayerTransform } from "../canvas/geometry/viewport-math";
import { MarkdownPreview } from "../markdown/markdown-preview";
import { renderMarkdown } from "../markdown/render-markdown";
import { useMarkdownImageContext } from "../markdown/use-markdown-image-context";
import { MermaidDiagramPreview } from "../mermaid/mermaid-diagram-preview";
import { useMessages } from "../workspace/use-messages";

export type SnapshotSide = "before" | "after";

interface SheetSnapshotProps {
  readonly version: GitSheetVersion;
  readonly side: SnapshotSide;
  readonly documentId: DocumentId | null;
  readonly changes: ReadonlyMap<BlockId, BlockChange>;
  // Where the Blocks moved from (shown on the later version as dashed outlines).
  readonly earlierFrames: ReadonlyMap<BlockId, Block>;
  readonly focused: BlockId | null;
  readonly viewport: Viewport;
}

// The mark a Block gets on this side: what it is called, and the class that draws it.
function markOf(
  change: BlockChange | undefined,
  side: SnapshotSide,
): "added" | "removed" | "moved" | "changed" | null {
  if (change === undefined) return null;
  if (change.kind === "added") return side === "after" ? "added" : null;
  if (change.kind === "removed") return side === "before" ? "removed" : null;
  if (change.content || change.display || change.caption || change.order) {
    return "changed";
  }
  return side === "after" && (change.moved || change.resized) ? "moved" : null;
}

function MarkdownContent({
  text,
  block,
  documentId,
}: {
  readonly text: string;
  readonly block: Block;
  readonly documentId: DocumentId;
}) {
  const images = useMarkdownImageContext(documentId, block.contentPath);
  const html = useMemo(() => renderMarkdown(text, images), [text, images]);
  const display = blockDisplayOf(block);
  return (
    <MarkdownPreview
      html={html}
      label={shortBlockId(block.blockId)}
      scalePercent={display.scalePercent}
      autoFit={display.autoFit}
    />
  );
}

function BlockContent({
  block,
  version,
  documentId,
}: {
  readonly block: Block;
  readonly version: GitSheetVersion;
  readonly documentId: DocumentId | null;
}): ReactNode {
  const messages = useMessages().git.sheetDiff;
  const text = version.texts[block.contentPath];
  const image = version.images[block.contentPath];
  switch (block.blockType) {
    case BLOCK_TYPE_DEFINITIONS.markdown.identifier:
      if (text === undefined) break;
      return documentId === null ? (
        <MarkdownPreview
          html={renderMarkdown(text)}
          label={shortBlockId(block.blockId)}
        />
      ) : (
        <MarkdownContent text={text} block={block} documentId={documentId} />
      );
    case BLOCK_TYPE_DEFINITIONS.mermaid.identifier:
      if (text === undefined) break;
      return (
        <MermaidDiagramPreview
          source={text}
          shortId={shortBlockId(block.blockId)}
          debounced={false}
          showEditHint={false}
          display={blockDisplayOf(block)}
        />
      );
    case BLOCK_TYPE_DEFINITIONS.image.identifier:
      if (image === undefined) break;
      return (
        <img
          className="sheet-snapshot__image"
          src={image}
          alt={block.caption ?? ""}
          draggable={false}
        />
      );
  }
  return <p className="sheet-snapshot__unreadable">{messages.unreadable}</p>;
}

export function SheetSnapshot({
  version,
  side,
  documentId,
  changes,
  earlierFrames,
  focused,
  viewport,
}: SheetSnapshotProps) {
  const messages = useMessages().git.sheetDiff;
  const blocks = version.sheet?.blocks ?? [];
  return (
    <div
      className="sheet-snapshot__world"
      style={{ transform: worldLayerTransform(viewport) }}
    >
      {side === "after"
        ? [...earlierFrames.values()].map((earlier) => (
            <div
              key={`from-${earlier.blockId}`}
              className="sheet-snapshot__from"
              style={{
                left: earlier.position.x,
                top: earlier.position.y,
                width: earlier.size.width,
                height: earlier.size.height,
              }}
            />
          ))
        : null}
      {blocks.map((block) => {
        const mark = markOf(changes.get(block.blockId), side);
        const caption = figureCaptionOf(block);
        return (
          <div
            key={block.blockId}
            className={[
              "sheet-snapshot__block",
              mark === null ? "" : `sheet-snapshot__block--${mark}`,
              focused === block.blockId ? "sheet-snapshot__block--focused" : "",
              isScalableBlockType(block.blockType)
                ? ""
                : "sheet-snapshot__block--picture",
            ]
              .filter((name) => name !== "")
              .join(" ")}
            style={{
              left: block.position.x,
              top: block.position.y,
              width: block.size.width,
              height: block.size.height,
            }}
          >
            {caption?.position === "above" ? (
              <p className="sheet-snapshot__caption">{caption.text}</p>
            ) : null}
            <div className="sheet-snapshot__body">
              <BlockContent
                block={block}
                version={version}
                documentId={documentId}
              />
            </div>
            {caption?.position === "below" ? (
              <p className="sheet-snapshot__caption">{caption.text}</p>
            ) : null}
            {mark === null ? null : (
              <span className="sheet-snapshot__mark">{messages[mark]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
