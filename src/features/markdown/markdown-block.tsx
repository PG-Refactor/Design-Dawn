import { useCallback, useMemo } from "react";
import type { ApplicationState } from "../../application/state/application-state";
import type { BlockId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type { BlockRendererProps } from "../canvas/block-renderer";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { MarkdownEditor } from "./markdown-editor";
import { MARKDOWN_MESSAGES, previewLabel } from "./markdown-messages";
import { MarkdownPreview } from "./markdown-preview";
import { renderMarkdown } from "./render-markdown";
import "./markdown-block.css";

// The renderer of a Markdown block: loading / failed states, the rendered preview, or the
// split editor while the block is being edited. The text comes from the application
// state; which block is edited comes from UI state.
export function MarkdownBlock({
  documentId,
  sheetId,
  block,
}: BlockRendererProps) {
  const { applicationStore } = useWorkspaceServices();
  const { blockId } = block;
  const status = useStoreSelector(
    applicationStore,
    useCallback(
      (application: ApplicationState) =>
        application.documents.get(documentId)?.contentStatus.get(blockId),
      [documentId, blockId],
    ),
  );
  const text = useStoreSelector(
    applicationStore,
    useCallback(
      (application: ApplicationState) =>
        application.documents.get(documentId)?.contents.get(blockId),
      [documentId, blockId],
    ),
  );
  const editing = useUiState(
    useCallback(
      (ui) =>
        ui.editingBlock?.sheetId === sheetId &&
        ui.editingBlock.blockId === blockId,
      [sheetId, blockId],
    ),
  );

  if (status?.status === "failed") {
    // Never an empty preview: an empty block would look like an empty file, and could
    // invite an edit that overwrites the one that could not be read.
    return (
      <div className="markdown-block__state markdown-block__state--error">
        <p className="markdown-block__headline">
          {MARKDOWN_MESSAGES.loadFailed}
        </p>
        <p>{MARKDOWN_MESSAGES.loadFailedHint}</p>
        <details>
          <summary>{MARKDOWN_MESSAGES.errorDetails}</summary>
          <dl className="markdown-block__details">
            <dt>{MARKDOWN_MESSAGES.errorKind}</dt>
            <dd>{status.error.kind}</dd>
            <dd>{status.error.detail}</dd>
          </dl>
        </details>
      </div>
    );
  }
  if (status?.status !== "loaded" || text === undefined) {
    return (
      <div className="markdown-block__state" role="status">
        {MARKDOWN_MESSAGES.loading}
      </div>
    );
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
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <MarkdownPreview html={html} label={previewLabel(blockId)} />;
}
