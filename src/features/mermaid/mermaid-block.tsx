import type { BlockId } from "../../domain/shared/entity-id";
import type { BlockRendererProps } from "../canvas/block-renderer";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockEditor } from "../text-block/text-block-editor";
import { TextBlockState } from "../text-block/text-block-state";
import { useTextBlockContent } from "../text-block/use-text-block-content";
import { useMessages } from "../workspace/use-messages";
import { MermaidPlaceholderPreview } from "./mermaid-placeholder-preview";

// The renderer of a Mermaid block: the same states as the Markdown block, with the shared
// editor. Until real rendering exists (docs/architecture.md §15.8) the preview is a
// placeholder showing the source.
export function MermaidBlock({
  documentId,
  sheetId,
  block,
}: BlockRendererProps) {
  const messages = useMessages().mermaid;
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
    const shortId = shortBlockId(blockId);
    return (
      <TextBlockEditor
        documentId={documentId}
        sheetId={sheetId}
        blockId={blockId}
        initialText={text}
        labels={{
          editor: messages.editorLabel(shortId),
          source: messages.sourceLabel(shortId),
          done: messages.done,
        }}
        renderPreview={(draft) => (
          <PlaceholderOf blockId={blockId} source={draft} scrollable />
        )}
      />
    );
  }
  return <PlaceholderOf blockId={blockId} source={text} />;
}

function PlaceholderOf({
  blockId,
  source,
  scrollable,
}: {
  readonly blockId: BlockId;
  readonly source: string;
  readonly scrollable?: boolean;
}) {
  const messages = useMessages().mermaid;
  return (
    <MermaidPlaceholderPreview
      source={source}
      label={messages.previewLabel(shortBlockId(blockId))}
      notice={messages.previewUnavailable}
      emptyMessage={messages.empty}
      scrollable={scrollable}
    />
  );
}
