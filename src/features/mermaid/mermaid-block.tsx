import { useCallback, useMemo } from "react";
import {
  MERMAID_EDITOR_FALLBACK_VIEW,
  MERMAID_EDITOR_INITIAL_VIEW,
} from "../../config/mermaid-gui-config";
import { analyzeDiagramSource } from "../../domain/diagram/diagram-source";
import type { BlockRendererProps } from "../canvas/block-renderer";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockEditor } from "../text-block/text-block-editor";
import { TextBlockState } from "../text-block/text-block-state";
import { useTextBlockContent } from "../text-block/use-text-block-content";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { DiagramGuiPanel } from "./diagram-gui-panel";
import {
  createDiagramInteraction,
  DiagramInteractionContext,
} from "./diagram-interaction";
import { MermaidDiagramPreview } from "./mermaid-diagram-preview";

// Failures already reported in this window (block and text), so a re-render or a remount
// does not report the same one again.
const reportedRenderFailures = new Set<string>();

// The renderer of a Mermaid block: the same states as the Markdown block, with the shared
// editor. The preview is the rendered diagram in both the normal view and the editor.
export function MermaidBlock({
  documentId,
  sheetId,
  block,
}: BlockRendererProps) {
  const messages = useMessages().mermaid;
  const { blockId } = block;
  // One per block: the GUI panel registers into it, the editor's picture reads it.
  const interaction = useMemo(() => createDiagramInteraction(), []);
  const { status, text, editing } = useTextBlockContent(
    documentId,
    sheetId,
    blockId,
  );
  const { canvasActions, uiStateStore } = useWorkspaceServices();
  // A diagram that stopped drawing after a change from outside (another editor, Git, an AI
  // tool) is reported once per text; the user's own edits show their error where they edit.
  const reportRenderFailure = useCallback(
    (message: string) => {
      if (text === undefined || canvasActions.wroteHere(blockId, text)) return;
      const key = `${blockId}\u0000${text}`;
      if (reportedRenderFailures.has(key)) return;
      reportedRenderFailures.add(key);
      uiStateStore.setState((state) =>
        addOperationError(state, "renderDiagram", shortBlockId(blockId), {
          kind: "diagramRenderRejected",
          detail: message,
        }),
      );
    },
    [text, blockId, canvasActions, uiStateStore],
  );
  // Read when the editor opens: the GUI for a diagram it can edit, Source otherwise.
  const initialView = useMemo(
    () =>
      text !== undefined && analyzeDiagramSource(text).editability.editable
        ? MERMAID_EDITOR_INITIAL_VIEW
        : MERMAID_EDITOR_FALLBACK_VIEW,
    [text],
  );

  if (status?.status !== "loaded" || text === undefined) {
    return <TextBlockState status={status} messages={messages} />;
  }
  if (editing) {
    const shortId = shortBlockId(blockId);
    return (
      <DiagramInteractionContext.Provider value={interaction}>
        <TextBlockEditor
          documentId={documentId}
          sheetId={sheetId}
          blockId={blockId}
          initialText={text}
          labels={{
            editor: messages.editorLabel(shortId),
            source: messages.sourceLabel(shortId),
            done: messages.done,
            hidePreview: messages.hidePreview,
            showPreview: messages.showPreview,
            divider: messages.sourcePreviewDivider,
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
            initialView,
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
      </DiagramInteractionContext.Provider>
    );
  }
  return (
    <MermaidDiagramPreview
      source={text}
      shortId={shortBlockId(blockId)}
      debounced={false}
      showEditHint
      onRenderFailed={reportRenderFailure}
    />
  );
}
