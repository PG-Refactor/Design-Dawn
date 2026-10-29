import { MERMAID_EDITOR_INITIAL_VIEW } from "../../config/mermaid-gui-config";
import type { BlockRendererProps } from "../canvas/block-renderer";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockEditor } from "../text-block/text-block-editor";
import { TextBlockState } from "../text-block/text-block-state";
import { useTextBlockContent } from "../text-block/use-text-block-content";
import { useMessages } from "../workspace/use-messages";
import { DiagramGuiPanel } from "./diagram-gui-panel";
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
        renderPreview={(previewText, view) => (
          <MermaidDiagramPreview
            source={previewText}
            shortId={shortId}
            // Typing pauses before drawing; a GUI operation is one deliberate change.
            debounced={view === "source"}
            showEditHint={false}
          />
        )}
        guiView={{
          labels: {
            modeGroup: messages.gui.modeGroup,
            gui: messages.gui.modeGui,
            source: messages.gui.modeSource,
          },
          initialView: MERMAID_EDITOR_INITIAL_VIEW,
          committedText: text,
          render: ({ committedText, showSource, leaveRef }) => (
            <DiagramGuiPanel
              target={{ documentId, sheetId, blockId }}
              shortId={shortId}
              source={committedText}
              onShowSource={showSource}
              leaveRef={leaveRef}
            />
          ),
        }}
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
