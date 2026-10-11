import type { BlockRendererProps } from "../canvas/block-renderer";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockEditor } from "../text-block/text-block-editor";
import { TextBlockState } from "../text-block/text-block-state";
import { useTextBlockContent } from "../text-block/use-text-block-content";
import { useMessages } from "../workspace/use-messages";
import { MermaidDiagramPreview } from "./mermaid-diagram-preview";

// The renderer of a Mermaid block: the same states as the Markdown block, with the shared
// editor. The preview is the rendered diagram in both the normal view and the editor.
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
          <MermaidDiagramPreview
            source={draft}
            shortId={shortId}
            debounced
            showEditHint={false}
          />
        )}
      />
    );
  }
  return (
    <MermaidDiagramPreview
      source={text}
      shortId={shortBlockId(blockId)}
      debounced={false}
      showEditHint
    />
  );
}
