import { useMemo } from "react";
import type { BlockId } from "../../domain/shared/entity-id";
import type { BlockRendererProps } from "../canvas/block-renderer";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockState } from "../text-block/text-block-state";
import { useTextBlockContent } from "../text-block/use-text-block-content";
import { useMessages } from "../workspace/use-messages";
import { MarkdownEditor } from "./markdown-editor";
import { MarkdownPreview } from "./markdown-preview";
import { renderMarkdown } from "./render-markdown";

// The renderer of a Markdown block: loading / failed states, the rendered preview, or the
// split editor while the block is being edited.
export function MarkdownBlock({
  documentId,
  sheetId,
  block,
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
        initialText={text}
      />
    );
  }
  return <RenderedMarkdown blockId={block.blockId} text={text} />;
}

function RenderedMarkdown({
  blockId,
  text,
}: {
  readonly blockId: BlockId;
  readonly text: string;
}) {
  const markdownMessages = useMessages().markdown;
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <MarkdownPreview
      html={html}
      label={markdownMessages.previewLabel(shortBlockId(blockId))}
    />
  );
}
