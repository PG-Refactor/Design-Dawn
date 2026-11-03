import type { MouseEvent } from "react";
import type { ThemeState } from "../../application/theme/theme-controller";
import { MERMAID_PREVIEW_DEBOUNCE_MS } from "../../config/mermaid-preview-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./mermaid-diagram-preview.css";
import { useContextMenu } from "../../shared/menu/context-menu";
import { useDiagramInteraction } from "./diagram-interaction";
import { type DiagramHit, shapeAt } from "./diagram-shapes";
import { useMermaidRenderer } from "./mermaid-renderer-context";
import { useMermaidPreview } from "./use-mermaid-preview";

export interface MermaidDiagramPreviewProps {
  readonly source: string;
  readonly shortId: string;
  // The editor preview waits for typing to pause; the normal view draws at once.
  readonly debounced: boolean;
  // The hint to double-click is pointless while the editor is already open.
  readonly showEditHint: boolean;
}

const selectResolvedTheme = (state: ThemeState) => state.resolvedTheme;
const NO_DEBOUNCE_MS = 0;

// The diagram of a Mermaid block as an image. The SVG is only ever an <img> source (an
// object URL of sanitised SVG), never markup in the page; error text is a React text node.
export function MermaidDiagramPreview({
  source,
  shortId,
  debounced,
  showEditHint,
}: MermaidDiagramPreviewProps) {
  const messages = useMessages().mermaid;
  const renderer = useMermaidRenderer();
  const { themeController } = useWorkspaceServices();
  const themeKey = useStoreSelector(themeController.store, selectResolvedTheme);
  const interaction = useDiagramInteraction();
  const contextMenu = useContextMenu();
  const { status, url, errorMessage, shapes } = useMermaidPreview({
    source,
    debounceMs: debounced ? MERMAID_PREVIEW_DEBOUNCE_MS : NO_DEBOUNCE_MS,
    renderer,
    themeKey,
  });
  const failed = status === "error";

  // The shape under the pointer, when the event is on the picture.
  function hitOf(event: MouseEvent<HTMLElement>): DiagramHit | null {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || shapes == null) return null;
    const box = image.getBoundingClientRect();
    return shapeAt(
      shapes,
      { x: event.clientX - box.left, y: event.clientY - box.top },
      { width: box.width, height: box.height },
    );
  }

  // Only while the GUI editor is beside the picture (it registers what it offers).
  function onContextMenu(event: MouseEvent<HTMLDivElement>): void {
    const handler = interaction?.current() ?? null;
    if (handler === null) return;
    const entries = handler.entriesFor(hitOf(event));
    if (entries.length === 0) return;
    contextMenu.openFromEvent(event, messages.gui.diagramMenuLabel, entries);
  }

  function onClick(event: MouseEvent<HTMLDivElement>): void {
    const handler = interaction?.current() ?? null;
    const hit = handler === null ? null : hitOf(event);
    if (handler !== null && hit !== null) handler.pick(hit);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled region over a div is intended; <section> would not take the dynamic label as clearly.
    // biome-ignore lint/a11y/useKeyWithClickEvents: clicking a shape is a shortcut for choosing it in the editor's lists, which the keyboard reaches.
    <div
      role="region"
      aria-label={messages.previewLabel(shortId)}
      className="mermaid-preview"
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      {url !== null && (
        <img
          className={
            failed
              ? "mermaid-preview__image mermaid-preview__image--stale"
              : "mermaid-preview__image"
          }
          src={url}
          alt={messages.diagramAlt(shortId)}
          draggable={false}
        />
      )}
      {status === "empty" && (
        <p className="mermaid-preview__message">{messages.empty}</p>
      )}
      {status === "rendering" && url === null && (
        <p className="mermaid-preview__message">{messages.rendering}</p>
      )}
      {failed && (
        <div
          role="alert"
          className={
            url === null
              ? "mermaid-preview__error"
              : "mermaid-preview__error mermaid-preview__error--over-image"
          }
        >
          {url === null && (
            <p className="mermaid-preview__error-title">
              {messages.renderFailed}
            </p>
          )}
          <p className="mermaid-preview__error-label">
            {messages.errorDetails}
          </p>
          <pre className="mermaid-preview__error-detail">{errorMessage}</pre>
          {url === null && showEditHint && (
            <p className="mermaid-preview__hint">{messages.editHint}</p>
          )}
        </div>
      )}
      {contextMenu.element}
    </div>
  );
}
