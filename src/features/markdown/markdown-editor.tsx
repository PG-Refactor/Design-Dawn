import { useMemo } from "react";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockEditor } from "../text-block/text-block-editor";
import { useMessages } from "../workspace/use-messages";
import { MarkdownPreview } from "./markdown-preview";
import { renderMarkdown } from "./render-markdown";

export interface MarkdownEditorProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  // The text when editing started; the draft is local from then on.
  readonly initialText: string;
}

// The shared text block editor with the Markdown labels and the rendered preview.
export function MarkdownEditor({
  documentId,
  sheetId,
  blockId,
  initialText,
}: MarkdownEditorProps) {
  const messages = useMessages().markdown;
  const shortId = shortBlockId(blockId);
  return (
    <TextBlockEditor
      documentId={documentId}
      sheetId={sheetId}
      blockId={blockId}
      initialText={initialText}
      labels={{
        editor: messages.editorLabel(shortId),
        source: messages.sourceLabel(shortId),
        done: messages.done,
        hidePreview: messages.hidePreview,
        showPreview: messages.showPreview,
        divider: messages.sourcePreviewDivider,
      }}
      renderPreview={(draft) => (
        <MarkdownDraftPreview
          draft={draft}
          label={messages.previewLabel(shortId)}
        />
      )}
    />
  );
}

// A component of its own so the rendering only reruns when the draft changes.
function MarkdownDraftPreview({
  draft,
  label,
}: {
  readonly draft: string;
  readonly label: string;
}) {
  const html = useMemo(() => renderMarkdown(draft), [draft]);
  return <MarkdownPreview html={html} label={label} scrollable />;
}
