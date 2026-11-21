import { useMemo } from "react";
import type { ContentPath } from "../../domain/block/content-path";
import {
  type BlockDisplay,
  blockDisplayOf,
} from "../../domain/block/content-scale";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import type { BlockRendererProps } from "../canvas/block-renderer";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockState } from "../text-block/text-block-state";
import { useTextBlockContent } from "../text-block/use-text-block-content";
import { useMessages } from "../workspace/use-messages";
import { MarkdownEditor } from "./markdown-editor";
import { MarkdownPreview } from "./markdown-preview";
import { renderMarkdown } from "./render-markdown";
import { useMarkdownImageContext } from "./use-markdown-image-context";

// The renderer of a Markdown block: loading / failed states, the rendered preview, or the
// split editor while the block is being edited.
export function MarkdownBlock({
  documentId,
  sheetId,
  block,
  onFittedScale,
}: BlockRendererProps) {
  const messages = useMessages().markdown;
  const { blockId } = block;
  const { status, text, editing } = useTextBlockContent(
    documentId,
    sheetId,
    blockId,
  );

  if (status?.status !== "loaded" || text === undefined) {
    return <TextBlockState status={status} messages={messages} />;
  }
  if (editing) {
    return (
      <MarkdownEditor
        documentId={documentId}
        sheetId={sheetId}
        blockId={blockId}
        contentPath={block.contentPath}
        initialText={text}
      />
    );
  }
  return (
    <RenderedMarkdown
      documentId={documentId}
      blockId={block.blockId}
      contentPath={block.contentPath}
      text={text}
      display={blockDisplayOf(block)}
      onFittedScale={onFittedScale}
    />
  );
}

function RenderedMarkdown({
  documentId,
  blockId,
  contentPath,
  text,
  display,
  onFittedScale,
}: {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly contentPath: ContentPath;
  readonly text: string;
  readonly display: BlockDisplay;
  readonly onFittedScale: ((percent: number) => void) | undefined;
}) {
  const markdownMessages = useMessages().markdown;
  const images = useMarkdownImageContext(documentId, contentPath);
  const html = useMemo(() => renderMarkdown(text, images), [text, images]);
  return (
    <MarkdownPreview
      html={html}
      label={markdownMessages.previewLabel(shortBlockId(blockId))}
      scalePercent={display.scalePercent}
      autoFit={display.autoFit}
      onFittedScale={onFittedScale}
    />
  );
}
