import { useCallback, useMemo } from "react";
import type { ContentPath } from "../../domain/block/content-path";
import { markdownImageReference } from "../../domain/block/markdown-image-path";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { shortBlockId } from "../canvas/canvas-messages";
import { TextBlockEditor } from "../text-block/text-block-editor";
import { useMessages } from "../workspace/use-messages";
import { MarkdownPreview } from "./markdown-preview";
import { type MarkdownImageContext, renderMarkdown } from "./render-markdown";
import { useMarkdownImageContext } from "./use-markdown-image-context";

export interface MarkdownEditorProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  // Where the block's file is: relative image paths are resolved from it.
  readonly contentPath: ContentPath;
  // The text when editing started; the draft is local from then on.
  readonly initialText: string;
}

// The shared text block editor with the Markdown labels and the rendered preview.
export function MarkdownEditor({
  documentId,
  sheetId,
  blockId,
  contentPath,
  initialText,
}: MarkdownEditorProps) {
  const messages = useMessages().markdown;
  const images = useMarkdownImageContext(documentId, contentPath);
  // One image per line, so several dropped images do not run together.
  const imageReferences = useCallback(
    (assetPaths: readonly ContentPath[]) =>
      assetPaths
        .map((assetPath) => markdownImageReference(contentPath, assetPath))
        .join("\n"),
    [contentPath],
  );
  const shortId = shortBlockId(blockId);
  return (
    <TextBlockEditor
      documentId={documentId}
      sheetId={sheetId}
      blockId={blockId}
      initialText={initialText}
      imageReferences={imageReferences}
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
          images={images}
          label={messages.previewLabel(shortId)}
        />
      )}
    />
  );
}

// A component of its own so the rendering only reruns when the draft changes.
function MarkdownDraftPreview({
  draft,
  images,
  label,
}: {
  readonly draft: string;
  readonly images: MarkdownImageContext | undefined;
  readonly label: string;
}) {
  const html = useMemo(() => renderMarkdown(draft, images), [draft, images]);
  return <MarkdownPreview html={html} label={label} scrollable />;
}
